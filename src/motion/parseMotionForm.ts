import type { MotionObjectType, MotionSource } from '../motion/types.js';
import type { Camera } from '../types/index.js';
import {
    MAX_PERSON_SENSOR_HOLD_SEC,
    MIN_PERSON_SENSOR_HOLD_SEC,
} from '../matter/personSensorConfig.js';

const MOTION_SOURCES = new Set<MotionSource>([
    'auto',
    'frame-diff',
    'onvif',
    'reolink-native',
    'unifi-protect',
]);

const MOTION_OBJECT_TYPES = new Set<MotionObjectType>([
    'any',
    'person',
]);

export function parseMotionSource(raw: unknown, fallback: MotionSource = 'auto'): MotionSource {
    const value = String(raw ?? '').trim() as MotionSource;
    return MOTION_SOURCES.has(value) ? value : fallback;
}

export function parseMotionObjectType(
    raw: unknown,
    fallback: MotionObjectType = 'any',
): MotionObjectType {
    const value = String(raw ?? '').trim() as MotionObjectType;
    return MOTION_OBJECT_TYPES.has(value) ? value : fallback;
}

export function parseOptionalInt(raw: unknown): number | undefined {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
}

export function parseOptionalBoolean(raw: unknown): boolean | undefined {
    if (Array.isArray(raw)) {
        if (raw.some(v => v === true || v === 'true' || v === '1' || v === 1)) return true;
        if (raw.some(v => v === false || v === 'false' || v === '0' || v === 0)) return false;
        return undefined;
    }
    if (raw === true || raw === 'true' || raw === '1' || raw === 1) return true;
    if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
    return undefined;
}

export function parsePersonSensorHoldSec(raw: unknown): number | undefined {
    const n = parseOptionalInt(raw);
    if (n === undefined) return undefined;
    return Math.min(MAX_PERSON_SENSOR_HOLD_SEC, Math.max(MIN_PERSON_SENSOR_HOLD_SEC, n));
}

export function parseCameraMotionFields(body: Record<string, unknown>): Pick<
    Camera,
    | 'motionSource'
    | 'motionObjectType'
    | 'personSensorEnabled'
    | 'personSensorHoldSec'
    | 'reolinkLightEnabled'
    | 'onvifUrl'
    | 'username'
    | 'password'
    | 'manufacturer'
    | 'model'
    | 'reolinkChannel'
    | 'reolinkHost'
    | 'reolinkHttpPort'
    | 'reolinkUseHttps'
    | 'reolinkRtspPort'
    | 'reolinkProtocol'
    | 'reolinkStream'
    | 'reolinkDeviceUid'
    | 'reolinkIsNvr'
    | 'protectHost'
    | 'protectCameraId'
    | 'addSource'
> {
    const addSourceRaw = String(body.addSource ?? '').trim();
    const addSources = new Set(['manual', 'onvif', 'unifi-protect', 'reolink', 'tapo-sonoff']);
    const reolinkProtocolRaw = String(body.reolinkProtocol ?? '').trim();
    const reolinkProtocols = new Set(['rtsp', 'rtmp', 'flv']);
    const reolinkStreamRaw = String(body.reolinkStream ?? '').trim();
    const reolinkStreams = new Set([
        'main',
        'sub',
        'ext',
        'autotrack_main',
        'autotrack_sub',
        'telephoto_main',
        'telephoto_sub',
    ]);
    return {
        motionSource: parseMotionSource(body.motionSource),
        motionObjectType: 'any',
        personSensorEnabled: parseOptionalBoolean(body.personSensorEnabled ?? body.presenceSensorEnabled),
        personSensorHoldSec: parsePersonSensorHoldSec(body.personSensorHoldSec),
        reolinkLightEnabled: parseOptionalBoolean(body.reolinkLightEnabled),
        onvifUrl: String(body.onvifUrl ?? '').trim() || undefined,
        username: String(body.username ?? '').trim() || undefined,
        password: String(body.password ?? '').trim() || undefined,
        manufacturer: String(body.manufacturer ?? '').trim() || undefined,
        model: String(body.model ?? '').trim() || undefined,
        reolinkChannel: parseOptionalInt(body.reolinkChannel),
        reolinkHost: String(body.reolinkHost ?? '').trim() || undefined,
        reolinkHttpPort: parseOptionalInt(body.reolinkHttpPort),
        reolinkUseHttps: parseOptionalBoolean(body.reolinkUseHttps),
        reolinkRtspPort: parseOptionalInt(body.reolinkRtspPort),
        reolinkProtocol: reolinkProtocols.has(reolinkProtocolRaw)
            ? reolinkProtocolRaw as Camera['reolinkProtocol']
            : undefined,
        reolinkStream: reolinkStreams.has(reolinkStreamRaw)
            ? reolinkStreamRaw as Camera['reolinkStream']
            : undefined,
        reolinkDeviceUid: String(body.reolinkDeviceUid ?? '').trim() || undefined,
        reolinkIsNvr: parseOptionalBoolean(body.reolinkIsNvr),
        protectHost: String(body.protectHost ?? '').trim() || undefined,
        protectCameraId: String(body.protectCameraId ?? '').trim() || undefined,
        addSource: addSources.has(addSourceRaw) ? addSourceRaw as Camera['addSource'] : undefined,
    };
}

function formSupportsReolinkOptions(
    fields: Pick<Camera, 'addSource' | 'manufacturer' | 'model' | 'motionSource'>,
): boolean {
    if (fields.addSource === 'reolink') return true;
    const manufacturer = (fields.manufacturer ?? '').toLowerCase();
    if (manufacturer.includes('reolink')) return true;
    return fields.motionSource === 'reolink-native';
}

function formSupportsUnifiOptions(
    fields: Pick<Camera, 'addSource' | 'manufacturer' | 'protectHost' | 'protectCameraId'>,
): boolean {
    if (fields.addSource === 'unifi-protect') return true;
    if (fields.protectHost && fields.protectCameraId) return true;
    const manufacturer = (fields.manufacturer ?? '').toLowerCase();
    return manufacturer.includes('ubiquiti') || manufacturer.includes('unifi');
}

/** Drop Reolink-only form fields when the camera is not a Reolink source. */
export function stripNonReolinkMotionFields<T extends ReturnType<typeof parseCameraMotionFields>>(fields: T): T {
    if (formSupportsReolinkOptions(fields)) {
        return fields;
    }

    return {
        ...fields,
        reolinkLightEnabled: false,
        reolinkChannel: undefined,
        reolinkHost: undefined,
        reolinkHttpPort: undefined,
        reolinkUseHttps: undefined,
        reolinkRtspPort: undefined,
        reolinkProtocol: undefined,
        reolinkStream: undefined,
        reolinkDeviceUid: undefined,
        reolinkIsNvr: undefined,
    };
}

/** Drop UniFi-only form fields when the camera is not a Protect source. */
export function stripNonUnifiMotionFields<T extends ReturnType<typeof parseCameraMotionFields>>(fields: T): T {
    if (formSupportsUnifiOptions(fields)) {
        return fields;
    }

    return {
        ...fields,
        protectHost: undefined,
        protectCameraId: undefined,
    };
}

export function sanitizeCameraMotionFields(body: Record<string, unknown>): ReturnType<typeof parseCameraMotionFields> {
    const parsed = parseCameraMotionFields(body);
    return stripNonUnifiMotionFields(stripNonReolinkMotionFields(parsed));
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
