import { resolveOnvifTarget } from '../streaming/resolveOnvifTarget.js';
import type { Camera } from '../types/index.js';
import type { MotionProvider, MotionProviderId, ProviderMatch } from './types.js';
import { cameraLooksLikeReolink } from './providers/reolink/reolinkClient.js';
import { resolveProtectTarget } from './providers/unifi/protectTarget.js';

/**
 * Ordered provider chain for a camera. First successful start wins; later entries are fallbacks.
 */
export function resolveMotionProviderChain(camera: Camera): MotionProviderId[] {
    const source = camera.motionSource ?? 'frame-diff';

    switch (source) {
        case 'auto':
            return ['unifi-protect', 'reolink-native', 'onvif', 'frame-diff'];
        case 'unifi-protect':
            return ['unifi-protect', 'onvif', 'frame-diff'];
        case 'reolink-native':
            return ['reolink-native', 'onvif', 'frame-diff'];
        case 'onvif':
            return ['onvif', 'frame-diff'];
        default:
            return ['frame-diff'];
    }
}

/** Whether a registered provider can run for this camera (sync probe). */
export function canProviderHandle(provider: MotionProvider, camera: Camera): ProviderMatch | null {
    return provider.canHandle(camera);
}

/** First provider in the chain that canHandle, or null. */
export function resolvePreferredProvider(
    camera: Camera,
    providers: ReadonlyMap<MotionProviderId, MotionProvider>,
): { provider: MotionProvider; match: ProviderMatch } | null {
    for (const id of resolveMotionProviderChain(camera)) {
        const provider = providers.get(id);
        if (!provider) continue;
        const match = provider.canHandle(camera);
        if (match) return { provider, match };
    }
    return null;
}

/** ONVIF target probe shared by resolution tests and OnvifMotionProvider. */
export function onvifTargetAvailable(camera: Camera): boolean {
    return resolveOnvifTarget(camera) !== null;
}

/** Whether auto mode is likely to pick a vendor-native provider. */
export function hasVendorMotionConfig(camera: Camera): boolean {
    return Boolean(
        resolveProtectTarget(camera)
        || (cameraLooksLikeReolink(camera) && camera.rtspUrl)
        || onvifTargetAvailable(camera),
    );
}
