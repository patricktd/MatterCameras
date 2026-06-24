import type { Camera } from '../../../types/index.js';
import { settings } from '../../../storage/settings.js';

export interface ProtectTarget {
    host: string;
    username: string;
    password: string;
    cameraId: string;
}

export function resolveProtectTarget(camera: Camera): ProtectTarget | null {
    const host = camera.protectHost?.trim();
    const cameraId = camera.protectCameraId?.trim();
    if (!host || !cameraId) return null;

    let username = camera.username ?? '';
    let password = camera.password ?? '';

    if (!username) {
        const saved = settings.getProtectController();
        if (saved && saved.host.toLowerCase() === host.toLowerCase()) {
            username = saved.username;
            password = saved.password;
        }
    }

    if (!username) {
        try {
            const parsed = new URL(camera.rtspUrl);
            if (parsed.username) username = decodeURIComponent(parsed.username);
            if (parsed.password) password = decodeURIComponent(parsed.password);
        } catch {
            // ignore
        }
    }

    if (!username) return null;

    return { host, username, password, cameraId };
}

export function cameraLooksLikeUnifi(camera: Camera): boolean {
    if (camera.protectHost && camera.protectCameraId) return true;
    const m = (camera.manufacturer ?? '').toLowerCase();
    return m.includes('ubiquiti') || m.includes('unifi');
}
