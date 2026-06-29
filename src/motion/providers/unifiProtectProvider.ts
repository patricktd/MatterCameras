import { Logger } from '@matter/general';
import { resolvePersonSensorHoldMs } from '../../matter/personSensorConfig.js';
import type { Camera } from '../../types/index.js';
import type { MotionCallbacks, MotionContext, MotionProvider, ProviderMatch } from '../types.js';
import { resolveMotionObjectType, wantsPersonMotion } from '../types.js';
import { motionConfig } from '../../config/motion.js';
import { attachProtectMotion, detachProtectMotion } from './unifi/protectHub.js';
import { resolveProtectTarget } from './unifi/protectTarget.js';

const logger = Logger.get('UnifiMotion');

/** UniFi Protect WebSocket motion (controller-level subscription). */
export class UnifiProtectMotionProvider implements MotionProvider {
    readonly id = 'unifi-protect' as const;
    readonly label = 'UniFi Protect';
    readonly priority = 10;
    readonly supportsSensitivity = false;

    readonly #targets = new Map<string, ReturnType<typeof resolveProtectTarget>>();

    canHandle(camera: Camera): ProviderMatch | null {
        if (camera.motionSource !== 'unifi-protect' && camera.motionSource !== 'auto') {
            return null;
        }

        const target = resolveProtectTarget(camera);
        if (!target) return null;

        return {
            providerId: 'unifi-protect',
            reason: `Protect ${target.host} camera=${target.cameraId}`,
        };
    }

    async start(camera: Camera, _ctx: MotionContext, callbacks: MotionCallbacks): Promise<void> {
        const target = resolveProtectTarget(camera);
        if (!target) {
            throw new Error('UniFi Protect — set protectHost and protectCameraId in Advanced options');
        }

        this.stop(camera.id);
        this.#targets.set(camera.id, target);

        const holdMs = wantsPersonMotion(camera)
            ? resolvePersonSensorHoldMs(camera)
            : motionConfig.unifiHoldMs;

        await attachProtectMotion(
            camera.id,
            target,
            resolveMotionObjectType(camera),
            holdMs,
            callbacks.onActive,
            callbacks.onPulse,
        );
        logger.info(`UniFi Protect motion start camera=${camera.id}`);
    }

    stop(cameraId: string): void {
        const target = this.#targets.get(cameraId);
        if (!target) return;
        void detachProtectMotion(cameraId, target);
        this.#targets.delete(cameraId);
        logger.info(`UniFi Protect motion stop camera=${cameraId}`);
    }
}
