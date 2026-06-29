import { Logger } from '@matter/general';
import type { Camera } from '../types/index.js';
import {
    applyMptzRelativeMove,
    clampMptz,
    DEFAULT_MPTZ,
    invertMatterRelativePan,
    stickSetPositionToMove,
    scalePanToOnvif,
    scaleTiltToOnvif,
    scaleZoomDeltaToOnvif,
    type MptzState,
} from '../matter/ptzCoordinates.js';
import { resolveOnvifTargetForPtz, resolvePtzBackend, type PtzBackend } from '../matter/ptzConfig.js';
import { ptzContext } from '../matter/behaviors/ptzContext.js';
import {
    onvifContinuousMove,
    onvifRelativeMove,
    onvifStop,
    probeOnvifPtz,
    reolinkOnvifContinuousVector,
} from '../onvif/onvifPtz.js';
import type { OnvifTarget } from './resolveOnvifTarget.js';
import {
    ReolinkClient,
    resolveReolinkTarget,
} from '../motion/providers/reolink/reolinkClient.js';
import {
    reolinkMoveDurationMs,
    reolinkPtzOpFromDelta,
    reolinkSpeedFromDeltas,
} from '../motion/providers/reolink/reolinkPtz.js';
import { withReolinkHostLock } from '../motion/providers/reolink/reolinkHostLock.js';

const logger = Logger.get('Ptz');

