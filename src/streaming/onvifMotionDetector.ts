import { Logger } from '@matter/general';
import { attachOnvifMotion, detachOnvifMotion } from '../onvif/motionSubscriptionHub.js';
import type { OnvifTarget } from './resolveOnvifTarget.js';

const logger = Logger.get('OnvifMotion');

/**
 * ONVIF PullPoint motion events (native camera MotionAlarm).
 * Lower CPU than frame-diff; requires ONVIF Events on the camera.
 */
export class OnvifMotionDetector {
    readonly #cameraId: string;
    readonly #onActive: (active: boolean) => void;
    readonly #onPulse: () => void;
    #target?: OnvifTarget;
    #stopped = false;

    constructor(
        cameraId: string,
        onActive: (active: boolean) => void,
        onPulse: () => void,
    ) {
        this.#cameraId = cameraId;
        this.#onActive = onActive;
        this.#onPulse = onPulse;
    }

    async start(target: OnvifTarget): Promise<void> {
        this.#stopped = false;
        this.#target = target;
        logger.info(
            `ONVIF motion start camera=${this.#cameraId} host=${target.hostname}:${target.port}${target.path}`,
        );
        await attachOnvifMotion(
            this.#cameraId,
            target,
            active => {
                if (!this.#stopped) this.#onActive(active);
            },
            () => {
                if (!this.#stopped) this.#onPulse();
            },
        );
    }

    stop(): void {
        this.#stopped = true;
        const target = this.#target;
        this.#target = undefined;
        if (target) {
            void detachOnvifMotion(this.#cameraId, target);
        }
        logger.info(`ONVIF motion stop camera=${this.#cameraId}`);
    }

    /** ONVIF cameras ignore Matter zone sensitivity — no-op for API compatibility. */
    setSensitivity(_level: number, _max = 10): void {
        // native motion events
    }
}
