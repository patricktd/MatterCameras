import { Logger } from '@matter/general';

const logger = Logger.get('Go2RTCClient');

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

export class Go2RTCClient {
    private baseUrl: string;
    private sources = new Map<string, StreamSource>();
    /** Serialize ffmpeg-heavy ops per camera to avoid starving the other stream. */
    private readonly locks = new Map<string, Promise<void>>();
    private pruneTimer?: ReturnType<typeof setInterval>;

    constructor(baseUrl: string = 'http://127.0.0.1:3203') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    registerSource(id: string, name: string, rtspUrl: string): void {
        this.sources.set(id, { name, rtspUrl });
    }

    unregisterSource(id: string): void {
        this.sources.delete(id);
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
            } finally {
                clearTimeout(timer);
            }
        });
    }

    /** Pre-warm all registered cameras (parallel). */
    async prewarmAllWebRtc(): Promise<void> {
        const ids = [...this.sources.keys()];
        const results = await Promise.allSettled(ids.map(id => this.prewarmWebRtc(id)));
        for (let i = 0; i < ids.length; i++) {
            const result = results[i];
            if (result.status === 'rejected') {
                logger.warn(`WebRTC pre-warm failed for ${ids[i]}: ${result.reason}`);
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

        const entries: Array<{ name: string; src: string }> = [
            { name: streamName, src: rtspUrl },
            { name: webrtcName, src: this.#toH264Src(rtspUrl) },
        ];

        for (const { name, src } of entries) {
            const params = new URLSearchParams({ src, name });
            try {
                const response = await fetch(`${this.baseUrl}/api/streams?${params.toString()}`, {
                    method: 'PUT',
                });

                if (!response.ok && response.status !== 400) {
                    const body = await response.text().catch(() => '');
                    logger.error(`Failed to add stream ${name}: ${response.status} ${body || response.statusText}`);
                }
            } catch (error) {
                logger.error('Error connecting to go2rtc:', error);
                throw error;
            }
        }

        logger.info(`Streams ${streamName} + ${webrtcName} added to go2rtc`);
    }

    async removeStream(id: string): Promise<void> {
        this.unregisterSource(id);
        const names = [this.sanitizeName(id), this.webrtcStreamName(id)];

        for (const name of names) {
            await this.#deleteStreamByName(name);
        }

        await this.pruneOrphanStreams();
    }

    /** Fetch a JPEG snapshot from go2rtc (RTSP frame grab). */
    async captureFrame(streamId: string, width?: number, height?: number): Promise<Uint8Array> {
        await this.ensureStream(streamId);

        const streamName = this.sanitizeName(streamId);
        const params = new URLSearchParams({ src: streamName });
        if (width) params.set('width', String(width));
        if (height) params.set('height', String(height));

        const response = await fetch(`${this.baseUrl}/api/frame.jpeg?${params}`);
        if (response.status === 404) {
            await this.ensureStream(streamId);
            const retry = await fetch(`${this.baseUrl}/api/frame.jpeg?${params}`);
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
    }

    /**
     * Exchange SDP offer with go2rtc. Hub TURN/STUN uses JSON API (go2rtc WHEP often omits Location).
     */
    async exchangeWebRtcOffer(
        streamId: string,
        offerSdp: string,
        iceServers?: Go2RtcIceServer[],
        retried = false,
    ): Promise<WebRtcExchangeResult> {
        return this.#withLock(streamId, async () => {
            await this.ensureStream(streamId);

            const streamName = this.webrtcStreamName(streamId);
            const url = `${this.baseUrl}/api/webrtc?src=${encodeURIComponent(streamName)}`;
            const source = this.sources.get(streamId);

            let response: Response;
            let mode: 'json' | 'whep';

            if (iceServers?.length) {
                mode = 'json';
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ type: 'offer', sdp: offerSdp, ice_servers: iceServers }),
                });
            } else {
                mode = 'whep';
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
                    body: offerSdp,
                });
            }

            if (response.status === 404 && !retried) {
                await this.ensureStream(streamId);
                return this.exchangeWebRtcOffer(streamId, offerSdp, iceServers, true);
            }

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(
                    `go2rtc WebRTC failed camera=${streamId}${source ? ` (${source.name})` : ''} `
                    + `mode=${mode} (${response.status}): ${body || response.statusText}`,
                );
            }

            const whepLocation = response.headers.get('location') ?? undefined;
            const whepEtag = response.headers.get('etag') ?? undefined;
            const answerSdp = await this.#parseAnswerSdp(response);
            const relayCount = (answerSdp.match(/ typ relay /g) ?? []).length;

            logger.info(
                `go2rtc WebRTC answer camera=${streamId} mode=${mode} sdp=${answerSdp.length}ch `
                + `iceServers=${iceServers?.length ?? 0} relay=${relayCount} whep=${whepLocation ? 'yes' : 'no'}`,
            );

            return { answerSdp, whepLocation, whepEtag };
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

    /** Matter advertises H.264; transcode H.265/HEVC RTSP sources via ffmpeg. */
    #toH264Src(rtspUrl: string): string {
        if (rtspUrl.startsWith('ffmpeg:')) {
            return rtspUrl;
        }
        return `ffmpeg:${rtspUrl}#video=h264`;
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
