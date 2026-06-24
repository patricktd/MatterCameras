import assert from 'node:assert/strict';
import { parseOnvifMotionEvent, parseOnvifMotionEventLegacy } from './parseOnvifMotionEvent.js';

{
    const signal = parseOnvifMotionEvent({
        topic: { _: 'tns1:RuleEngine/CellMotionDetector/Motion' },
        message: {
            data: {
                simpleItem: { $: { Name: 'IsMotion', Value: 'true' } },
            },
        },
    });
    assert.equal(signal?.kind, 'pulse');
    assert.equal(parseOnvifMotionEventLegacy({
        topic: { _: 'tns1:RuleEngine/CellMotionDetector/Motion' },
        message: {
            data: {
                simpleItem: { $: { Name: 'IsMotion', Value: 'true' } },
            },
        },
    }), true);
}

{
    const falseCell = parseOnvifMotionEvent({
        topic: 'tns1:RuleEngine/CellMotionDetector/Motion',
        message: {
            data: {
                simpleItem: { $: { Name: 'IsMotion', Value: 'false' } },
            },
        },
    });
    assert.equal(falseCell, undefined);
}

{
    const stop = parseOnvifMotionEvent({
        topic: 'tt:VideoSource/MotionAlarm',
        message: {
            data: {
                simpleItem: { $: { Name: 'State', Value: 'false' } },
            },
        },
    });
    assert.equal(stop?.kind, 'stop');
}

{
    const reolink = parseOnvifMotionEvent({
        topic: 'tns1:RuleEngine/PeopleDetect',
        message: {
            data: {
                simpleItem: { $: { Name: 'State', Value: 'true' } },
            },
        },
    });
    assert.equal(reolink?.kind, 'start');
}

console.log('parseOnvifMotionEvent.test.ts: ok');
