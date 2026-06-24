import type { MotionSource } from '../motion/types.js';

export type { MotionSource } from '../motion/types.js';

export interface Camera {
    id: string;
    name: string;
    rtspUrl: string;
    codec?: string;
    /**
     * Motion detection backend.
     * `auto` tries vendor providers (UniFi, Reolink) then ONVIF then frame-diff.
     */
    motionSource?: MotionSource;
    onvifUrl?: string;
    username?: string;
    password?: string;
    /** From ONVIF resolve — used for auto provider selection. */
    manufacturer?: string;
    model?: string;
    /** Reolink NVR/channel index (default 0). */
    reolinkChannel?: number;
    /** UniFi Protect controller hostname or IP. */
    protectHost?: string;
    /** UniFi Protect camera id (24-char hex from Protect UI/API). */
    protectCameraId?: string;
    /** How this camera was added in the Web UI wizard. */
    addSource?: 'manual' | 'onvif' | 'unifi-protect' | 'reolink' | 'tapo-sonoff';
}

export interface PairingInfo {
    qrCode: string;
    manualPairingCode: string;
}
