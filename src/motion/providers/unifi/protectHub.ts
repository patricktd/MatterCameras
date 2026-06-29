import { Logger } from '@matter/general';
import { ProtectApi } from 'unifi-protect';
import { OnvifMotionDebouncer } from '../../../onvif/motionDebounce.js';
import type { MotionObjectType } from '../../types.js';
import type { ProtectTarget } from './protectTarget.js';

const logger = Logger.get('ProtectHub');

type ProtectHandler = {
    matterCameraId: string;
    protectCameraId: string;
    motionObjectType: MotionObjectType;
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
    motionObjectType: MotionObjectType,
    holdMs: number,
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

    await state.ready;

    if (motionObjectType === 'person') {
        const camera = state.api.bootstrap?.cameras.find(row => row.id === target.cameraId);
        if (!protectCameraSupportsPersonDetection(camera)) {
            throw new Error('UniFi Protect person detection unavailable for this camera');
        }
    }

    state.handlers.set(matterCameraId, {
        matterCameraId,
        protectCameraId: target.cameraId,
        motionObjectType,
        debouncer: new OnvifMotionDebouncer(holdMs, onActive, onPulse),
    });

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

function normalizeProtectTypes(raw: unknown): string[] {
    return Array.isArray(raw)
        ? raw.map(value => String(value).trim().toLowerCase()).filter(Boolean)
        : [];
}

export function protectCameraSupportsPersonDetection(camera: Record<string, unknown> | undefined): boolean {
    if (!camera || typeof camera !== 'object') return false;

    const featureFlags = camera.featureFlags;
    if (!featureFlags || typeof featureFlags !== 'object') return false;
    if ((featureFlags as { hasSmartDetect?: unknown }).hasSmartDetect !== true) return false;

    const supportedTypes = new Set<string>([
        ...normalizeProtectTypes((featureFlags as { smartDetectTypes?: unknown }).smartDetectTypes),
        ...normalizeProtectTypes(
            (camera.extendedAiFeatures as { smartDetectTypes?: unknown } | undefined)?.smartDetectTypes,
        ),
    ]);

    return supportedTypes.size === 0 || supportedTypes.has('person');
}

export function protectPacketMatchesPersonDetection(packet: ProtectPacket, protectCameraId: string): boolean {
    const header = packet.header;
    const payload = packet.payload;
    if (!header || !payload) return false;
    if (header.modelKey !== 'event' || header.action !== 'add') return false;

    const cameraId = String(payload.camera ?? payload.cameraId ?? '');
    if (!cameraId || cameraId !== protectCameraId) return false;

    const type = String(payload.type ?? '');
    if (!type.startsWith('smartDetect')) return false;

    return normalizeProtectTypes(payload.smartDetectTypes).includes('person');
}

export function protectCameraUpdateMatchesPersonDetection(payload: Record<string, unknown>): boolean {
    return payload.isSmartDetected === true && normalizeProtectTypes(payload.smartDetectTypes).includes('person');
}

function routePacket(handlers: Map<string, ProtectHandler>, packet: ProtectPacket): void {
    const header = packet.header;
    const payload = packet.payload;
    if (!header || !payload) return;

    if (header.modelKey === 'event' && header.action === 'add') {
        const cameraId = String(payload.camera ?? payload.cameraId ?? '');
        const type = String(payload.type ?? '');
        if (cameraId) {
            for (const handler of handlers.values()) {
                if (handler.protectCameraId !== cameraId) continue;

                if (handler.motionObjectType === 'person') {
                    if (!protectPacketMatchesPersonDetection(packet, cameraId)) continue;
                    handler.debouncer.pulse();
                    logger.info(
                        `UniFi Protect motion camera=${handler.matterCameraId} event=${type} object=person`,
                    );
                    continue;
                }

                if (type !== 'motion') continue;
                handler.debouncer.pulse();
                logger.info(`UniFi Protect motion camera=${handler.matterCameraId} event=motion`);
            }
        }
        return;
    }

    if (header.modelKey === 'camera' && header.action === 'update') {
        const cameraId = String(header.id ?? '');
        if (!cameraId) return;
        for (const handler of handlers.values()) {
            if (handler.protectCameraId !== cameraId) continue;

            if (handler.motionObjectType === 'person') {
                if (!protectCameraUpdateMatchesPersonDetection(payload)) continue;
                handler.debouncer.pulse();
                logger.info(
                    `UniFi Protect motion camera=${handler.matterCameraId} state=isSmartDetected object=person`,
                );
                continue;
            }

            const isMotion = payload.isMotionDetected === true;
            if (!isMotion) continue;
            handler.debouncer.pulse();
            logger.info(`UniFi Protect motion camera=${handler.matterCameraId} state=isMotionDetected`);
        }
    }
}
