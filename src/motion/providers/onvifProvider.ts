import { OnvifMotionDetector } from '../../streaming/onvifMotionDetector.js';
import { resolveOnvifTarget } from '../../streaming/resolveOnvifTarget.js';
import type { Camera } from '../../types/index.js';
import type { MotionCallbacks, MotionContext, MotionProvider, ProviderMatch } from '../types.js';

/** ONVIF WSPullPoint motion (MotionAlarm, CellMotionDetector, etc.). */
export class OnvifMotionProvider implements MotionProvider {
    readonly id = 'onvif' as const;
    readonly label = 'ONVIF events';
    readonly priority = 30;
    readonly supportsSensitivity = false;

    readonly #detectors = new Map<string, OnvifMotionDetector>();

    canHandle(camera: Camera): ProviderMatch | null {
        const target = resolveOnvifTarget(camera);
        if (!target) return null;
        return {
            providerId: 'onvif',
            reason: `ONVIF target ${target.hostname}:${target.port}${target.path}`,
        };
    }

    async start(camera: Camera, _ctx: MotionContext, callbacks: MotionCallbacks): Promise<void> {
        const target = resolveOnvifTarget(camera);
        if (!target) {
            throw new Error('ONVIF target unavailable');
        }

        this.stop(camera.id);

        const detector = new OnvifMotionDetector(camera.id, callbacks.onActive, callbacks.onPulse);
        this.#detectors.set(camera.id, detector);
        await detector.start(target);
    }

    stop(cameraId: string): void {
        const detector = this.#detectors.get(cameraId);
        if (!detector) return;
        detector.stop();
        this.#detectors.delete(cameraId);
    }
}
