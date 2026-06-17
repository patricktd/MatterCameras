import type { Go2RTCClient } from '../../streaming/Go2RTCClient.js';

export type MotionActivityReporter = (active: boolean) => void;
export type MotionPulseReporter = () => void;

export interface MotionSensitivity {
    level: number;
    max: number;
}

/** Shared streaming dependencies for Matter camera behaviors */
export const streamContext = {
    go2rtc: null as Go2RTCClient | null,
    /** Zone Management servers register here; motion polling forwards activity by camera id. */
    reportMotionActivity: new Map<string, MotionActivityReporter>(),
    /** While a zone trigger is active, extend its hold time on continued motion. */
    reportMotionPulse: new Map<string, MotionPulseReporter>(),
    motionSensitivity: new Map<string, MotionSensitivity>(),
    /** Set from main.ts so Zone Management can apply trigger sensitivity to an active detector. */
    refreshMotionSensitivity: undefined as ((cameraId: string) => void) | undefined,
};
