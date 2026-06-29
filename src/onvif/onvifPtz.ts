import { openOnvifCam, type OnvifCam } from './createOnvifCam.js';
import type { OnvifTarget } from '../streaming/resolveOnvifTarget.js';

export interface OnvifPtzVector {
    x: number;
    y: number;
    zoom: number;
}

type OnvifCallback = (err: Error | null, result?: unknown) => void;

function promisify<T>(fn: (cb: OnvifCallback) => void): Promise<T | void> {
    return new Promise((resolve, reject) => {
        fn((err, result) => {
            if (err) reject(err);
            else resolve(result as T | void);
        });
    });
}

/** Probe whether the ONVIF device exposes a PTZ service. */
export async function probeOnvifPtz(target: OnvifTarget): Promise<boolean> {
    const cam = await openOnvifCam(target);
    return Boolean((cam as OnvifCam & { uri?: { ptz?: string } }).uri?.ptz);
}

export async function onvifRelativeMove(
    target: OnvifTarget,
    vector: OnvifPtzVector,
): Promise<void> {
    const cam = await openOnvifCam(target);
    await promisify(cb => {
        (cam as OnvifCam & {
            relativeMove: (options: { x: number; y: number; zoom: number }, callback: OnvifCallback) => void;
        }).relativeMove({ x: vector.x, y: vector.y, zoom: vector.zoom }, cb);
    });
}

export async function onvifContinuousMove(
    target: OnvifTarget,
    vector: OnvifPtzVector,
    timeoutMs = 250,
): Promise<void> {
    const cam = await openOnvifCam(target);
    const camPtz = cam as OnvifCam & {
        continuousMove: (options: {
            x: number;
            y: number;
            zoom: number;
            timeout: number;
        }, callback: OnvifCallback) => void;
        stop: (options: { panTilt: boolean; zoom: boolean }, callback: OnvifCallback) => void;
    };

    await promisify(cb => {
        camPtz.continuousMove({
            x: vector.x,
            y: vector.y,
            zoom: vector.zoom,
            timeout: timeoutMs,
        }, cb);
    });
}

export async function onvifStop(target: OnvifTarget): Promise<void> {
    const cam = await openOnvifCam(target);
    await promisify(cb => {
        (cam as OnvifCam & {
            stop: (options: { panTilt: boolean; zoom: boolean }, callback: OnvifCallback) => void;
        }).stop({ panTilt: true, zoom: true }, cb);
    });
}

/**
 * Reolink ONVIF often ignores pure pan or pure tilt in continuous move.
 * Nudge the inactive axis slightly when one axis dominates.
 */
export function reolinkOnvifContinuousVector(panDelta: number, tiltDelta: number): OnvifPtzVector {
    let x = Math.sign(panDelta) * Math.min(1, Math.abs(panDelta) / 15);
    let y = Math.sign(tiltDelta) * Math.min(1, Math.abs(tiltDelta) / 15);

    if (x !== 0 && y === 0) y = 0.05 * Math.sign(x || 1);
    if (y !== 0 && x === 0) x = 0.05 * Math.sign(y || 1);

    return { x, y, zoom: 0 };
}
