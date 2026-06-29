export interface MptzState {
    pan: number;
    tilt: number;
    zoom: number;
}

export const DEFAULT_MPTZ: MptzState = { pan: 0, tilt: 0, zoom: 1 };

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number(value) || 0));
}

export function clampMptz(state: MptzState): MptzState {
    return {
        pan: clamp(state.pan, -180, 180),
        tilt: clamp(state.tilt, -90, 90),
        zoom: clamp(state.zoom, 1, 100),
    };
}

/** Matter degrees → ONVIF normalized pan (-1..1). */
export function scalePanToOnvif(pan: number): number {
    return clamp(pan / 180, -1, 1);
}

/** Matter degrees → ONVIF normalized tilt (-1..1). */
export function scaleTiltToOnvif(tilt: number): number {
    return clamp(tilt / 90, -1, 1);
}

/** Matter zoom (1..100) → ONVIF normalized zoom (0..1). */
export function scaleZoomToOnvif(zoom: number): number {
    return clamp((zoom - 1) / 99, 0, 1);
}

/** Matter zoom delta (percent) → ONVIF relative zoom. */
export function scaleZoomDeltaToOnvif(zoomDelta: number): number {
    return clamp(zoomDelta / 100, -1, 1);
}

/** Max degrees per axis treated as a d-pad tap on mptzSetPosition (SmartThings Android). */
export const SET_POSITION_MAX_STEP = 15;

export function mergeMptzSetPosition(
    current: MptzState,
    request: { pan?: number; tilt?: number; zoom?: number },
): MptzState {
    return clampMptz({
        pan: request.pan ?? current.pan,
        tilt: request.tilt ?? current.tilt,
        zoom: request.zoom ?? current.zoom,
    });
}

/**
 * Strip SmartThings Android encoding from mptzSetPosition before hub tracking.
 * Zoom > 15 is a preset slot, not optical zoom. Tilt 50–90 is virtual stick encoding, not degrees.
 */
export function normalizeSetPositionRequest(
    request: { pan?: number; tilt?: number; zoom?: number },
): { pan?: number; tilt?: number } {
    const out: { pan?: number; tilt?: number } = {};
    if (request.pan !== undefined) out.pan = request.pan;
    if (request.tilt !== undefined && Math.abs(request.tilt) <= SET_POSITION_MAX_STEP) {
        out.tilt = request.tilt;
    }
    return out;
}

/** Merge hub position for mptzSetPosition — never tracks zoom preset slots. */
export function mergeSetPositionHub(
    hub: MptzState,
    request: { pan?: number; tilt?: number; zoom?: number },
): MptzState {
    const normalized = normalizeSetPositionRequest(request);
    return clampMptz({
        pan: normalized.pan ?? hub.pan,
        tilt: normalized.tilt ?? hub.tilt,
        zoom: 1,
    });
}

export function applyMptzRelativeMove(
    current: MptzState,
    request: { panDelta?: number; tiltDelta?: number; zoomDelta?: number },
): MptzState {
    return clampMptz({
        pan: (current.pan ?? 0) + (request.panDelta ?? 0),
        tilt: (current.tilt ?? 0) + (request.tiltDelta ?? 0),
        zoom: (current.zoom ?? 1) + (request.zoomDelta ?? 0),
    });
}

export function mptzDelta(from: MptzState, to: MptzState): {
    panDelta: number;
    tiltDelta: number;
    zoomDelta: number;
} {
    return {
        panDelta: to.pan - from.pan,
        tiltDelta: to.tilt - from.tilt,
        zoomDelta: to.zoom - from.zoom,
    };
}

export interface PtzMoveDelta {
    panDelta: number;
    tiltDelta: number;
    zoomDelta: number;
}

/** SmartThings Android sends mirrored pan on mptzRelativeMove vs iOS mptzSetPosition. */
export function invertMatterRelativePan(request: PtzMoveDelta): PtzMoveDelta {
    if (request.panDelta === 0) return request;
    return { ...request, panDelta: -request.panDelta };
}

/**
 * SmartThings hub 61.x sends mptzSetPosition as a virtual stick (±10), not cumulative degrees.
 * Repeating pan=-10 while holding left must pulse again — delta tracking wrongly no-ops.
 */
export function stickSetPositionToMove(target: MptzState): PtzMoveDelta | null {
    const { pan, tilt } = target;
    if (pan === 0 && tilt === 0) return null;

    let panDelta = 0;
    let tiltDelta = 0;

    if (pan !== 0) {
        if (Math.abs(pan) > SET_POSITION_MAX_STEP) return null;
        panDelta = pan;
    }
    if (tilt !== 0) {
        if (Math.abs(tilt) > SET_POSITION_MAX_STEP) return null;
        tiltDelta = tilt;
    }

    if (panDelta !== 0 && tiltDelta !== 0) {
        if (Math.abs(panDelta) >= Math.abs(tiltDelta)) {
            tiltDelta = 0;
        } else {
            panDelta = 0;
        }
    }

    if (panDelta === 0 && tiltDelta === 0) return null;
    return { panDelta, tiltDelta, zoomDelta: 0 };
}

/**
 * @deprecated Prefer {@link stickSetPositionToMove} — delta tracking no-ops on virtual-stick repeats.
 */
export function deltaToSetPositionMove(from: MptzState, to: MptzState): PtzMoveDelta | null {
    const raw = mptzDelta(from, to);
    let panDelta = Math.abs(raw.panDelta) <= SET_POSITION_MAX_STEP ? raw.panDelta : 0;
    let tiltDelta = Math.abs(raw.tiltDelta) <= SET_POSITION_MAX_STEP ? raw.tiltDelta : 0;

    // Android often bundles pan+tilt on a single-axis tap — keep the dominant axis only.
    if (panDelta !== 0 && tiltDelta !== 0) {
        if (Math.abs(panDelta) >= Math.abs(tiltDelta)) {
            tiltDelta = 0;
        } else {
            panDelta = 0;
        }
    }

    if (panDelta === 0 && tiltDelta === 0) {
        return null;
    }

    return { panDelta, tiltDelta, zoomDelta: 0 };
}
