import type { MptzState } from '../ptzCoordinates.js';

export interface PtzMoveRequest {
    panDelta: number;
    tiltDelta: number;
    zoomDelta: number;
}

export type PtzMoveHandler = (request: PtzMoveRequest) => Promise<boolean>;
export type PtzSetPositionHandler = (target: MptzState) => Promise<boolean>;

export type PtzReadPositionHandler = () => MptzState;

/** Handlers registered by {@link PtzService} for bridged camera endpoints. */
export const ptzContext = {
    relativeMove: new Map<string, PtzMoveHandler>(),
    setPosition: new Map<string, PtzSetPositionHandler>(),
    readPosition: new Map<string, PtzReadPositionHandler>(),
    readHubPosition: new Map<string, PtzReadPositionHandler>(),
};
