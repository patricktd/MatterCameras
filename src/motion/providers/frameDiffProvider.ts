import { RtspMotionDetector } from '../../streaming/rtspMotionDetector.js';
import type { Camera } from '../../types/index.js';
import type { MotionCallbacks, MotionContext, MotionProvider, ProviderMatch } from '../types.js';

/** Generic RTSP motion via consecutive JPEG frame comparison (go2rtc snapshots). */
export class FrameDiffMotionProvider implements MotionProvider {
    readonly id = 'frame-diff' as const;
    readonly label = 'Frame diff';
    readonly priority = 100;
    readonly supportsSensitivity = true;

    readonly #detectors = new Map<string, RtspMotionDetector>();

    canHandle(_camera: Camera): ProviderMatch {
        return { providerId: 'frame-diff', reason: 'always available fallback' };
    }

    start(camera: Camera, ctx: MotionContext, callbacks: MotionCallbacks): Promise<void> {
        this.stop(camera.id);

        const detector = new RtspMotionDetector(camera.id, callbacks.onActive, callbacks.onPulse);
        this.#detectors.set(camera.id, detector);
        detector.start(ctx.go2rtc);

        const sensitivity = ctx.getSensitivity(camera.id);
        if (sensitivity) {
            detector.setSensitivity(sensitivity.level, sensitivity.max);
        }

        return Promise.resolve();
    }

    stop(cameraId: string): void {
        const detector = this.#detectors.get(cameraId);
        if (!detector) return;
        detector.stop();
        this.#detectors.delete(cameraId);
    }

    applySensitivity(cameraId: string, level: number, max: number): void {
        this.#detectors.get(cameraId)?.setSensitivity(level, max);
    }
}
