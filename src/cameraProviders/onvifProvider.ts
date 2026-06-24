import { filterNewOnvifDevices, probeOnvifDevices } from '../onvif/discovery.js';
import { resolveOnvifCamera } from '../onvif/connectCamera.js';
import type { Camera } from '../types/index.js';
import type { CameraAddProvider, DiscoveredCameraDevice } from './types.js';

export const onvifProvider: CameraAddProvider = {
    meta: {
        id: 'onvif',
        label: 'ONVIF',
        description: 'Scan the LAN (UDP 3702) or connect to a known ONVIF endpoint.',
        discoverable: true,
    },

    async discover(ctx, cameras): Promise<DiscoveredCameraDevice[]> {
        const raw = Number(ctx.timeoutMs);
        const timeoutMs = Number.isFinite(raw) ? Math.min(15_000, Math.max(2_000, raw)) : 5_000;
        const all = await probeOnvifDevices(timeoutMs);
        const devices = filterNewOnvifDevices(all, cameras as Camera[]);
        return devices.map(device => ({
            id: device.urn,
            label: device.label || device.hostname,
            detail: `${device.hostname}:${device.port}${device.path}`,
            payload: {
                hostname: device.hostname,
                port: device.port,
                path: device.path,
            },
        }));
    },

    async resolve(ctx) {
        const hostname = String(ctx.payload?.hostname ?? ctx.host ?? '').trim();
        const port = Number(ctx.payload?.port ?? ctx.port) || 80;
        const path = String(ctx.payload?.path ?? ctx.path ?? '/onvif/device_service').trim();
        const username = String(ctx.username ?? '').trim();
        const password = String(ctx.password ?? '');

        if (!hostname || !username) {
            throw new Error('hostname and username are required');
        }

        const resolved = await resolveOnvifCamera({ hostname, port, path, username, password });
        return {
            name: resolved.name,
            rtspUrl: resolved.rtspUrl,
            rtspUrlRedacted: resolved.rtspUrlRedacted,
            addSource: 'onvif',
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
