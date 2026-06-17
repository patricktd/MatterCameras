import { Logger } from '@matter/general';
import type { Go2RTCClient } from './Go2RTCClient.js';
import { RtspMotionDetector } from './rtspMotionDetector.js';
import { streamContext } from '../matter/behaviors/streamContext.js';

const logger = Logger.get('MotionService');

/** Starts/stops per-camera RTSP motion polling and forwards activity to Zone Management. */
export class MotionDetectionService {
    readonly #detectors = new Map<string, RtspMotionDetector>();

    startCamera(cameraId: string, go2rtc: Go2RTCClient): void {
        let detector = this.#detectors.get(cameraId);
        if (!detector) {
            detector = new RtspMotionDetector(
                cameraId,
                active => streamContext.reportMotionActivity.get(cameraId)?.(active),
                () => streamContext.reportMotionPulse.get(cameraId)?.(),
            );
            this.#detectors.set(cameraId, detector);
            detector.start(go2rtc);
            const msg = `Motion service watching camera=${cameraId}`;
            logger.info(msg);
            console.log(msg);
        }

        const sensitivity = streamContext.motionSensitivity.get(cameraId);
        if (sensitivity) {
            detector.setSensitivity(sensitivity.level, sensitivity.max);
        }
    }

    stopCamera(cameraId: string): void {
        const detector = this.#detectors.get(cameraId);
        if (!detector) return;
        detector.stop();
        this.#detectors.delete(cameraId);
        streamContext.reportMotionActivity.delete(cameraId);
        streamContext.reportMotionPulse.delete(cameraId);
        streamContext.motionSensitivity.delete(cameraId);
    }

    applySensitivity(cameraId: string): void {
        const detector = this.#detectors.get(cameraId);
        const sensitivity = streamContext.motionSensitivity.get(cameraId);
        if (detector && sensitivity) {
            detector.setSensitivity(sensitivity.level, sensitivity.max);
        }
    }

    stopAll(): void {
        for (const id of [...this.#detectors.keys()]) {
            this.stopCamera(id);
        }
    }
}
