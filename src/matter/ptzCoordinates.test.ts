import assert from 'node:assert/strict';
import {
    applyMptzRelativeMove,
    deltaToSetPositionMove,
    mergeMptzSetPosition,
    mergeSetPositionHub,
    mptzDelta,
    scalePanToOnvif,
    stickSetPositionToMove,
    invertMatterRelativePan,
} from './ptzCoordinates.js';
import { reolinkPtzOpFromDelta, reolinkSpeedFromDeltas, reolinkMoveDurationMs } from '../motion/providers/reolink/reolinkPtz.js';
import { resolvePtzBackend, shouldExposePtz, canCameraProbePtz } from './ptzConfig.js';
import type { Camera } from '../types/index.js';

assert.equal(scalePanToOnvif(90), 0.5);
assert.equal(scalePanToOnvif(-180), -1);

const merged = mergeMptzSetPosition({ pan: 0, tilt: 0, zoom: 1 }, { pan: 20 });
assert.equal(merged.pan, 20);

const hubMerged = mergeSetPositionHub(
    { pan: 10, tilt: 0, zoom: 1 },
    { pan: 0, tilt: 60, zoom: 11 },
);
assert.deepEqual(hubMerged, { pan: 0, tilt: 0, zoom: 1 });

const relative = applyMptzRelativeMove({ pan: 10, tilt: 0, zoom: 1 }, { panDelta: 5, tiltDelta: -3 });
assert.equal(relative.pan, 15);
assert.equal(relative.tilt, -3);

assert.equal(reolinkPtzOpFromDelta(10, 0, 0), 'Right');
assert.equal(reolinkPtzOpFromDelta(-10, 10, 0), 'LeftUp');
assert.equal(reolinkPtzOpFromDelta(0, 0, 5), 'ZoomInc');
assert.equal(reolinkPtzOpFromDelta(0, 0, 0), null);

assert.ok(reolinkSpeedFromDeltas(10, 0, 0) >= 8);

const delta = mptzDelta({ pan: 10, tilt: 0, zoom: 1 }, { pan: 30, tilt: 10, zoom: 2 });
assert.deepEqual(delta, { panDelta: 20, tiltDelta: 10, zoomDelta: 1 });

assert.deepEqual(
    invertMatterRelativePan({ panDelta: 10, tiltDelta: 0, zoomDelta: 0 }),
    { panDelta: -10, tiltDelta: 0, zoomDelta: 0 },
);
assert.deepEqual(
    invertMatterRelativePan({ panDelta: 0, tiltDelta: -10, zoomDelta: 0 }),
    { panDelta: 0, tiltDelta: -10, zoomDelta: 0 },
);

// Virtual stick (SmartThings hub 61.x): each ±10 value is a pulse, repeats while held.
assert.deepEqual(
    stickSetPositionToMove({ pan: 10, tilt: 0, zoom: 1 }),
    { panDelta: 10, tiltDelta: 0, zoomDelta: 0 },
);
assert.deepEqual(
    stickSetPositionToMove({ pan: -10, tilt: 0, zoom: 1 }),
    { panDelta: -10, tiltDelta: 0, zoomDelta: 0 },
);
assert.deepEqual(
    stickSetPositionToMove({ pan: -10, tilt: 0, zoom: 1 }),
    { panDelta: -10, tiltDelta: 0, zoomDelta: 0 },
);
assert.deepEqual(
    stickSetPositionToMove({ pan: 0, tilt: 10, zoom: 1 }),
    { panDelta: 0, tiltDelta: 10, zoomDelta: 0 },
);
assert.equal(stickSetPositionToMove({ pan: 0, tilt: 0, zoom: 1 }), null);
assert.equal(stickSetPositionToMove({ pan: 20, tilt: 0, zoom: 1 }), null);

// Legacy delta path (preset jumps between accumulated coords).
assert.deepEqual(
    deltaToSetPositionMove({ pan: 10, tilt: 50, zoom: 11 }, { pan: 0, tilt: 50, zoom: 11 }),
    { panDelta: -10, tiltDelta: 0, zoomDelta: 0 },
);
assert.equal(
    deltaToSetPositionMove({ pan: 0, tilt: 0, zoom: 1 }, { pan: 20, tilt: 60, zoom: 11 }),
    null,
);
assert.deepEqual(
    deltaToSetPositionMove({ pan: 10, tilt: 50, zoom: 11 }, { pan: 20, tilt: 50, zoom: 11 }),
    { panDelta: 10, tiltDelta: 0, zoomDelta: 0 },
);
assert.deepEqual(
    deltaToSetPositionMove({ pan: 0, tilt: 10, zoom: 1 }, { pan: 10, tilt: 0, zoom: 1 }),
    { panDelta: 10, tiltDelta: 0, zoomDelta: 0 },
);

assert.equal(reolinkMoveDurationMs(10, 0), 270);

const reolinkCam: Camera = {
    id: 'cam-1',
    name: 'TrackMix',
    rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/h264Preview_01_main',
    manufacturer: 'Reolink',
    username: 'admin',
    password: 'pass',
};
assert.equal(resolvePtzBackend(reolinkCam), 'reolink');
assert.equal(canCameraProbePtz(reolinkCam), true);
assert.equal(shouldExposePtz({ ...reolinkCam, ptzCapable: true }), true);
assert.equal(shouldExposePtz(reolinkCam), false);

const unifiCam: Camera = {
    id: 'cam-u',
    name: 'G4',
    rtspUrl: 'rtsps://user:pass@192.168.1.70:7441/abc',
    addSource: 'unifi-protect',
    protectHost: '192.168.1.70',
    protectCameraId: 'abc123',
    username: 'user',
    password: 'pass',
};
assert.equal(resolvePtzBackend(unifiCam), null);
assert.equal(canCameraProbePtz(unifiCam), false);
assert.equal(shouldExposePtz(unifiCam), false);

const onvifCam: Camera = {
    id: 'cam-2',
    name: 'ONVIF',
    rtspUrl: 'rtsp://user:pass@192.168.1.60:554/stream',
    onvifUrl: 'http://192.168.1.60:8000/onvif/device_service',
    username: 'user',
    password: 'pass',
    ptzBackend: 'onvif',
};
assert.equal(resolvePtzBackend(onvifCam), 'onvif');

console.log('ptzCoordinates.test.ts: ok');
