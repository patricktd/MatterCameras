import assert from 'node:assert/strict';
import { resolveOnvifTarget } from './resolveOnvifTarget.js';
import { parseOnvifMotionEventLegacy } from '../onvif/parseOnvifMotionEvent.js';

// resolveOnvifTarget
{
    const t = resolveOnvifTarget({
        id: 'cam-1',
        name: 'Test',
        rtspUrl: 'rtsp://user:pass@192.168.1.10:554/stream',
        onvifUrl: 'http://192.168.1.87:8000/onvif/device_service',
        motionSource: 'onvif',
    });
    assert.equal(t?.hostname, '192.168.1.87');
    assert.equal(t?.port, 8000);
    assert.equal(t?.path, '/onvif/device_service');
    assert.equal(t?.username, 'user');
    assert.equal(t?.password, 'pass');
}

{
    const t = resolveOnvifTarget({
        id: 'cam-2',
        name: 'Test',
        rtspUrl: 'rtsp://192.168.1.240:554/live',
        motionSource: 'onvif',
    });
    assert.equal(t?.hostname, '192.168.1.240');
    assert.equal(t?.port, 80);
    assert.equal(t?.path, '/onvif/device_service');
}

// parseOnvifMotionEvent
{
    const active = parseOnvifMotionEventLegacy({
        topic: { _: 'tns1:RuleEngine/CellMotionDetector/Motion' },
        message: {
            data: {
                simpleItem: { $: { Name: 'IsMotion', Value: 'true' } },
            },
        },
    });
    assert.equal(active, true);
}

{
    const inactive = parseOnvifMotionEventLegacy({
        topic: 'tt:VideoSource/MotionAlarm',
        message: {
            data: {
                simpleItem: { $: { Name: 'State', Value: 'false' } },
            },
        },
    });
    assert.equal(inactive, false);
}

{
    const ignored = parseOnvifMotionEventLegacy({
        topic: 'tns1:Device/Trigger/DigitalInput',
        message: { data: { simpleItem: { $: { Name: 'State', Value: 'true' } } } },
    });
    assert.equal(ignored, undefined);
}

console.log('resolveOnvifTarget + parseOnvifMotionEvent: ok');
