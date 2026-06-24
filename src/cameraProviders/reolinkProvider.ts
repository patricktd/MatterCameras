import type { Camera } from '../types/index.js';
import { ReolinkClient } from '../motion/providers/reolink/reolinkClient.js';
import { injectRtspCredentials, redactRtspUrl } from '../utils/redactRtspUrl.js';
import type { CameraAddProvider, DiscoveredCameraDevice } from './types.js';

function reolinkRtspPath(channel: number, sub = false): string {
    const idx = String(channel + 1).padStart(2, '0');
    return sub ? `h264Preview_${idx}_sub` : `h264Preview_${idx}_main`;
}

function isReolinkAlreadyAdded(cameras: Camera[], host: string, channel: number): boolean {
    const hostKey = host.toLowerCase();
    return cameras.some(cam => {
        if ((cam.reolinkChannel ?? 0) !== channel) return false;
        try {
            return new URL(cam.rtspUrl).hostname.toLowerCase() === hostKey;
        } catch {
            return false;
        }
    });
}

async function fetchReolinkDeviceName(host: string, username: string, password: string): Promise<{
    name?: string;
    model?: string;
    channelCount?: number;
}> {
    const client = new ReolinkClient(host, username, password);
    await client.ensureAuth();

    const url = new URL(`http://${host}/api.cgi`);
    url.searchParams.set('cmd', 'GetDevInfo');
    url.searchParams.set('user', username);
    url.searchParams.set('password', password);

    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
        throw new Error(`Reolink HTTP ${response.status}`);
    }

    const body = await response.json() as Array<{ value?: Record<string, unknown> }>;
    const value = body[0]?.value ?? {};
    const deviceName = typeof value.deviceName === 'string' ? value.deviceName : undefined;
    const model = typeof value.model === 'string' ? value.model : undefined;
    const channelCount = typeof value.channelCount === 'number' ? value.channelCount : 1;

    return { name: deviceName, model, channelCount: Math.max(1, channelCount) };
}

export const reolinkProvider: CameraAddProvider = {
    meta: {
        id: 'reolink',
        label: 'Reolink',
        description: 'Connect with camera or NVR IP and credentials — RTSP path is built automatically.',
        discoverable: true,
    },

    async discover(ctx, cameras): Promise<DiscoveredCameraDevice[]> {
        const host = String(ctx.host ?? '').trim();
        const username = String(ctx.username ?? '').trim();
        const password = String(ctx.password ?? '');

        if (!host || !username) {
            throw new Error('host and username are required');
        }

        const info = await fetchReolinkDeviceName(host, username, password);
        const channelCount = info.channelCount ?? 1;
        const out: DiscoveredCameraDevice[] = [];

        for (let channel = 0; channel < channelCount; channel++) {
            if (isReolinkAlreadyAdded(cameras as Camera[], host, channel)) continue;
            const label = channelCount > 1
                ? `${info.name || host} — channel ${channel + 1}`
                : (info.name || host);
            out.push({
                id: String(channel),
                label,
                detail: [info.model, `channel ${channel + 1}`].filter(Boolean).join(' · '),
                payload: { host, channel },
            });
        }

        return out;
    },

    async resolve(ctx) {
        const host = String(ctx.payload?.host ?? ctx.host ?? '').trim();
        const channel = Number(ctx.payload?.channel ?? ctx.channel ?? ctx.deviceId) || 0;
        const username = String(ctx.username ?? '').trim();
        const password = String(ctx.password ?? '');

        if (!host || !username) {
            throw new Error('host and username are required');
        }

        const info = await fetchReolinkDeviceName(host, username, password);
        const path = reolinkRtspPath(channel, false);
        const rtspUrl = injectRtspCredentials(`rtsp://${host}:554/${path}`, username, password);

        const name = (info.channelCount ?? 1) > 1
            ? `${info.name || host} Ch${channel + 1}`
            : (info.name || host);

        return {
            name,
            rtspUrl,
            rtspUrlRedacted: redactRtspUrl(rtspUrl),
            addSource: 'reolink',
            manufacturer: 'Reolink',
            model: info.model,
            username,
            password: password || undefined,
            reolinkChannel: channel,
            suggestedMotionSource: 'auto',
            suggestedMotionReason: 'reolink-native — native api.cgi preferred over ONVIF',
        };
    },
};
