import assert from 'node:assert/strict';
import { parseCameraMotionFields, parseMotionObjectType, parseOptionalBoolean, sanitizeCameraMotionFields } from './parseMotionForm.js';

assert.equal(parseOptionalBoolean(true), true);
assert.equal(parseOptionalBoolean('true'), true);
assert.equal(parseOptionalBoolean('1'), true);
assert.equal(parseOptionalBoolean(false), false);
assert.equal(parseOptionalBoolean('false'), false);
assert.equal(parseOptionalBoolean('0'), false);
assert.equal(parseOptionalBoolean(''), undefined);
assert.equal(parseOptionalBoolean(['false', 'true']), true);
assert.equal(parseOptionalBoolean(['false']), false);
assert.equal(parseMotionObjectType('person'), 'person');
assert.equal(parseMotionObjectType('unknown'), 'any');

{
    const parsed = parseCameraMotionFields({
        motionSource: 'reolink-native',
        presenceSensorEnabled: 'true',
        reolinkLightEnabled: 'true',
        username: 'admin',
        password: 'secret',
        reolinkChannel: '3',
        reolinkHost: '192.168.1.20',
        reolinkHttpPort: '8443',
        reolinkUseHttps: 'true',
        reolinkRtspPort: '1554',
        reolinkProtocol: 'rtsp',
        reolinkStream: 'main',
        reolinkDeviceUid: 'uid-123',
        reolinkIsNvr: 'false',
        manufacturer: 'Reolink',
        model: 'RLN8',
        addSource: 'reolink',
    });

    assert.deepEqual(parsed, {
        motionSource: 'reolink-native',
        motionObjectType: 'any',
        personSensorEnabled: true,
        personSensorHoldSec: undefined,
        reolinkLightEnabled: true,
        onvifUrl: undefined,
        username: 'admin',
        password: 'secret',
        manufacturer: 'Reolink',
        model: 'RLN8',
        reolinkChannel: 3,
        reolinkHost: '192.168.1.20',
        reolinkHttpPort: 8443,
        reolinkUseHttps: true,
        reolinkRtspPort: 1554,
        reolinkProtocol: 'rtsp',
        reolinkStream: 'main',
        reolinkDeviceUid: 'uid-123',
        reolinkIsNvr: false,
        protectHost: undefined,
        protectCameraId: undefined,
        addSource: 'reolink',
    });
}

{
    const parsed = parseCameraMotionFields({
        motionSource: 'auto',
        personSensorEnabled: ['false', 'true'],
        reolinkLightEnabled: ['false', 'true'],
        manufacturer: 'Reolink',
        addSource: 'reolink',
    });

    assert.equal(parsed.personSensorEnabled, true);
    assert.equal(parsed.reolinkLightEnabled, true);
}

{
    const parsed = parseCameraMotionFields({
        personSensorHoldSec: '90',
        addSource: 'reolink',
    });
    assert.equal(parsed.personSensorHoldSec, 90);
}

{
    const parsed = parseCameraMotionFields({
        personSensorHoldSec: '2',
        addSource: 'reolink',
    });
    assert.equal(parsed.personSensorHoldSec, 5);
}

{
    const parsed = sanitizeCameraMotionFields({
        motionSource: 'auto',
        personSensorEnabled: 'true',
        reolinkLightEnabled: 'true',
        reolinkChannel: '2',
        protectHost: '192.168.1.1',
        protectCameraId: 'abc123',
        addSource: 'unifi-protect',
        manufacturer: 'Ubiquiti',
    });

    assert.equal(parsed.personSensorEnabled, true);
    assert.equal(parsed.reolinkLightEnabled, false);
    assert.equal(parsed.reolinkChannel, undefined);
    assert.equal(parsed.protectHost, '192.168.1.1');
}

console.log('parseMotionForm.test.ts: ok');