import type { Camera } from '../types/index.js';
import { resolveOnvifCamera } from '../onvif/connectCamera.js';
import type { CameraAddProvider, DiscoveredCameraDevice } from './types.js';

const DEFAULT_PORT = 2020;
const DEFAULT_PATH = '/onvif/device_service';

function isDirectOnvifAdded(cameras: Camera[], hostname: string, port: number): boolean {
    const hostKey = hostname.toLowerCase();
    const endpointKey = `${hostKey}:${port}`;

    for (const cam of cameras) {
        if (cam.onvifUrl) {
            try {
                const parsed = new URL(cam.onvifUrl);
                const p = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
                if (`${parsed.hostname.toLowerCase()}:${p}` === endpointKey) return true;
            } catch {
                // ignore
            }
        }
        try {
            if (new URL(cam.rtspUrl).hostname.toLowerCase() === hostKey) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

export const tapoSonoffProvider: CameraAddProvider = {
    meta: {
        id: 'tapo-sonoff',
        label: 'Tapo / Sonoff',
        description: 'Connect by camera IP — ONVIF on port 2020 (Tapo Camera Account credentials).',
        discoverable: true,
    },

    async discover(ctx, cameras): Promise<DiscoveredCameraDevice[]> {
        const hostname = String(ctx.host ?? '').trim();
        const port = DEFAULT_PORT;

        if (!hostname) {
            throw new Error('camera IP / hostname is required');
        }

        if (isDirectOnvifAdded(cameras as Camera[], hostname, port)) {
            return [];
        }

        return [{
            id: hostname,
            label: hostname,
            detail: `ONVIF :${port} — use Tapo/Sonoff Camera Account (not cloud password)`,
            payload: { hostname, port, path: DEFAULT_PATH },
        }];
    },

    async resolve(ctx) {
        const hostname = String(ctx.payload?.hostname ?? ctx.host ?? ctx.deviceId ?? '').trim();
        const port = Number(ctx.payload?.port ?? ctx.port) || DEFAULT_PORT;
        const path = String(ctx.payload?.path ?? ctx.path ?? DEFAULT_PATH).trim();
        const username = String(ctx.username ?? '').trim();
        const password = String(ctx.password ?? '');

        if (!hostname || !username) {
            throw new Error('hostname and Camera Account username are required');
        }

        const resolved = await resolveOnvifCamera({ hostname, port, path, username, password });
        return {
            name: resolved.name,
            rtspUrl: resolved.rtspUrl,
            rtspUrlRedacted: resolved.rtspUrlRedacted,
            addSource: 'tapo-sonoff',
            manufacturer: resolved.manufacturer,
            model: resolved.model,
            username,
            password: password || undefined,
            onvifUrl: resolved.onvifUrl,
            suggestedMotionSource: resolved.suggestedMotionSource,
            suggestedMotionReason: `${resolved.suggestedMotionProvider} — ${resolved.suggestedMotionReason}`,
        };
    },
};
