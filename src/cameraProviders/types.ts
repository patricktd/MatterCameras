import type { MotionSource } from '../motion/types.js';

/** How the camera was added via the Web UI wizard. */
export type CameraAddSource = 'manual' | 'onvif' | 'unifi-protect' | 'reolink' | 'tapo-sonoff';

/** Metadata shown in the add-camera provider picker. */
export interface CameraProviderMeta {
    id: CameraAddSource;
    label: string;
    description: string;
    /** When false, the UI shows credentials + form only (no device list). */
    discoverable: boolean;
}

/** A device row returned from provider discovery. */
export interface DiscoveredCameraDevice {
    /** Provider-native id passed back to resolve (JSON-serializable). */
    id: string;
    label: string;
    /** Secondary line in the picker (model, host, channel, …). */
    detail?: string;
    /** Opaque payload the provider needs on resolve (endpoint, channel, …). */
    payload?: Record<string, unknown>;
}

/** Fields to pre-fill the add-camera form (and cameras.json). */
export interface ResolvedCameraDraft {
    name: string;
    rtspUrl: string;
    rtspUrlRedacted?: string;
    addSource: CameraAddSource;
    manufacturer?: string;
    model?: string;
    username?: string;
    password?: string;
    onvifUrl?: string;
    reolinkChannel?: number;
    protectHost?: string;
    protectCameraId?: string;
    suggestedMotionSource?: MotionSource;
    suggestedMotionReason?: string;
}

export interface CameraDiscoverContext {
    timeoutMs?: number;
    host?: string;
    username?: string;
    password?: string;
}

export interface CameraResolveContext {
    deviceId: string;
    payload?: Record<string, unknown>;
    host?: string;
    username?: string;
    password?: string;
    port?: number;
    path?: string;
    channel?: number;
}

export interface CameraAddProvider {
    meta: CameraProviderMeta;
    discover(ctx: CameraDiscoverContext, existingIds: import('../types/index.js').Camera[]): Promise<DiscoveredCameraDevice[]>;
    resolve(ctx: CameraResolveContext): Promise<ResolvedCameraDraft>;
}
