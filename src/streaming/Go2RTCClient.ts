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

export class Go2RTCClient {
    private baseUrl: string;
    private sources = new Map<string, StreamSource>();

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

    /** Re-register all known camera streams in go2rtc. */
    async syncAllStreams(): Promise<void> {
        for (const [id, source] of this.sources) {
            await this.addStream(id, source.name, source.rtspUrl);
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
        const streamName = this.sanitizeName(id);
        this.unregisterSource(id);
        const params = new URLSearchParams({ name: streamName });

        try {
            const response = await fetch(`${this.baseUrl}/api/streams?${params.toString()}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                logger.error(`Failed to remove stream ${streamName}: ${response.status} ${response.statusText}`);
            } else {
                logger.info(`Stream ${streamName} removed from go2rtc`);
            }
        } catch (error) {
            logger.error('Error connecting to go2rtc:', error);
        }
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
     * Exchange SDP offer with go2rtc (WHEP/JSON). Passes hub TURN/STUN when provided.
     */
    async exchangeWebRtcOffer(
        streamId: string,
        offerSdp: string,
        iceServers?: Go2RtcIceServer[],
        retried = false,
    ): Promise<WebRtcExchangeResult> {
        await this.ensureStream(streamId);

        const streamName = this.webrtcStreamName(streamId);
        const url = `${this.baseUrl}/api/webrtc?src=${encodeURIComponent(streamName)}`;

        // WHEP (application/sdp) gives Location/ETag for ICE trickle; pass TURN via Link headers.
        const whepHeaders: Record<string, string> = {
            'Content-Type': 'application/sdp',
            Accept: 'application/sdp',
            ...this.#iceServerLinkHeaders(iceServers),
        };

        let response = await fetch(url, { method: 'POST', headers: whepHeaders, body: offerSdp });

        if (!response.ok && iceServers?.length) {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ type: 'offer', sdp: offerSdp, ice_servers: iceServers }),
            });
        }

        if (response.status === 404 && !retried) {
            await this.ensureStream(streamId);
            return this.exchangeWebRtcOffer(streamId, offerSdp, iceServers, true);
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`go2rtc WebRTC failed (${response.status}): ${body || response.statusText}`);
        }

        const whepLocation = response.headers.get('location') ?? undefined;
        const whepEtag = response.headers.get('etag') ?? undefined;
        const answerSdp = await this.#parseAnswerSdp(response);

        logger.info(
            `go2rtc WebRTC answer sdp=${answerSdp.length}ch iceServers=${iceServers?.length ?? 0} whep=${whepLocation ? 'yes' : 'no'}`,
        );

        return { answerSdp, whepLocation, whepEtag };
    }

    #iceServerLinkHeaders(iceServers?: Go2RtcIceServer[]): Record<string, string> {
        if (!iceServers?.length) return {};

        const links = iceServers.flatMap(server =>
            server.urls.map(turnUrl => {
                const parts = [`<${turnUrl}>`, 'rel="ice-server"'];
                if (server.username) parts.push(`username="${server.username}"`);
                if (server.credential) parts.push(`credential="${server.credential}"`);
                return parts.join('; ');
            }),
        );

        return links.length ? { Link: links.join(', ') } : {};
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

    async #streamExists(streamName: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/streams`);
            if (!response.ok) return false;
            const streams = await response.json() as Record<string, unknown>;
            return streamName in streams;
        } catch {
            return false;
        }
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
}
