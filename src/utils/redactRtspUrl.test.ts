import assert from 'node:assert/strict';
import { redactRtspInText, redactRtspUrl } from './redactRtspUrl.js';

assert.equal(
    redactRtspUrl('rtsp://user:pass@192.168.1.10:554/stream1'),
    'rtsp://***@192.168.1.10:554/stream1',
);
assert.equal(
    redactRtspUrl('rtsp://192.168.1.10:554/stream1'),
    'rtsp://192.168.1.10:554/stream1',
);
assert.equal(
    redactRtspUrl('rtsps://admin:secret@cam.local/live'),
    'rtsps://***@cam.local/live',
);
assert.equal(redactRtspUrl(''), '<empty-url>');

assert.equal(
    redactRtspInText('failed src=rtsp://admin:secret@10.0.0.1/h264'),
    'failed src=rtsp://admin:***@10.0.0.1/h264',
);

console.log('redactRtspUrl.test.ts: ok');
