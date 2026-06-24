import assert from 'node:assert/strict';
import { buildProtectRtspUrl, pickProtectStreamChannel } from './buildProtectRtsp.js';
import { extractProtectRtspAlias } from './unifi/protectApi.js';

assert.equal(
    buildProtectRtspUrl({
        controllerHost: '192.168.1.1',
        username: 'admin',
        password: 'secret',
        rtspAlias: 'abc123',
    }),
    'rtsps://admin:secret@192.168.1.1:7441/abc123',
);

assert.equal(
    buildProtectRtspUrl({
        controllerHost: '192.168.1.1',
        connectionHost: '192.168.1.50',
        username: 'u',
        password: 'p',
        rtspAlias: 'x',
    }),
    'rtsps://u:p@192.168.1.50:7441/x',
);

const picked = pickProtectStreamChannel([
    { rtspAlias: 'a', width: 640, height: 480 },
    { rtspAlias: 'b', width: 1920, height: 1080 },
]);
assert.equal(picked?.rtspAlias, 'b');

assert.equal(extractProtectRtspAlias('rtsps://u:p@192.168.1.1:7441/myAlias'), 'myAlias');

console.log('buildProtectRtsp.test.ts: ok');
