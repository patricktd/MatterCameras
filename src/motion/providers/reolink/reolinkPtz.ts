export type ReolinkPtzOp =
    | 'Left'
    | 'Right'
    | 'Up'
    | 'Down'
    | 'LeftUp'
    | 'LeftDown'
    | 'RightUp'
    | 'RightDown'
    | 'ZoomInc'
    | 'ZoomDec'
    | 'Stop';

const PAN_THRESHOLD = 0.5;
const TILT_THRESHOLD = 0.5;
const ZOOM_THRESHOLD = 0.5;

/**
 * Map Matter PTZ deltas (degrees / zoom percent) to a Reolink PtzCtrl operation.
 * Returns null when the delta is below threshold (no movement).
 */
export function reolinkPtzOpFromDelta(
    panDelta: number,
    tiltDelta: number,
    zoomDelta: number,
): ReolinkPtzOp | null {
    const pan = Math.abs(panDelta) >= PAN_THRESHOLD ? Math.sign(panDelta) : 0;
    const tilt = Math.abs(tiltDelta) >= TILT_THRESHOLD ? Math.sign(tiltDelta) : 0;
    const zoom = Math.abs(zoomDelta) >= ZOOM_THRESHOLD ? Math.sign(zoomDelta) : 0;

    if (zoom > 0 && pan === 0 && tilt === 0) return 'ZoomInc';
    if (zoom < 0 && pan === 0 && tilt === 0) return 'ZoomDec';
    if (pan === 0 && tilt === 0) return null;

    if (pan > 0 && tilt > 0) return 'RightUp';
    if (pan > 0 && tilt < 0) return 'RightDown';
    if (pan < 0 && tilt > 0) return 'LeftUp';
    if (pan < 0 && tilt < 0) return 'LeftDown';
    if (pan > 0) return 'Right';
    if (pan < 0) return 'Left';
    if (tilt > 0) return 'Up';
    if (tilt < 0) return 'Down';
    return null;
}

/** Reolink speed 1–63 from delta magnitude (degrees). */
export function reolinkSpeedFromDeltas(panDelta: number, tiltDelta: number, zoomDelta: number): number {
    const magnitude = Math.max(Math.abs(panDelta), Math.abs(tiltDelta), Math.abs(zoomDelta) * 2);
    const scaled = Math.round(16 + magnitude * 1.5);
    return Math.min(63, Math.max(8, scaled));
}

/** Pulse duration for a Reolink directional move (ms). */
export function reolinkMoveDurationMs(panDelta: number, tiltDelta: number): number {
    const magnitude = Math.max(Math.abs(panDelta), Math.abs(tiltDelta));
    return Math.min(900, Math.max(180, Math.round(150 + magnitude * 12)));
}
