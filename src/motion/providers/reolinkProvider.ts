import { Logger } from '@matter/general';
import { motionConfig } from '../../config/motion.js';
import type { Camera } from '../../types/index.js';
import type { MotionCallbacks, MotionContext, MotionObjectType, MotionProvider, ProviderMatch } from '../types.js';
import { resolveMotionObjectType } from '../types.js';
import { resolvePersonSensorHoldMs } from '../../matter/personSensorConfig.js';
import { wantsPersonMotion } from '../types.js';
import {
    cameraLooksLikeReolink,
    ReolinkClient,
    resolveReolinkTarget,
} from './reolink/reolinkClient.js';

const logger = Logger.get('ReolinkMotion');

interface ActivePoll {
    client: ReolinkClient;
    channel: number;
    motionObjectType: MotionObjectType;
    holdMs: number;
    timer?: ReturnType<typeof setInterval>;
    holdTimer?: ReturnType<typeof setTimeout>;
    active: boolean;
    callbacks: MotionCallbacks;
}

/** Reolink native motion via api.cgi (GetMdState + GetAiState polling). */
export class ReolinkMotionProvider implements MotionProvider {
    readonly id = 'reolink-native' as const;
    readonly label = 'Reolink native';
    readonly priority = 20;
    readonly supportsSensitivity = false;

    readonly #polls = new Map<string, ActivePoll>();

    canHandle(camera: Camera): ProviderMatch | null {
        const wanted = camera.motionSource === 'reolink-native'
            || (camera.motionSource === 'auto' && cameraLooksLikeReolink(camera));
        if (!wanted) return null;

        const target = resolveReolinkTarget(camera);
        if (!target) return null;
        return {
            providerId: 'reolink-native',
            reason: `Reolink api.cgi ${target.host} ch=${target.channel}`,
        };
    }

    async start(camera: Camera, _ctx: MotionContext, callbacks: MotionCallbacks): Promise<void> {
        const target = resolveReolinkTarget(camera);
        if (!target) {
            throw new Error('Reolink target unavailable — set RTSP credentials');
        }

        this.stop(camera.id);

        const client = new ReolinkClient(target.host, target.username, target.password, {
            port: target.port,
            useHttps: target.useHttps,
        });
        await client.ensureAuth();

        void client.getWhiteLedState(target.channel)
            .then(light => {
                if (!light) {
                    logger.info(`Reolink light capability unavailable camera=${camera.id} host=${target.host} ch=${target.channel}`);
                    return;
                }
                logger.info(
                    `Reolink light capability camera=${camera.id} host=${target.host} ch=${target.channel} enabled=${light.enabled} bright=${light.brightness ?? 'n/a'}`,
                );
            })
            .catch(error => {
                logger.debug(`Reolink light probe failed camera=${camera.id}: ${error}`);
            });

        const poll: ActivePoll = {
            client,
            channel: target.channel,
            motionObjectType: resolveMotionObjectType(camera),
            holdMs: wantsPersonMotion(camera)
                ? resolvePersonSensorHoldMs(camera)
                : motionConfig.reolinkHoldMs,
            active: false,
            callbacks,
        };
        this.#polls.set(camera.id, poll);

        const tick = () => void this.#poll(camera.id);
        await tick();
        poll.timer = setInterval(tick, motionConfig.reolinkPollMs);
        logger.info(`Reolink motion start camera=${camera.id} host=${target.host} ch=${target.channel}`);
    }

    stop(cameraId: string): void {
        const poll = this.#polls.get(cameraId);
        if (!poll) return;
        if (poll.timer) clearInterval(poll.timer);
        if (poll.holdTimer) clearTimeout(poll.holdTimer);
        if (poll.active) {
            poll.active = false;
            poll.callbacks.onActive(false);
        }
        this.#polls.delete(cameraId);
        logger.info(`Reolink motion stop camera=${cameraId}`);
    }

    async #poll(cameraId: string): Promise<void> {
        const poll = this.#polls.get(cameraId);
        if (!poll) return;

        try {
            const motion = await poll.client.isMotionActive(poll.channel, poll.motionObjectType);
            if (motion) {
                this.#trigger(poll);
            }
        } catch (error) {
            logger.warn(`Reolink poll failed camera=${cameraId}: ${error}`);
        }
    }

    #trigger(poll: ActivePoll): void {
        if (!poll.active) {
            poll.active = true;
            poll.callbacks.onActive(true);
        } else {
            poll.callbacks.onPulse();
        }

        if (poll.holdTimer) clearTimeout(poll.holdTimer);
        poll.holdTimer = setTimeout(() => {
            poll.holdTimer = undefined;
            if (!poll.active) return;
            poll.active = false;
            poll.callbacks.onActive(false);
        }, poll.holdMs);
    }
}
