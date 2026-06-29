import type { Camera } from '../types/index.js';
import { cameraLooksLikeReolink } from '../motion/providers/reolink/reolinkClient.js';
import { canCameraExposeReolinkLight, reolinkLightEndpointId, shouldExposeReolinkLight } from './reolinkLightConfig.js';

const PERSON_SENSOR_ID_PREFIX = 'person-';

export const DEFAULT_PERSON_SENSOR_HOLD_SEC = 60;
export const MIN_PERSON_SENSOR_HOLD_SEC = 5;
export const MAX_PERSON_SENSOR_HOLD_SEC = 600;

export function clampPersonSensorHoldSec(seconds: number): number {
    return Math.min(MAX_PERSON_SENSOR_HOLD_SEC, Math.max(MIN_PERSON_SENSOR_HOLD_SEC, Math.floor(seconds)));
}

/** Hold duration for person-only motion subscriptions (Reolink / UniFi person sensor). */
export function resolvePersonSensorHoldMs(camera: Pick<Camera, 'personSensorHoldSec'>): number {
    const seconds = camera.personSensorHoldSec ?? DEFAULT_PERSON_SENSOR_HOLD_SEC;
    return clampPersonSensorHoldSec(seconds) * 1_000;
}

export function personSensorEndpointId(cameraId: string): string {
    return `${PERSON_SENSOR_ID_PREFIX}${cameraId}`;
}

export function isPersonSensorEndpointId(id: string): boolean {
    return id.startsWith(PERSON_SENSOR_ID_PREFIX);
}

export function baseCameraIdFromPersonSensorId(id: string): string | null {
    if (!isPersonSensorEndpointId(id)) return null;
    return id.slice(PERSON_SENSOR_ID_PREFIX.length) || null;
}

export function personSensorLabel(camera: Pick<Camera, 'name'>): string {
    return `${camera.name} Person Presence`;
}

export function canCameraExposePersonSensor(camera: Camera): boolean {
    const protectConfigured = Boolean(camera.protectHost?.trim() && camera.protectCameraId?.trim());
    if (protectConfigured) return true;
    if (camera.addSource === 'reolink') return true;
    return cameraLooksLikeReolink(camera);
}

export function shouldExposePersonSensor(camera: Camera): boolean {
    return camera.personSensorEnabled === true && canCameraExposePersonSensor(camera);
}

/** Motion subscription for the main Matter camera endpoint — always generic motion. */
export function buildCameraMotionCamera(camera: Camera): Camera {
    return {
        ...camera,
        motionObjectType: 'any',
    };
}

export function buildPersonSensorMotionCamera(camera: Camera): Camera {
    const preferredSource = camera.motionSource === 'unifi-protect' || camera.motionSource === 'reolink-native'
        ? camera.motionSource
        : 'auto';

    return {
        ...camera,
        id: personSensorEndpointId(camera.id),
        name: personSensorLabel(camera),
        motionSource: preferredSource,
        motionObjectType: 'person',
        personSensorEnabled: false,
    };
}

/**
 * Normalize persisted motion settings: camera motion is always generic; person detection
 * is only exposed via the optional bridged occupancy sensor.
 */
export function finalizeCameraMotionSettings(camera: Camera): Camera {
    const personCapable = canCameraExposePersonSensor(camera);
    let personSensorEnabled = camera.personSensorEnabled === true && personCapable;

    if (camera.motionObjectType === 'person' && personCapable) {
        personSensorEnabled = true;
    }

    const reolinkLightEnabled = camera.reolinkLightEnabled === true
        && canCameraExposeReolinkLight(camera)
        && camera.reolinkLightCapable !== false;

    const normalized: Camera = {
        ...camera,
        motionObjectType: 'any',
        personSensorEnabled,
        reolinkLightEnabled,
        personSensorHoldSec: personSensorEnabled
            ? clampPersonSensorHoldSec(camera.personSensorHoldSec ?? DEFAULT_PERSON_SENSOR_HOLD_SEC)
            : camera.personSensorHoldSec,
    };

    if (!canCameraExposeReolinkLight(camera)) {
        delete normalized.reolinkLightCapable;
    }

    return normalized;
}

export function expectedBridgedEndpointIds(cameras: Camera[]): Set<string> {
    const ids = new Set<string>();
    for (const camera of cameras) {
        ids.add(camera.id);
        if (shouldExposePersonSensor(camera)) {
            ids.add(personSensorEndpointId(camera.id));
        }
        if (shouldExposeReolinkLight(camera)) {
            ids.add(reolinkLightEndpointId(camera.id));
        }
    }
    return ids;
}

export function countBridgedEndpoints(cameras: Camera[]): number {
    return expectedBridgedEndpointIds(cameras).size;
}