import { Logger } from '@matter/general';
import { appendTrickleCandidatesToSdp } from '../matter/webrtcIce.js';
import {
    type ImageTransform,
    buildFfmpegSrc,
    IDENTITY_IMAGE_TRANSFORM,
    transformsEqual,
} from './imageTransform.js';
import { redactRtspInText } from '../utils/redactRtspUrl.js';

const logger = Logger.get('Go2RTCClient');

const WS_ICE_GATHER_MS = 6_000;
const WS_ICE_QUIET_MS = 1_000;
const WEBRTC_EXCHANGE_TIMEOUT_MS = 15_000;
const PREWARM_MAX_AGE_MS = 120_000;

export interface Go2RtcIceServer {
    urls: string[];
    username?: string;
    credential?: string;
}

export interface WebRtcExchangeResult {
    answerSdp: string;
    whepLocation?: string;
    whepEtag?: string;
}

interface StreamSource {
    name: string;
    rtspUrl: string;
}

const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const FRAME_CAPTURE_TIMEOUT_MS = 20_000;

export class Go2RTCClient {
    private baseUrl: string;
    private sources = new Map<string, StreamSource>();
    /** Serialize ffmpeg-heavy ops per camera to avoid starving the other stream. */
    private readonly locks = new Map<string, Promise<void>>();
    private readonly prewarmAt = new Map<string, number>();
    /** Tracks recent compact-hub (Android) offers per camera for go2rtc recycle. */
    private readonly compactHubOfferAt = new Map<string, number>();
    private readonly imageTransforms = new Map<string, ImageTransform>();
    private pruneTimer?: ReturnType<typeof setInterval>;

    private static readonly COMPACT_HUB_RECYCLE_MS = 120_000;

    constructor(baseUrl: string = 'http://127.0.0.1:3203') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    registerSource(id: string, name: string, rtspUrl: string): void {
        this.sources.set(id, { name, rtspUrl });
    }

    unregisterSource(id: string): void {
        this.sources.delete(id);
    }

    isRegistered(id: string): boolean {
        return this.sources.has(id);
    }

    /** Apply Matter ImageControl (flip/rotation). Rebuilds go2rtc sources only when values change. */
    async setImageTransform(id: string, transform: ImageTransform): Promise<void> {
        const prev = this.imageTransforms.get(id) ?? IDENTITY_IMAGE_TRANSFORM;
        if (transformsEqual(prev, transform)) {
            return;
        }
        this.imageTransforms.set(id, transform);
        if (!this.sources.has(id)) {
            return;
        }
        await this.#withLock(id, () => this.#refreshStreamSources(id));
    }

    getImageTransform(id: string): ImageTransform {
        return this.imageTransforms.get(id) ?? IDENTITY_IMAGE_TRANSFORM;
    }

