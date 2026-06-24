/** Built-in motion provider identifiers. */
export type MotionProviderId =
    | 'frame-diff'
    | 'onvif'
    | 'reolink-native'
    | 'unifi-protect';

/** Per-camera motion backend selection (Web UI / cameras.json). */
export type MotionSource = 'auto' | MotionProviderId;

export interface MotionCallbacks {
    onActive: (active: boolean) => void;
    onPulse: () => void;
}

export interface MotionContext {
    go2rtc: import('../streaming/Go2RTCClient.js').Go2RTCClient;
    getSensitivity(cameraId: string): { level: number; max: number } | undefined;
}

export interface ProviderMatch {
    providerId: MotionProviderId;
    reason: string;
}

/**
 * Pluggable motion detection backend (Scrypted-inspired, in-process).
 * Each provider wraps a transport (ONVIF PullPoint, go2rtc JPEG poll, etc.).
 */
export interface MotionProvider {
    readonly id: MotionProviderId;
    readonly label: string;
    /** Lower priority values are preferred when auto-selection is added. */
    readonly priority: number;
    canHandle(camera: import('../types/index.js').Camera): ProviderMatch | null;
    start(
        camera: import('../types/index.js').Camera,
        ctx: MotionContext,
        callbacks: MotionCallbacks,
    ): Promise<void>;
    stop(cameraId: string): void;
    readonly supportsSensitivity: boolean;
    applySensitivity?(cameraId: string, level: number, max: number): void;
}
