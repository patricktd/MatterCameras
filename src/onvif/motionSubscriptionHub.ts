import { Logger } from '@matter/general';
import type { OnvifCam } from './createOnvifCam.js';
import {
    connectOnvifCam,
    createOnvifCamDisconnected,
    endpointKey,
} from './createOnvifCam.js';
import { motionConfig } from '../config/motion.js';
import { OnvifMotionDebouncer } from './motionDebounce.js';
import { cameraSupportsOnvifMotion, collectMotionTopics } from './motionTopics.js';
import { parseOnvifMotionEvent } from './parseOnvifMotionEvent.js';
import type { OnvifTarget } from '../streaming/resolveOnvifTarget.js';

const logger = Logger.get('OnvifMotionHub');

type MotionHandler = {
    debouncer: OnvifMotionDebouncer;
};

interface EndpointState {
    cam: OnvifCam;
    handlers: Map<string, MotionHandler>;
    ready: Promise<void>;
}

const endpoints = new Map<string, EndpointState>();

/**
 * One ONVIF PullPoint subscription per device endpoint.
 * NVRs (same host:port/path) reject a second CreatePullPointSubscription (SOAP-ENV:Sender).
 */
export async function attachOnvifMotion(
    cameraId: string,
    target: OnvifTarget,
    onActive: (active: boolean) => void,
    onPulse: () => void,
): Promise<void> {
    const key = endpointKey(target);
    let state = endpoints.get(key);

    if (!state) {
        const cam = createOnvifCamDisconnected(target);
        const handlers = new Map<string, MotionHandler>();
        let readyResolve!: () => void;
        let readyReject!: (err: unknown) => void;
        const ready = new Promise<void>((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });

        state = { cam, handlers, ready };
        endpoints.set(key, state);

        cam.on('eventsError', (error: unknown) => {
            logger.warn(`ONVIF events error endpoint=${key}: ${error}`);
        });

        void (async () => {
            try {
                await connectOnvifCam(cam);

                const props = await getEventProperties(cam);
                const topics = collectMotionTopics(props);
                if (!cameraSupportsOnvifMotion(props)) {
                    logger.warn(
                        `ONVIF motion endpoint=${key} — GetEventProperties has no motion topics`,
                    );
                } else {
                    logger.info(
                        `ONVIF motion connected endpoint=${key} motionTopics=${topics.length}`,
                    );
                }

                // PullPoint starts when the first `event` listener is registered (onvif lib).
                cam.on('event', (message: unknown) => {
                    const signal = parseOnvifMotionEvent(message);
                    if (!signal) return;
                    for (const [id, handler] of handlers) {
                        dispatchMotion(id, handler, signal.kind);
                    }
                });

                readyResolve();
            } catch (error) {
                endpoints.delete(key);
                readyReject(error);
            }
        })();
    }

    state.handlers.set(cameraId, {
        debouncer: new OnvifMotionDebouncer(
            motionConfig.onvifHoldMs,
            onActive,
            onPulse,
        ),
    });
    await state.ready;
    logger.info(`ONVIF motion watching camera=${cameraId} endpoint=${key}`);
}

export async function detachOnvifMotion(cameraId: string, target: OnvifTarget): Promise<void> {
    const key = endpointKey(target);
    const state = endpoints.get(key);
    if (!state) return;

    const handler = state.handlers.get(cameraId);
    handler?.debouncer.stop();
    state.handlers.delete(cameraId);

    if (state.handlers.size > 0) return;

    endpoints.delete(key);
    const cam = state.cam;
    try {
        cam.removeAllListeners('event');
        cam.removeAllListeners('eventsError');
        await unsubscribeCam(cam);
    } catch {
        // ignore teardown errors
    }
    logger.info(`ONVIF motion hub closed endpoint=${key}`);
}

function dispatchMotion(cameraId: string, handler: MotionHandler, kind: 'pulse' | 'start' | 'stop'): void {
    // Scrypted: MotionStop re-extends hold when already active; all kinds extend the debounce window.
    handler.debouncer.pulse();
    logger.info(`ONVIF motion camera=${cameraId} signal=${kind}`);
}

function getEventProperties(cam: OnvifCam): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        cam.getEventProperties((err: Error | null, props: Record<string, unknown>) => {
            if (err) reject(err);
            else resolve(props);
        });
    });
}

function unsubscribeCam(cam: OnvifCam): Promise<void> {
    return new Promise(resolve => {
        const unsub = (cam as OnvifCam & { unsubscribe?: (cb: () => void, keep?: boolean) => void })
            .unsubscribe;
        if (typeof unsub !== 'function') {
            resolve();
            return;
        }
        unsub.call(cam, () => resolve(), true);
    });
}
