import type { Camera } from '../types/index.js';
import type { CameraAddProvider, DiscoveredCameraDevice, ResolvedCameraDraft } from './types.js';

export const manualProvider: CameraAddProvider = {
    meta: {
        id: 'manual',
        label: 'Manual RTSP',
        description: 'Paste an RTSP or RTSPS URL from your camera or NVR.',
        discoverable: false,
    },

    async discover(): Promise<DiscoveredCameraDevice[]> {
        return [];
    },

    async resolve(): Promise<ResolvedCameraDraft> {
        throw new Error('Manual provider does not support resolve — enter the stream URL directly.');
    },
};

export function isManualRtspAlreadyAdded(rtspUrl: string, cameras: Camera[]): boolean {
    let host: string | undefined;
    try {
        host = new URL(rtspUrl).hostname.toLowerCase();
    } catch {
        return false;
    }
    return cameras.some(cam => {
        try {
            return new URL(cam.rtspUrl).hostname.toLowerCase() === host;
        } catch {
            return false;
        }
    });
}
