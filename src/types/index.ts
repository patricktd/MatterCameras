import type { MotionObjectType, MotionSource } from '../motion/types.js';

export type { MotionObjectType, MotionSource } from '../motion/types.js';

export type ReolinkProtocol = 'rtsp' | 'rtmp' | 'flv';
export type ReolinkStream =
    | 'main'
    | 'sub'
    | 'ext'
    | 'autotrack_main'
    | 'autotrack_sub'
    | 'telephoto_main'
    | 'telephoto_sub';

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
    /** Optional object filter for vendor-native motion integrations. */
    motionObjectType?: MotionObjectType;
    /** Whether to expose a separate bridged person sensor for supported vendors. */
    personSensorEnabled?: boolean;
    /** Whether to expose a separate bridged Reolink spotlight (WhiteLed) switch. */
    reolinkLightEnabled?: boolean;
    /** Set by hardware probe — false hides the spotlight option in the Web UI. */
    reolinkLightCapable?: boolean;
    onvifUrl?: string;
    username?: string;
    password?: string;
    /** From ONVIF resolve — used for auto provider selection. */
    manufacturer?: string;
    model?: string;
    /** Reolink NVR/channel index (default 0). */
    reolinkChannel?: number;
    /** Reolink API host used for motion / capability calls when stream URL is not RTSP. */
    reolinkHost?: string;
    /** Reolink HTTP(S) API port. */
    reolinkHttpPort?: number;
    /** Reolink API transport. */
    reolinkUseHttps?: boolean;
    /** Reolink RTSP port used to build stream URLs. */
    reolinkRtspPort?: number;
    /** Preferred Reolink stream transport selected during discovery. */
    reolinkProtocol?: ReolinkProtocol;
    /** Reolink stream variant selected during discovery. */
    reolinkStream?: ReolinkStream;
    /** Reolink per-channel UID when available (useful on NVR / Home Hub). */
    reolinkDeviceUid?: string;
    /** Whether the resolved source came from a Reolink NVR / Home Hub. */
    reolinkIsNvr?: boolean;
    /** UniFi Protect controller hostname or IP. */
    protectHost?: string;
    /** UniFi Protect camera id (24-char hex from Protect UI/API). */
    protectCameraId?: string;
    /** How this camera was added in the Web UI wizard. */
    addSource?: 'manual' | 'onvif' | 'unifi-protect' | 'reolink' | 'tapo-sonoff';
    /**
     * Incremented when a camera's Matter bridged endpoints are recycled so hubs
     * treat the child devices as new (new uniqueId per endpoint).
     */
    matterBindEpoch?: number;
}

export interface PairingInfo {
    qrCode: string;
    manualPairingCode: string;
}
