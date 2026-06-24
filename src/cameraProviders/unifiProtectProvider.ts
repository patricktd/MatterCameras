import type { Camera } from '../types/index.js';
import {
    connectProtect,
    draftFromProtectCamera,
    listProtectCameras,
    logoutProtect,
    type ProtectCameraRow,
} from './unifi/protectApi.js';
import { resolveProtectCredentials } from './resolveControllerCreds.js';
import type { CameraAddProvider, DiscoveredCameraDevice } from './types.js';

function isProtectCameraAdded(cameras: Camera[], host: string, cameraId: string): boolean {
    const hostKey = host.toLowerCase();
    return cameras.some(
        cam => cam.protectCameraId === cameraId && cam.protectHost?.toLowerCase() === hostKey,
    );
}

function toDiscoveredDevice(host: string, camera: ProtectCameraRow): DiscoveredCameraDevice {
    const channel = camera.channels?.find(ch => ch.rtspAlias);
    const detail = [
        camera.type,
        channel?.name,
        camera.isConnected === false ? 'offline' : undefined,
    ].filter(Boolean).join(' · ');

    return {
        id: camera.id,
        label: camera.name,
        detail: detail || camera.id,
        payload: { host, cameraId: camera.id },
    };
}

export const unifiProtectProvider: CameraAddProvider = {
    meta: {
        id: 'unifi-protect',
        label: 'UniFi Protect',
        description: 'Log in to your Protect controller and pick adopted cameras — RTSP is filled automatically.',
        discoverable: true,
    },

    async discover(ctx, cameras): Promise<DiscoveredCameraDevice[]> {
        const creds = resolveProtectCredentials(ctx);
        const api = await connectProtect(creds.host, creds.username, creds.password);

        try {
            const out: DiscoveredCameraDevice[] = [];
            for (const camera of listProtectCameras(api)) {
                if (!camera.isAdopted || camera.isAdoptedByOther) continue;
                if (isProtectCameraAdded(cameras as Camera[], creds.host, camera.id)) continue;
                out.push(toDiscoveredDevice(creds.host, camera));
            }
            out.sort((a, b) => a.label.localeCompare(b.label));
            return out;
        } finally {
            logoutProtect(api);
        }
    },

    async resolve(ctx) {
        const creds = resolveProtectCredentials(ctx);
        const cameraId = String(ctx.payload?.cameraId ?? ctx.deviceId ?? '').trim();
        const host = String(ctx.payload?.host ?? creds.host).trim();

        if (!cameraId) {
            throw new Error('camera id is required');
        }

        const api = await connectProtect(host, creds.username, creds.password);
        try {
            const camera = listProtectCameras(api).find(c => c.id === cameraId);
            if (!camera) {
                throw new Error('Camera not found on Protect controller');
            }
            return draftFromProtectCamera(host, camera, creds.username, creds.password);
        } finally {
            logoutProtect(api);
        }
    },
};
