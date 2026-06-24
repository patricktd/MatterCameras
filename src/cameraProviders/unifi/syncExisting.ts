import type { Camera } from '../../types/index.js';
import {
    connectProtect,
    draftFromProtectCamera,
    extractProtectRtspAlias,
    listProtectCameras,
    logoutProtect,
} from './protectApi.js';
import { resolveProtectCredentials } from '../resolveControllerCreds.js';

export interface SyncExistingResult {
    updated: Array<{ id: string; name: string; protectCameraId: string }>;
    skipped: Array<{ id: string; name: string; reason: string }>;
}

function findProtectMatch(
    cam: Camera,
    rows: ReturnType<typeof listProtectCameras>,
): ReturnType<typeof listProtectCameras>[number] | undefined {
    if (cam.protectCameraId) {
        return rows.find(r => r.id === cam.protectCameraId);
    }

    const alias = extractProtectRtspAlias(cam.rtspUrl);
    if (alias) {
        const byAlias = rows.find(r => r.channels?.some(ch => ch.rtspAlias === alias));
        if (byAlias) return byAlias;
    }

    const nameKey = cam.name.trim().toLowerCase();
    if (nameKey) {
        const byName = rows.find(r => r.name.trim().toLowerCase() === nameKey);
        if (byName) return byName;
    }

    return undefined;
}

/** Attach protectHost / protectCameraId to roster cameras missing Protect metadata. */
export async function syncExistingProtectCameras(
    ctx: { host?: string; username?: string; password?: string },
    cameras: Camera[],
): Promise<SyncExistingResult> {
    const creds = resolveProtectCredentials(ctx);
    const api = await connectProtect(creds.host, creds.username, creds.password);

    try {
        const rows = listProtectCameras(api).filter(c => c.isAdopted && !c.isAdoptedByOther);
        const updated: SyncExistingResult['updated'] = [];
        const skipped: SyncExistingResult['skipped'] = [];

        for (const cam of cameras) {
            if (cam.protectHost && cam.protectCameraId) {
                skipped.push({ id: cam.id, name: cam.name, reason: 'already linked' });
                continue;
            }

            const match = findProtectMatch(cam, rows);
            if (!match) {
                skipped.push({ id: cam.id, name: cam.name, reason: 'no Protect match (name / RTSP alias)' });
                continue;
            }

            updated.push({ id: cam.id, name: cam.name, protectCameraId: match.id });
        }

        return { updated, skipped };
    } finally {
        logoutProtect(api);
    }
}

export function patchCameraFromProtect(
    cam: Camera,
    host: string,
    protectCameraId: string,
    username: string,
    password: string,
    row: ReturnType<typeof listProtectCameras>[number],
): Camera {
    const draft = draftFromProtectCamera(host, row, username, password);
    return {
        ...cam,
        protectHost: host,
        protectCameraId,
        manufacturer: cam.manufacturer || draft.manufacturer,
        model: cam.model || draft.model,
        username: cam.username || username,
        password: cam.password || password || undefined,
        motionSource: cam.motionSource ?? 'auto',
        rtspUrl: draft.rtspUrl,
        addSource: cam.addSource ?? 'unifi-protect',
    };
}
