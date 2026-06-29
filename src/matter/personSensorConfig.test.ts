import assert from 'node:assert/strict';
import type { Camera } from '../types/index.js';
import {
    baseCameraIdFromPersonSensorId,
    buildCameraMotionCamera,
    buildPersonSensorMotionCamera,
    canCameraExposePersonSensor,
    clampPersonSensorHoldSec,
    countBridgedEndpoints,
    expectedBridgedEndpointIds,
    finalizeCameraMotionSettings,
    isPersonSensorEndpointId,
    personSensorEndpointId,
    personSensorLabel,
    resolvePersonSensorHoldMs,
    shouldExposePersonSensor,
} from './personSensorConfig.js';

const reolinkCamera: Camera = {
    id: 'cam-1',
    name: 'Hallway',
    rtspUrl: 'rtsp://user:pass@192.168.1.30:554/h264Preview_01_main',
    manufacturer: 'Reolink',
    motionSource: 'auto',
    personSensorEnabled: true,
};

assert.equal(personSensorEndpointId('cam-1'), 'person-cam-1');
assert.equal(isPersonSensorEndpointId('person-cam-1'), true);
assert.equal(baseCameraIdFromPersonSensorId('person-cam-1'), 'cam-1');
assert.equal(baseCameraIdFromPersonSensorId('cam-1'), null);
assert.equal(personSensorLabel(reolinkCamera), 'Hallway Person Presence');
assert.equal(canCameraExposePersonSensor(reolinkCamera), true);
assert.equal(shouldExposePersonSensor(reolinkCamera), true);

assert.equal(resolvePersonSensorHoldMs({}), 60_000);
assert.equal(resolvePersonSensorHoldMs({ personSensorHoldSec: 120 }), 120_000);
assert.equal(clampPersonSensorHoldSec(2), 5);

assert.deepEqual(buildPersonSensorMotionCamera(reolinkCamera), {
    ...reolinkCamera,
    id: 'person-cam-1',
    name: 'Hallway Person Presence',
    motionSource: 'auto',
    motionObjectType: 'person',
    personSensorEnabled: false,
});

assert.deepEqual(buildCameraMotionCamera({
    ...reolinkCamera,
    motionObjectType: 'person',
}), {
    ...reolinkCamera,
    motionObjectType: 'any',
});

assert.deepEqual(finalizeCameraMotionSettings({
    ...reolinkCamera,
    motionObjectType: 'person',
    personSensorEnabled: false,
}), {
    ...reolinkCamera,
    motionObjectType: 'any',
    personSensorEnabled: true,
    personSensorHoldSec: 60,
    reolinkLightEnabled: false,
});

assert.deepEqual(finalizeCameraMotionSettings({
    ...reolinkCamera,
    personSensorHoldSec: 180,
}), {
    ...reolinkCamera,
    motionObjectType: 'any',
    personSensorEnabled: true,
    personSensorHoldSec: 180,
    reolinkLightEnabled: false,
});

assert.deepEqual(finalizeCameraMotionSettings({
    ...reolinkCamera,
    reolinkLightEnabled: true,
    reolinkLightCapable: false,
}), {
    ...reolinkCamera,
    motionObjectType: 'any',
    personSensorEnabled: true,
    personSensorHoldSec: 60,
    reolinkLightEnabled: false,
    reolinkLightCapable: false,
});

{
    const plainCamera: Camera = {
        id: 'cam-2',
        name: 'Generic',
        rtspUrl: 'rtsp://user:pass@192.168.1.40:554/stream',
        motionSource: 'frame-diff',
        personSensorEnabled: true,
    };
    assert.equal(canCameraExposePersonSensor(plainCamera), false);
    assert.equal(shouldExposePersonSensor(plainCamera), false);
}

assert.deepEqual(
    [...expectedBridgedEndpointIds([reolinkCamera])].sort(),
    ['cam-1', 'person-cam-1'],
);
assert.equal(countBridgedEndpoints([reolinkCamera]), 2);

console.log('personSensorConfig.test.ts: ok');