interface ActivePtz {
    backend: PtzBackend;
    invertPan: boolean;
    /** Motor position used for relative-move bookkeeping. */
    position: MptzState;
    /** Last absolute coords from SmartThings mptzSetPosition. */
    hubPosition: MptzState;
    onvifTarget?: OnvifTarget;
    reolink?: {
        client: ReolinkClient;
        channel: number;
        host: string;
        isNvr: boolean;
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Executes PTZ for bridged cameras (Reolink native API preferred, ONVIF fallback). */
export class PtzService {
    readonly #active = new Map<string, ActivePtz>();

    async probeCapability(camera: Camera): Promise<boolean> {
        const backend = resolvePtzBackend(camera);
        if (!backend) return false;

        if (backend === 'reolink') {
            const target = resolveReolinkTarget(camera);
            if (!target) return false;
            try {
                const client = new ReolinkClient(target.host, target.username, target.password, {
                    port: target.port,
                    useHttps: target.useHttps,
                });
                await client.ensureAuth();
                const stop = await client.ptzCtrlResult(target.channel, 'Stop');
                if (!stop.ok) {
                    logger.debug(
                        `Reolink PTZ probe rejected camera=${camera.id} host=${target.host} `
                        + `ch=${target.channel}: ${stop.error ?? 'unknown'}`,
                    );
                    return false;
                }
                return true;
            } catch (error) {
                logger.debug(`Reolink PTZ probe failed camera=${camera.id}: ${error}`);
                return false;
            }
        }

        const onvifTarget = resolveOnvifTargetForPtz(camera);
        if (!onvifTarget) return false;
        try {
            return await probeOnvifPtz(onvifTarget);
        } catch (error) {
            logger.debug(`ONVIF PTZ probe failed camera=${camera.id}: ${error}`);
            return false;
        }
    }

    start(camera: Camera): boolean {
        const backend = resolvePtzBackend(camera);
        if (!backend) {
            this.stop(camera.id);
            return false;
        }

        const active: ActivePtz = {
            backend,
            invertPan: camera.ptzInvertPan === true,
            position: { ...DEFAULT_MPTZ },
            hubPosition: { ...DEFAULT_MPTZ },
        };

        if (backend === 'reolink') {
            const target = resolveReolinkTarget(camera);
            if (!target) {
                this.stop(camera.id);
                return false;
            }
            active.reolink = {
                client: new ReolinkClient(target.host, target.username, target.password, {
                    port: target.port,
                    useHttps: target.useHttps,
                }),
                channel: target.channel,
                host: target.host,
                isNvr: camera.reolinkIsNvr === true,
            };
        } else {
            const onvifTarget = resolveOnvifTargetForPtz(camera);
            if (!onvifTarget) {
                this.stop(camera.id);
                return false;
            }
            active.onvifTarget = onvifTarget;
        }

        this.#active.set(camera.id, active);
        ptzContext.relativeMove.set(camera.id, request => this.#relativeMoveFromMatter(camera.id, request));
        ptzContext.setPosition.set(camera.id, target => this.#setPositionFromHub(camera.id, target));
        ptzContext.readPosition.set(camera.id, () => {
            const state = this.#active.get(camera.id);
            return state ? { ...state.position } : { ...DEFAULT_MPTZ };
        });
        ptzContext.readHubPosition.set(camera.id, () => {
            const state = this.#active.get(camera.id);
            return state ? { ...state.hubPosition } : { ...DEFAULT_MPTZ };
        });

        logger.info(`PTZ started camera=${camera.id} backend=${backend}`);
        return true;
    }

    stop(cameraId: string): void {
        this.#active.delete(cameraId);
        ptzContext.relativeMove.delete(cameraId);
        ptzContext.setPosition.delete(cameraId);
        ptzContext.readPosition.delete(cameraId);
        ptzContext.readHubPosition.delete(cameraId);
    }

    async testDirection(
        camera: Camera,
        direction: string,
        _speed = 0.3,
        stopAfterMs = 400,
    ): Promise<boolean> {
        const deltas: Record<string, { panDelta: number; tiltDelta: number; zoomDelta: number }> = {
            left: { panDelta: -10, tiltDelta: 0, zoomDelta: 0 },
            right: { panDelta: 10, tiltDelta: 0, zoomDelta: 0 },
            up: { panDelta: 0, tiltDelta: 10, zoomDelta: 0 },
            down: { panDelta: 0, tiltDelta: -10, zoomDelta: 0 },
            'zoom-in': { panDelta: 0, tiltDelta: 0, zoomDelta: 5 },
            'zoom-out': { panDelta: 0, tiltDelta: 0, zoomDelta: -5 },
        };
        const delta = deltas[direction.toLowerCase()];
        if (!delta) return false;

        if (!this.#active.has(camera.id)) {
            this.start(camera);
        }

        const ok = await this.#executeMove(camera.id, delta);
        if (ok && stopAfterMs > 0) {
            await sleep(stopAfterMs);
            await this.#stopActive(camera.id);
        }
        return ok;
    }

    #applyPanInvert(
        active: ActivePtz,
        request: { panDelta: number; tiltDelta: number; zoomDelta: number },
    ): { panDelta: number; tiltDelta: number; zoomDelta: number } {
        if (!active.invertPan || request.panDelta === 0) return request;
        return { ...request, panDelta: -request.panDelta };
    }

    /** mptzRelativeMove — SmartThings Android mirrors pan vs iOS setPosition stick. */
    async #relativeMoveFromMatter(
        cameraId: string,
        request: { panDelta: number; tiltDelta: number; zoomDelta: number },
    ): Promise<boolean> {
        const adjusted = invertMatterRelativePan(request);
        if (adjusted.panDelta !== request.panDelta) {
            logger.debug(
                `relativeMove pan invert camera=${cameraId} inΔ=${request.panDelta} outΔ=${adjusted.panDelta}`,
            );
        }
        return this.#executeMove(cameraId, adjusted);
    }

    async #executeMove(
        cameraId: string,
        request: { panDelta: number; tiltDelta: number; zoomDelta: number },
    ): Promise<boolean> {
        const active = this.#active.get(cameraId);
        if (!active) return false;

        const move = this.#applyPanInvert(active, request);
        const ok = active.backend === 'reolink'
            ? await this.#moveReolink(cameraId, move)
            : await this.#moveOnvif(cameraId, move);

        if (ok) {
            active.position = applyMptzRelativeMove(active.position, move);
        }
        return ok;
    }

    async #setPositionFromHub(cameraId: string, target: MptzState): Promise<boolean> {
        const active = this.#active.get(cameraId);
        if (!active) return false;

        const clamped = clampMptz(target);
        const move = stickSetPositionToMove(clamped);
        if (!move) {
            logger.debug(
                `setPosition noop camera=${cameraId} pan=${clamped.pan} tilt=${clamped.tilt}`,
            );
            return true;
        }

        logger.info(
            `setPosition move camera=${cameraId} stick pan=${clamped.pan} tilt=${clamped.tilt} `
            + `→ panΔ=${move.panDelta} tiltΔ=${move.tiltDelta}`,
        );
        return this.#executeMove(cameraId, move);
    }

