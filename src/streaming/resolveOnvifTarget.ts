import type { Camera } from '../types/index.js';
import type { MotionSource } from '../motion/types.js';

export type { MotionSource };

export interface OnvifTarget {
    hostname: string;
    port: number;
    path: string;
    username: string;
    password: string;
    useSecure?: boolean;
}

const DEFAULT_PATH = '/onvif/device_service';

/** Parse RTSP URL for embedded credentials and host. */
function parseRtspAuth(rtspUrl: string): Partial<OnvifTarget> | null {
    try {
        const parsed = new URL(rtspUrl);
        if (parsed.protocol !== 'rtsp:' && parsed.protocol !== 'rtsps:') return null;
        return {
            hostname: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'rtsps:' ? 322 : 554),
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
        };
    } catch {
        return null;
    }
}

/**
 * Resolve ONVIF connection target from camera fields.
 * Uses onvifUrl when set (host, port, path); otherwise derives host from the RTSP URL.
 */
export function resolveOnvifTarget(camera: Camera): OnvifTarget | null {
    const fromRtsp = parseRtspAuth(camera.rtspUrl);

    if (camera.onvifUrl) {
        try {
            const parsed = new URL(camera.onvifUrl);
            const useSecure = parsed.protocol === 'https:';
            const port = parsed.port
                ? Number(parsed.port)
                : (useSecure ? 443 : 80);
            return {
                hostname: parsed.hostname,
                port,
                path: parsed.pathname || DEFAULT_PATH,
                username: camera.username || fromRtsp?.username || '',
                password: camera.password || fromRtsp?.password || '',
                useSecure,
            };
        } catch {
            return null;
        }
    }

    if (!fromRtsp?.hostname) return null;

    return {
        hostname: fromRtsp.hostname,
        port: 80,
        path: DEFAULT_PATH,
        username: camera.username || fromRtsp.username || '',
        password: camera.password || fromRtsp.password || '',
        useSecure: false,
    };
}
