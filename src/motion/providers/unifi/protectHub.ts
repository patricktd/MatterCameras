import { Logger } from '@matter/general';
import { ProtectApi } from 'unifi-protect';
import { motionConfig } from '../../../config/motion.js';
import { OnvifMotionDebouncer } from '../../../onvif/motionDebounce.js';
import type { ProtectTarget } from './protectTarget.js';

const logger = Logger.get('ProtectHub');

type ProtectHandler = {
    matterCameraId: string;
    protectCameraId: string;
    debouncer: OnvifMotionDebouncer;
};

interface ControllerState {
    api: ProtectApi;
    handlers: Map<string, ProtectHandler>;
    ready: Promise<void>;
}

const controllers = new Map<string, ControllerState>();

/** One Protect API + WebSocket per controller; route events to subscribed Matter cameras. */
export async function attachProtectMotion(
    matterCameraId: string,
    target: ProtectTarget,
    onActive: (active: boolean) => void,
    onPulse: () => void,
): Promise<void> {
    const key = target.host;
    let state = controllers.get(key);

    if (!state) {
        const api = new ProtectApi();
        const handlers = new Map<string, ProtectHandler>();
        let readyResolve!: () => void;
        let readyReject!: (err: unknown) => void;
        const ready = new Promise<void>((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });

        state = { api, handlers, ready };
        controllers.set(key, state);

        api.on('message', packet => {
            routePacket(handlers, packet as ProtectPacket);
        });

        void (async () => {
            try {
                const loggedIn = await api.login(target.host, target.username, target.password);
                if (!loggedIn) {
                    throw new Error('UniFi Protect login failed');
                }
                await api.getBootstrap();
                logger.info(`UniFi Protect connected controller=${key}`);
                readyResolve();
            } catch (error) {
                controllers.delete(key);
                readyReject(error);
            }
        })();
    }

    state.handlers.set(matterCameraId, {
        matterCameraId,
        protectCameraId: target.cameraId,
        debouncer: new OnvifMotionDebouncer(motionConfig.unifiHoldMs, onActive, onPulse),
    });

    await state.ready;
    logger.info(
        `UniFi Protect motion watching camera=${matterCameraId} protectId=${target.cameraId} controller=${key}`,
    );
}

export async function detachProtectMotion(matterCameraId: string, target: ProtectTarget): Promise<void> {
    const key = target.host;
    const state = controllers.get(key);
    if (!state) return;

    const handler = state.handlers.get(matterCameraId);
    handler?.debouncer.stop();
    state.handlers.delete(matterCameraId);

    if (state.handlers.size > 0) return;

    controllers.delete(key);
    state.api.removeAllListeners('message');
    try {
        state.api.logout();
    } catch {
        // ignore
    }
    logger.info(`UniFi Protect hub closed controller=${key}`);
}

interface ProtectPacket {
    header?: {
        modelKey?: string;
        action?: string;
        id?: string;
    };
    payload?: Record<string, unknown>;
}

function routePacket(handlers: Map<string, ProtectHandler>, packet: ProtectPacket): void {
    const header = packet.header;
    const payload = packet.payload;
    if (!header || !payload) return;

    if (header.modelKey === 'event' && header.action === 'add') {
        const cameraId = String(payload.camera ?? '');
        const type = String(payload.type ?? '');
        if (type === 'motion' && cameraId) {
            for (const handler of handlers.values()) {
                if (handler.protectCameraId !== cameraId) continue;
                handler.debouncer.pulse();
                logger.info(`UniFi Protect motion camera=${handler.matterCameraId} event=motion`);
            }
        }
        return;
    }

    if (header.modelKey === 'camera' && header.action === 'update') {
        const cameraId = String(header.id ?? '');
        const isMotion = payload.isMotionDetected === true;
        if (!isMotion || !cameraId) return;
        for (const handler of handlers.values()) {
            if (handler.protectCameraId !== cameraId) continue;
            handler.debouncer.pulse();
            logger.info(`UniFi Protect motion camera=${handler.matterCameraId} state=isMotionDetected`);
        }
    }
}