    /** Wait until go2rtc API is reachable (e.g. after container restart). */
    async waitUntilReady(maxAttempts = 60, intervalMs = 1000): Promise<void> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}/api`);
                if (response.ok) {
                    logger.info(`go2rtc ready (attempt ${attempt})`);
                    return;
                }
            } catch {
                // retry
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error(`go2rtc not reachable at ${this.baseUrl} after ${maxAttempts} attempts`);
    }

    webrtcStreamName(id: string): string {
        return `${this.sanitizeName(id)}_webrtc`;
    }

    /** Re-register all known camera streams in go2rtc and drop stale entries. */
    async syncAllStreams(): Promise<void> {
        for (const [id, source] of this.sources) {
            await this.addStream(id, source.name, source.rtspUrl);
        }
        await this.pruneOrphanStreams();
    }

    /** Remove go2rtc streams that are not registered cameras (e.g. after camera delete). */
    async pruneOrphanStreams(): Promise<string[]> {
        const allowed = this.#expectedStreamNames();
        const present = await this.#listGo2rtcStreamNames();
        const orphans = present.filter(name => !allowed.has(name));

        for (const name of orphans) {
            if (await this.#deleteStreamByName(name)) {
                logger.info(`Removed orphan go2rtc stream: ${name}`);
            } else {
                logger.warn(`Could not remove orphan go2rtc stream: ${name}`);
            }
        }

        if (orphans.length > 0) {
            logger.info(`Pruned ${orphans.length} orphan go2rtc stream(s)`);
        }

        return orphans;
    }

    /** Periodically drop streams that no longer match cameras.json. */
    startPeriodicPrune(intervalMs = DEFAULT_PRUNE_INTERVAL_MS): void {
        if (this.pruneTimer) return;

        this.pruneTimer = setInterval(() => {
            this.pruneOrphanStreams().catch(error => {
                logger.warn(`Periodic go2rtc prune failed: ${error}`);
            });
        }, intervalMs);

        logger.info(`go2rtc orphan prune scheduled every ${Math.round(intervalMs / 1000)}s`);
    }

    /**
     * Start ffmpeg H.264 transcode before the hub opens live view (cold start can exceed 5s).
     */
    async prewarmWebRtc(streamId: string, timeoutMs = 30_000): Promise<void> {
        const webrtcName = this.webrtcStreamName(streamId);
        const source = this.sources.get(streamId);
        logger.info(`Pre-warming WebRTC stream ${webrtcName}${source ? ` (${source.name})` : ''}`);

        const started = Date.now();
        await this.#withLock(streamId, async () => {
            await this.ensureStream(streamId);
            const params = new URLSearchParams({ src: webrtcName, width: '320', height: '180' });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(`${this.baseUrl}/api/frame.jpeg?${params}`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`prewarm failed (${response.status}): ${body || response.statusText}`);
                }
                const bytes = (await response.arrayBuffer()).byteLength;
                logger.info(`WebRTC pre-warm ${webrtcName} ok ${bytes}B in ${Date.now() - started}ms`);
                this.prewarmAt.set(streamId, Date.now());
            } finally {
                clearTimeout(timer);
            }
        });
    }

    /** Warm ffmpeg if the hub has not opened live view recently (avoids first-attempt timeouts). */
    async prewarmWebRtcIfStale(streamId: string): Promise<void> {
        const last = this.prewarmAt.get(streamId) ?? 0;
        if (Date.now() - last < PREWARM_MAX_AGE_MS) {
            return;
        }
        await this.prewarmWebRtc(streamId);
    }

    /** Drop an active WebRTC consumer/ffmpeg producer before a hub retry on the same camera. */
    async recycleWebRtcStream(streamId: string): Promise<void> {
        await this.#withLock(streamId, () => this.#recycleWebRtcStreamUnlocked(streamId));
    }

    shouldRecycleCompactHub(streamId: string): boolean {
        const last = this.compactHubOfferAt.get(streamId) ?? 0;
        return Date.now() - last < Go2RTCClient.COMPACT_HUB_RECYCLE_MS;
    }

    markCompactHubOffer(streamId: string): void {
        this.compactHubOfferAt.set(streamId, Date.now());
    }

    /** Pre-warm all registered cameras (sequential — avoids RTSP connection bursts on NVRs). */
    async prewarmAllWebRtc(): Promise<void> {
        for (const id of this.sources.keys()) {
            try {
                await this.prewarmWebRtc(id);
            } catch (error) {
                logger.warn(`WebRTC pre-warm failed for ${id}: ${error}`);
            }
        }
    }

    async ensureStream(id: string, name?: string, rtspUrl?: string): Promise<void> {
        const streamName = this.sanitizeName(id);
        const webrtcName = this.webrtcStreamName(id);
        if (await this.#streamExists(streamName) && await this.#streamExists(webrtcName)) {
            return;
        }

        const source = this.sources.get(id);
        const resolvedName = name ?? source?.name ?? id;
        const resolvedUrl = rtspUrl ?? source?.rtspUrl;
        if (!resolvedUrl) {
            throw new Error(`No RTSP URL registered for stream ${id}`);
        }

        logger.info(`Re-registering go2rtc stream ${streamName}`);
        await this.addStream(id, resolvedName, resolvedUrl);

        if (!(await this.#streamExists(streamName)) || !(await this.#streamExists(this.webrtcStreamName(id)))) {
            throw new Error(`go2rtc streams for ${streamName} not found after registration`);
        }
    }

    async addStream(id: string, _name: string, rtspUrl: string): Promise<void> {
        const streamName = this.sanitizeName(id);
        const webrtcName = this.webrtcStreamName(id);
        this.registerSource(id, _name, rtspUrl);

        const transform = this.getImageTransform(id);
        const entries: Array<{ name: string; src: string }> = [
            { name: streamName, src: this.#snapshotSrc(rtspUrl, transform) },
            { name: webrtcName, src: this.#webrtcSrc(rtspUrl, transform) },
        ];

        for (const { name, src } of entries) {
            await this.#putStream(name, src);
        }

        logger.info(`Streams ${streamName} + ${webrtcName} added to go2rtc`);
    }

    async #putStream(name: string, src: string): Promise<void> {
        const params = new URLSearchParams({ src, name });
        try {
            const response = await fetch(`${this.baseUrl}/api/streams?${params.toString()}`, {
                method: 'PUT',
            });

            if (!response.ok && response.status !== 400) {
                const body = redactRtspInText(await response.text().catch(() => ''));
                logger.error(`Failed to add stream ${name}: ${response.status} ${body || response.statusText}`);
            }
        } catch (error) {
            logger.error('Error connecting to go2rtc:', error);
            throw error;
        }
    }

    async #refreshStreamSources(id: string): Promise<void> {
        const source = this.sources.get(id);
        if (!source) return;

        const streamName = this.sanitizeName(id);
        const webrtcName = this.webrtcStreamName(id);
        const transform = this.getImageTransform(id);

        await this.#deleteStreamByName(streamName);
        await this.#deleteStreamByName(webrtcName);
        await this.#putStream(streamName, this.#snapshotSrc(source.rtspUrl, transform));
        await this.#putStream(webrtcName, this.#webrtcSrc(source.rtspUrl, transform));

        this.prewarmAt.delete(id);
        logger.info(
            `ImageControl applied camera=${id} flipH=${transform.flipHorizontal} `
            + `flipV=${transform.flipVertical} rot=${transform.rotationDegrees}`,
        );
    }

    async removeStream(id: string): Promise<void> {
        this.unregisterSource(id);
        this.imageTransforms.delete(id);
        const names = [this.sanitizeName(id), this.webrtcStreamName(id)];

        for (const name of names) {
            await this.#deleteStreamByName(name);
        }

        await this.pruneOrphanStreams();
    }

    /**
     * Fetch a JPEG snapshot from go2rtc (RTSP frame grab).
     * Serialized per camera so motion polls and hub CaptureSnapshot do not race the same RTSP source.
     */
    async captureFrame(streamId: string, maxWidth?: number, maxHeight?: number): Promise<Uint8Array> {
        return this.#withLock(streamId, () => this.#captureFrameUnlocked(streamId, maxWidth, maxHeight));
    }

    async #captureFrameUnlocked(streamId: string, maxWidth?: number, maxHeight?: number): Promise<Uint8Array> {
        if (!this.sources.has(streamId)) {
            throw new Error(`no go2rtc stream registered for ${streamId}`);
        }

        await this.ensureStream(streamId);

        const streamName = this.sanitizeName(streamId);
        const params = new URLSearchParams({ src: streamName });
        if (maxWidth) params.set('width', String(maxWidth));
        if (maxHeight) params.set('height', String(maxHeight));

        const fetchFrame = async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FRAME_CAPTURE_TIMEOUT_MS);
            try {
                const response = await fetch(`${this.baseUrl}/api/frame.jpeg?${params}`, {
                    signal: controller.signal,
                });
                if (response.status === 404) {
                    await this.ensureStream(streamId);
                    const retry = await fetch(`${this.baseUrl}/api/frame.jpeg?${params}`, {
                        signal: controller.signal,
                    });
                    if (!retry.ok) {
                        const body = await retry.text().catch(() => '');
                        throw new Error(`go2rtc frame capture failed (${retry.status}): ${body || retry.statusText}`);
                    }
                    return new Uint8Array(await retry.arrayBuffer());
                }

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`go2rtc frame capture failed (${response.status}): ${body || response.statusText}`);
                }

                return new Uint8Array(await response.arrayBuffer());
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error(`go2rtc frame capture timed out after ${FRAME_CAPTURE_TIMEOUT_MS}ms`);
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        };

        return fetchFrame();
    }

    /**
     * Exchange SDP offer with go2rtc.
     * Hub TURN/STUN uses WebSocket API — HTTP JSON ignores ice_servers in go2rtc.
     */
    async exchangeWebRtcOffer(
        streamId: string,
        offerSdp: string,
        iceServers?: Go2RtcIceServer[],
        retried = false,
        opts?: { recycle?: boolean },
    ): Promise<WebRtcExchangeResult> {
        return this.#withLock(streamId, async () => {
            if (opts?.recycle) {
                await this.#recycleWebRtcStreamUnlocked(streamId);
            }
            await this.ensureStream(streamId);

            const streamName = this.webrtcStreamName(streamId);
            const source = this.sources.get(streamId);

            try {
                if (iceServers?.length) {
                    const normalized = this.#normalizeIceServers(iceServers);
                    const answerSdp = await this.#exchangeWebRtcViaWebSocket(streamName, offerSdp, normalized);
                    const relayCount = (answerSdp.match(/ typ relay /g) ?? []).length;
                    logger.info(
                        `go2rtc WebRTC answer camera=${streamId} mode=ws sdp=${answerSdp.length}ch `
                        + `iceServers=${normalized.length} relay=${relayCount}`,
                    );
                    return { answerSdp };
                }

                const url = `${this.baseUrl}/api/webrtc?src=${encodeURIComponent(streamName)}`;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), WEBRTC_EXCHANGE_TIMEOUT_MS);
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
                    body: offerSdp,
                    signal: controller.signal,
                }).finally(() => clearTimeout(timer));

                if (response.status === 404 && !retried) {
                    await this.ensureStream(streamId);
                    return this.exchangeWebRtcOffer(streamId, offerSdp, iceServers, true);
                }

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(
                        `go2rtc WebRTC failed camera=${streamId}${source ? ` (${source.name})` : ''} `
                        + `mode=whep (${response.status}): ${body || response.statusText}`,
                    );
                }

                const whepLocation = response.headers.get('location') ?? undefined;
                const whepEtag = response.headers.get('etag') ?? undefined;
                const answerSdp = await this.#parseAnswerSdp(response);
                const relayCount = (answerSdp.match(/ typ relay /g) ?? []).length;

                logger.info(
                    `go2rtc WebRTC answer camera=${streamId} mode=whep sdp=${answerSdp.length}ch `
                    + `relay=${relayCount} whep=${whepLocation ? 'yes' : 'no'}`,
                );

                return { answerSdp, whepLocation, whepEtag };
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error(`go2rtc WebRTC timed out camera=${streamId} after ${WEBRTC_EXCHANGE_TIMEOUT_MS}ms`);
                }
                if (!retried) {
                    await this.ensureStream(streamId);
                    return this.exchangeWebRtcOffer(streamId, offerSdp, iceServers, true);
                }
                throw error;
            }
        });
    }

    /** Close an active go2rtc WHEP session (best-effort). */
    async closeWebRtcSession(sessionUrl: string): Promise<void> {
        const url = sessionUrl.startsWith('http') ? sessionUrl : `${this.baseUrl}${sessionUrl}`;
        try {
            const response = await fetch(url, { method: 'DELETE' });
            if (response.ok) {
                logger.info('go2rtc WebRTC session closed');
            }
        } catch (error) {
            logger.warn(`go2rtc WebRTC session close failed: ${error}`);
        }
    }

    /** Forward trickle ICE candidates to an active go2rtc WHEP session. */
    async trickleIceCandidates(sessionUrl: string, etag: string, sdpFrag: string): Promise<string | undefined> {
        const url = sessionUrl.startsWith('http') ? sessionUrl : `${this.baseUrl}${sessionUrl}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/trickle-ice-sdpfrag',
                'If-Match': etag,
            },
            body: sdpFrag,
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`go2rtc ICE trickle failed (${response.status}): ${body || response.statusText}`);
        }

        return response.headers.get('etag') ?? etag;
    }

    #expectedStreamNames(): Set<string> {
        const names = new Set<string>();
        for (const id of this.sources.keys()) {
            names.add(this.sanitizeName(id));
            names.add(this.webrtcStreamName(id));
        }
        return names;
    }

    async #listGo2rtcStreamNames(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/streams`);
            if (!response.ok) return [];
            const streams = await response.json() as Record<string, unknown>;
            return Object.keys(streams);
        } catch {
            return [];
        }
    }

    async #deleteStreamByName(streamName: string): Promise<boolean> {
        // go2rtc DELETE uses `src` (stream name); may return 400 if config is read-only but still drops in-memory.
        const params = new URLSearchParams({ src: streamName });
        try {
            const response = await fetch(`${this.baseUrl}/api/streams?${params.toString()}`, {
                method: 'DELETE',
            });
            if (response.ok || response.status === 404) {
                return true;
            }
            const body = await response.text().catch(() => '');
            if (response.status === 400 && body.includes('read-only')) {
                return !(await this.#streamExists(streamName));
            }
            logger.warn(`Failed to remove go2rtc stream ${streamName}: ${response.status} ${body}`);
        } catch (error) {
            logger.warn(`Error removing go2rtc stream ${streamName}: ${error}`);
        }
        return false;
    }

    async #streamExists(streamName: string): Promise<boolean> {
        const names = await this.#listGo2rtcStreamNames();
        return names.includes(streamName);
    }

    async #parseAnswerSdp(response: Response): Promise<string> {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            const json = (await response.json()) as { sdp?: string };
            if (!json.sdp) throw new Error('go2rtc returned JSON without sdp field');
            return json.sdp;
        }
        return await response.text();
    }

    private sanitizeName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    }

    #snapshotSrc(rtspUrl: string, transform: ImageTransform): string {
        return buildFfmpegSrc(rtspUrl, transform, { audio: false });
    }

    #webrtcSrc(rtspUrl: string, transform: ImageTransform): string {
        return buildFfmpegSrc(rtspUrl, transform, { audio: true });
    }

    #normalizeIceServers(iceServers: Go2RtcIceServer[]): Go2RtcIceServer[] {
        return iceServers.map(server => ({
            urls: server.urls.flatMap(url => (url.includes(',') ? url.split(',') : [url])).map(u => u.trim()).filter(Boolean),
            username: server.username,
            credential: server.credential,
        })).filter(s => s.urls.length > 0);
    }

    /**
     * go2rtc WebSocket handler honors ice_servers; HTTP POST application/json does not.
     */
    async #exchangeWebRtcViaWebSocket(
        streamName: string,
        offerSdp: string,
        iceServers: Go2RtcIceServer[],
    ): Promise<string> {
        const wsBase = this.baseUrl.replace(/^http/i, 'ws');
        const wsUrl = `${wsBase}/api/ws?src=${encodeURIComponent(streamName)}`;

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            const trickleCandidates: string[] = [];
            let answerSdp = '';
            let settled = false;
            let quietTimer: ReturnType<typeof setTimeout> | undefined;
            let hardTimer: ReturnType<typeof setTimeout>;

            const cleanup = () => {
                clearTimeout(hardTimer);
                if (quietTimer) clearTimeout(quietTimer);
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
            };

            const finish = () => {
                if (settled) return;
                settled = true;
                cleanup();
                if (!answerSdp) {
                    reject(new Error('go2rtc WebSocket closed without SDP answer'));
                    return;
                }
                resolve(appendTrickleCandidatesToSdp(answerSdp, trickleCandidates));
            };

            const bumpQuietTimer = () => {
                if (quietTimer) clearTimeout(quietTimer);
                quietTimer = setTimeout(finish, WS_ICE_QUIET_MS);
            };

            hardTimer = setTimeout(() => {
                if (answerSdp) {
                    finish();
                } else {
                    settled = true;
                    cleanup();
                    reject(new Error(`go2rtc WebSocket ICE exchange timeout (${WS_ICE_GATHER_MS}ms)`));
                }
            }, WS_ICE_GATHER_MS);

            ws.addEventListener('open', () => {
                ws.send(JSON.stringify({
                    type: 'webrtc',
                    value: {
                        type: 'offer',
                        sdp: offerSdp,
                        ice_servers: iceServers,
                    },
                }));
            });

            ws.addEventListener('message', event => {
                let msg: { type?: string; value?: unknown };
                try {
                    msg = JSON.parse(String(event.data)) as { type?: string; value?: unknown };
                } catch {
                    return;
                }

                if (msg.type === 'webrtc') {
                    const desc = msg.value as { type?: string; sdp?: string };
                    if (desc?.type === 'answer' && desc.sdp) {
                        answerSdp = desc.sdp;
                        bumpQuietTimer();
                    }
                } else if (msg.type === 'webrtc/answer' && typeof msg.value === 'string') {
                    answerSdp = msg.value;
                    bumpQuietTimer();
                } else if (msg.type === 'webrtc/candidate' && typeof msg.value === 'string' && msg.value) {
                    trickleCandidates.push(msg.value);
                    bumpQuietTimer();
                }
            });

            ws.addEventListener('error', () => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    reject(new Error('go2rtc WebSocket connection failed'));
                }
            });

            ws.addEventListener('close', () => {
                if (!settled && answerSdp) {
                    finish();
                }
            });
        });
    }

    async #recycleWebRtcStreamUnlocked(streamId: string): Promise<void> {
        const source = this.sources.get(streamId);
        if (!source) return;

        const webrtcName = this.webrtcStreamName(streamId);
        await this.#deleteStreamByName(webrtcName);
        const transform = this.getImageTransform(streamId);
        await this.#putStream(webrtcName, this.#webrtcSrc(source.rtspUrl, transform));
        this.prewarmAt.delete(streamId);
        logger.info(`Recycled go2rtc WebRTC stream ${webrtcName}`);
    }

    async #withLock<T>(streamId: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.locks.get(streamId) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        this.locks.set(streamId, prev.then(() => gate));
        await prev;
        try {
            return await fn();
        } finally {
            release();
        }
    }
}