    async #moveReolink(
        cameraId: string,
        request: { panDelta: number; tiltDelta: number; zoomDelta: number },
    ): Promise<boolean> {
        const reolink = this.#active.get(cameraId)?.reolink;
        if (!reolink) return false;

        const op = reolinkPtzOpFromDelta(request.panDelta, request.tiltDelta, request.zoomDelta);
        if (!op) return true;

        logger.info(
            `Reolink PTZ camera=${cameraId} op=${op} panΔ=${request.panDelta} tiltΔ=${request.tiltDelta}`,
        );

        const speed = reolinkSpeedFromDeltas(request.panDelta, request.tiltDelta, request.zoomDelta);
        const durationMs = reolinkMoveDurationMs(request.panDelta, request.tiltDelta);

        try {
            return await withReolinkHostLock(reolink.host, async () => {
                await reolink.client.ensureAuth();
                if (reolink.isNvr) {
                    await reolink.client.ptzCtrl(reolink.channel, 'Stop').catch(() => undefined);
                    await sleep(80);
                }

                let started = await reolink.client.ptzCtrlResult(reolink.channel, op, speed);
                if (!started.ok && speed !== undefined) {
                    started = await reolink.client.ptzCtrlResult(reolink.channel, op);
                }
                if (!started.ok) {
                    logger.warn(
                        `Reolink PtzCtrl rejected camera=${cameraId} host=${reolink.host} `
                        + `ch=${reolink.channel} op=${op}: ${started.error ?? 'unknown'}`,
                    );
                    return false;
                }

                await sleep(durationMs);
                await reolink.client.ptzCtrl(reolink.channel, 'Stop');
                return true;
            });
        } catch (error) {
            logger.warn(`Reolink PTZ failed camera=${cameraId} op=${op}: ${error}`);
            return false;
        }
    }

    async #moveOnvif(
        cameraId: string,
        request: { panDelta: number; tiltDelta: number; zoomDelta: number },
    ): Promise<boolean> {
        const active = this.#active.get(cameraId);
        const target = active?.onvifTarget;
        if (!target) return false;

        const pan = scalePanToOnvif(request.panDelta);
        const tilt = scaleTiltToOnvif(request.tiltDelta);
        const zoom = scaleZoomDeltaToOnvif(request.zoomDelta);
        const durationMs = reolinkMoveDurationMs(request.panDelta, request.tiltDelta);

        try {
            if (request.zoomDelta !== 0 && request.panDelta === 0 && request.tiltDelta === 0) {
                await onvifRelativeMove(target, { x: 0, y: 0, zoom });
                return true;
            }

            const vector = reolinkOnvifContinuousVector(request.panDelta, request.tiltDelta);
            await onvifContinuousMove(target, vector, durationMs);
            await onvifStop(target);
            return true;
        } catch (error) {
            logger.warn(`ONVIF PTZ failed camera=${cameraId}: ${error}`);
            try {
                await onvifRelativeMove(target, { x: pan, y: tilt, zoom });
                return true;
            } catch (fallbackError) {
                logger.warn(`ONVIF PTZ relative fallback failed camera=${cameraId}: ${fallbackError}`);
                return false;
            }
        }
    }

    async #stopActive(cameraId: string): Promise<void> {
        const active = this.#active.get(cameraId);
        if (!active) return;

        if (active.reolink) {
            try {
                await withReolinkHostLock(active.reolink.host, async () => {
                    await active.reolink!.client.ensureAuth();
                    await active.reolink!.client.ptzCtrl(active.reolink!.channel, 'Stop');
                });
            } catch {
                // ignore
            }
        }

        if (active.onvifTarget) {
            try {
                await onvifStop(active.onvifTarget);
            } catch {
                // ignore
            }
        }
    }
}
