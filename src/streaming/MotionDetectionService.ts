import { Logger } from '@matter/general';
import { MotionProviderRegistry } from '../motion/MotionProviderRegistry.js';
import { onvifTargetAvailable } from '../motion/resolveMotionProvider.js';
import type { MotionProviderId } from '../motion/types.js';
import type { Camera } from '../types/index.js';
import type { Go2RTCClient } from './Go2RTCClient.js';
import { streamContext } from '../matter/behaviors/streamContext.js';

const logger = Logger.get('MotionService');

/** Starts/stops per-camera motion and forwards activity to Zone Management. */
export class MotionDetectionService {
    readonly #registry = new MotionProviderRegistry();
    readonly #activeProvider = new Map<string, MotionProviderId>();

    startCamera(camera: Camera, go2rtc: Go2RTCClient): void {
        this.stopCamera(camera.id);

        const source = camera.motionSource ?? 'frame-diff';
        if (source === 'onvif' || source === 'auto') {
            if (!onvifTargetAvailable(camera) && (source === 'onvif' || !camera.protectHost)) {
                if (source === 'onvif') {
                    logger.warn(
                        `ONVIF motion unavailable for camera=${camera.id} — set onvifUrl or RTSP credentials; trying fallbacks`,
                    );
                }
            } else if (source === 'onvif' && !camera.onvifUrl) {
                logger.warn(
                    `ONVIF motion camera=${camera.id} — no onvifUrl; using RTSP host for ONVIF`,
                );
            }
        }

        const ctx = {
            go2rtc,
            getSensitivity: (cameraId: string) => streamContext.motionSensitivity.get(cameraId),
        };

        const callbacks = {
            onActive: (active: boolean) => streamContext.reportMotionActivity.get(camera.id)?.(active),
            onPulse: () => streamContext.reportMotionPulse.get(camera.id)?.(),
        };

        void this.#registry.startCamera(camera, ctx, callbacks, (providerId, error) => {
            logger.warn(
                `Motion provider ${providerId} failed camera=${camera.id}: ${error}; trying fallback`,
            );
        }).then(providerId => {
            if (!providerId) {
                logger.warn(`No motion provider started for camera=${camera.id}`);
                return;
            }
            this.#activeProvider.set(camera.id, providerId);
            const label = this.#registry.get(providerId)?.label ?? providerId;
            const msg = `${label} motion watching camera=${camera.id}`;
            logger.info(msg);
            console.log(msg);
        });
    }

    stopCamera(cameraId: string): void {
        const providerId = this.#activeProvider.get(cameraId);
        if (providerId) {
            this.#registry.stopCamera(cameraId, providerId);
            this.#activeProvider.delete(cameraId);
        }
        streamContext.reportMotionActivity.delete(cameraId);
        streamContext.reportMotionPulse.delete(cameraId);
        streamContext.motionSensitivity.delete(cameraId);
    }

    applySensitivity(cameraId: string): void {
        const providerId = this.#activeProvider.get(cameraId);
        if (!providerId) return;
        const sensitivity = streamContext.motionSensitivity.get(cameraId);
        if (!sensitivity) return;
        this.#registry.applySensitivity(cameraId, providerId, sensitivity.level, sensitivity.max);
    }

    stopAll(): void {
        for (const id of [...this.#activeProvider.keys()]) {
            this.stopCamera(id);
        }
    }
}
