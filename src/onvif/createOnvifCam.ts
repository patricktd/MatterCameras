import Onvif from 'onvif';
import type { OnvifTarget } from '../streaming/resolveOnvifTarget.js';

export type OnvifCam = InstanceType<typeof Onvif.Cam>;

const DEFAULT_PATH = '/onvif/device_service';

/** Build options for the `onvif` npm Cam constructor. */
export function buildOnvifCamOptions(
    target: OnvifTarget,
    overrides?: { autoconnect?: boolean; preserveAddress?: boolean },
): {
    hostname: string;
    port: number;
    path: string;
    username: string;
    password: string;
    useSecure: boolean;
    preserveAddress: boolean;
    autoconnect: boolean;
} {
    return {
        hostname: target.hostname,
        port: target.port,
        path: target.path || DEFAULT_PATH,
        username: target.username,
        password: target.password,
        useSecure: target.useSecure ?? false,
        // NVRs often return unreachable XAddr hosts in GetCapabilities — keep configured host:port.
        preserveAddress: overrides?.preserveAddress ?? true,
        autoconnect: overrides?.autoconnect ?? true,
    };
}

/** Connect with autoconnect (used by discovery resolve). */
export function openOnvifCam(target: OnvifTarget): Promise<OnvifCam> {
    return new Promise((resolve, reject) => {
        const cam = new Onvif.Cam(buildOnvifCamOptions(target), (err: Error | null) => {
            if (err) reject(err);
            else resolve(cam);
        });
    });
}

/** Connect after manual listener setup (motion PullPoint). */
export async function connectOnvifCam(cam: OnvifCam): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        cam.connect((err: Error | null) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export function createOnvifCamDisconnected(target: OnvifTarget): OnvifCam {
    return new Onvif.Cam(buildOnvifCamOptions(target, { autoconnect: false }), () => {});
}

export function endpointKey(target: OnvifTarget): string {
    const secure = target.useSecure ? 'https' : 'http';
    return `${secure}://${target.hostname}:${target.port}${target.path || DEFAULT_PATH}`;
}
