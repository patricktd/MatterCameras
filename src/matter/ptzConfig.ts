import type { Camera } from '../types/index.js';
import { cameraLooksLikeReolink, resolveReolinkTarget } from '../motion/providers/reolink/reolinkClient.js';
import { cameraLooksLikeUnifi } from '../motion/providers/unifi/protectTarget.js';
import { resolveOnvifTarget } from '../streaming/resolveOnvifTarget.js';

export type PtzBackend = 'reolink' | 'onvif';

/** ONVIF target for PTZ — stricter than motion ONVIF (no RTSP-host guess on UniFi). */
export function resolveOnvifTargetForPtz(camera: Camera) {
    if (cameraLooksLikeUnifi(camera)) return null;
    if (camera.onvifUrl) return resolveOnvifTarget(camera);
    if (camera.motionSource === 'onvif' || camera.ptzBackend === 'onvif') {
        return resolveOnvifTarget(camera);
    }
    return null;
}

export function resolvePtzBackend(camera: Camera): PtzBackend | null {
    if (cameraLooksLikeUnifi(camera)) return null;

    if (camera.ptzBackend === 'reolink' || (camera.ptzBackend !== 'onvif' && cameraLooksLikeReolink(camera))) {
        if (resolveReolinkTarget(camera)) return 'reolink';
    }
    if (camera.ptzBackend === 'onvif' || resolveOnvifTargetForPtz(camera)) {
        if (resolveOnvifTargetForPtz(camera)) return 'onvif';
    }
    return null;
}

export function canCameraProbePtz(camera: Camera): boolean {
    if (camera.ptzEnabled === false) return false;
    return resolvePtzBackend(camera) !== null;
}

export function canCameraExposePtz(camera: Camera): boolean {
    return canCameraProbePtz(camera);
}

/** Matter PTZ cluster + handlers — only after a successful capability probe. */
export function shouldExposePtz(camera: Camera): boolean {
    if (camera.ptzEnabled === false) return false;
    if (camera.ptzCapable !== true) return false;
    return resolvePtzBackend(camera) !== null;
}
