import type { MotionSource } from '../motion/types.js';
import type { Camera } from '../types/index.js';

const MOTION_SOURCES = new Set<MotionSource>([
    'auto',
    'frame-diff',
    'onvif',
    'reolink-native',
    'unifi-protect',
]);

export function parseMotionSource(raw: unknown, fallback: MotionSource = 'auto'): MotionSource {
    const value = String(raw ?? '').trim() as MotionSource;
    return MOTION_SOURCES.has(value) ? value : fallback;
}

export function parseOptionalInt(raw: unknown): number | undefined {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
}

export function parseCameraMotionFields(body: Record<string, unknown>): Pick<
    Camera,
    | 'motionSource'
    | 'onvifUrl'
    | 'username'
    | 'password'
    | 'manufacturer'
    | 'model'
    | 'reolinkChannel'
    | 'protectHost'
    | 'protectCameraId'
    | 'addSource'
> {
    const addSourceRaw = String(body.addSource ?? '').trim();
    const addSources = new Set(['manual', 'onvif', 'unifi-protect', 'reolink', 'tapo-sonoff']);
    return {
        motionSource: parseMotionSource(body.motionSource),
        onvifUrl: String(body.onvifUrl ?? '').trim() || undefined,
        username: String(body.username ?? '').trim() || undefined,
        password: String(body.password ?? '').trim() || undefined,
        manufacturer: String(body.manufacturer ?? '').trim() || undefined,
        model: String(body.model ?? '').trim() || undefined,
        reolinkChannel: parseOptionalInt(body.reolinkChannel),
        protectHost: String(body.protectHost ?? '').trim() || undefined,
        protectCameraId: String(body.protectCameraId ?? '').trim() || undefined,
        addSource: addSources.has(addSourceRaw) ? addSourceRaw as Camera['addSource'] : undefined,
    };
}

/** Labels for Web UI camera cards. */
export function motionSourceLabel(source?: MotionSource): string {
    switch (source ?? 'frame-diff') {
        case 'auto': return 'Motion: Auto';
        case 'onvif': return 'Motion: ONVIF';
        case 'reolink-native': return 'Motion: Reolink native';
        case 'unifi-protect': return 'Motion: UniFi Protect';
        default: return 'Motion: Frame diff';
    }
}
