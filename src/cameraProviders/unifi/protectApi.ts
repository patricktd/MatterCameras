import { ProtectApi } from 'unifi-protect';
import { buildProtectRtspUrl, pickProtectStreamChannel } from '../buildProtectRtsp.js';
import type { ResolvedCameraDraft } from '../types.js';

export interface ProtectCameraRow {
    id: string;
    name: string;
    type?: string;
    isAdopted?: boolean;
    isAdoptedByOther?: boolean;
    isConnected?: boolean;
    connectionHost?: string;
    channels?: Array<{
        id?: number;
        name?: string;
        rtspAlias?: string;
        width?: number;
        height?: number;
        isRtspEnabled?: boolean;
    }>;
}

export async function connectProtect(host: string, username: string, password: string): Promise<ProtectApi> {
    const api = new ProtectApi();
    const loggedIn = await api.login(host, username, password);
    if (!loggedIn) {
        throw new Error('UniFi Protect login failed — check controller IP and local user credentials');
    }
    const bootstrap = await api.getBootstrap();
    if (!bootstrap) {
        throw new Error('UniFi Protect bootstrap failed');
    }
    return api;
}

export function listProtectCameras(api: ProtectApi): ProtectCameraRow[] {
    const bootstrap = api.bootstrap as { cameras?: ProtectCameraRow[] } | undefined;
    return bootstrap?.cameras ?? [];
}

export function draftFromProtectCamera(
    host: string,
    camera: ProtectCameraRow,
    username: string,
    password: string,
): ResolvedCameraDraft {
    const channel = pickProtectStreamChannel(camera.channels);
    const rtspAlias = channel?.rtspAlias;
    if (!rtspAlias) {
        throw new Error(
            `No RTSP alias on "${camera.name}" — enable RTSP in UniFi Protect (Settings → camera → Advanced)`,
        );
    }

    return {
        name: camera.name,
        rtspUrl: buildProtectRtspUrl({
            controllerHost: host,
            connectionHost: camera.connectionHost,
            username,
            password,
            rtspAlias,
        }),
        addSource: 'unifi-protect',
        manufacturer: 'Ubiquiti',
        model: camera.type,
        username,
        password: password || undefined,
        protectHost: host,
        protectCameraId: camera.id,
        suggestedMotionSource: 'auto',
        suggestedMotionReason: 'unifi-protect — motion via Protect WebSocket',
    };
}

export function logoutProtect(api: ProtectApi): void {
    try {
        api.logout();
    } catch {
        // ignore
    }
}

/** RTSPS path segment after :7441/ — used to match existing roster entries. */
export function extractProtectRtspAlias(rtspUrl: string): string | null {
    try {
        const parsed = new URL(rtspUrl);
        const alias = parsed.pathname.replace(/^\//, '').trim();
        return alias || null;
    } catch {
        return null;
    }
}
