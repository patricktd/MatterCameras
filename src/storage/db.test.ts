import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Camera } from '../types/index.js';
import { StorageService } from './db.js';

const tempDir = mkdtempSync(join(tmpdir(), 'matter-cameras-storage-'));
const dbFile = join(tempDir, 'cameras.json');

try {
    writeFileSync(dbFile, JSON.stringify({ cameras: [] }, null, 2));

    const storageA = new StorageService(dbFile);
    const storageB = new StorageService(dbFile);

    await storageA.init();
    await storageB.init();

    const camA: Camera = {
        id: 'cam-a',
        name: 'Alice',
        rtspUrl: 'rtsp://alice/stream',
        motionSource: 'auto',
        motionObjectType: 'person',
        personSensorEnabled: true,
        protectHost: '192.168.1.30',
        protectCameraId: 'protect-a',
        addSource: 'unifi-protect',
    };
    const camB: Camera = {
        id: 'cam-b',
        name: 'Doorbell',
        rtspUrl: 'rtsp://doorbell/stream',
        motionSource: 'auto',
        protectHost: '192.168.1.30',
        protectCameraId: 'protect-b',
        addSource: 'unifi-protect',
    };

    await storageA.addCamera(camA);
    await storageB.addCamera(camB);

    const persisted = new StorageService(dbFile);
    await persisted.init();
    assert.deepEqual(
        persisted.getCameras().map(camera => camera.id).sort(),
        ['cam-a', 'cam-b'],
    );

    const returned = persisted.getCameras();
    returned.pop();
    returned[0].name = 'Mutated outside storage';

    assert.equal(persisted.getCameras().length, 2);
    assert.equal(persisted.getCamera('cam-a')?.name, 'Alice');
    assert.equal(persisted.getCamera('cam-a')?.motionObjectType, 'any');
    assert.equal(persisted.getCamera('cam-a')?.personSensorEnabled, true);

    const raw = JSON.parse(readFileSync(dbFile, 'utf8')) as { cameras: Camera[] };
    assert.deepEqual(
        raw.cameras.map(camera => camera.id).sort(),
        ['cam-a', 'cam-b'],
    );
    assert.equal(raw.cameras.find(camera => camera.id === 'cam-a')?.motionObjectType, 'any');
    assert.equal(raw.cameras.find(camera => camera.id === 'cam-a')?.personSensorEnabled, true);
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}

console.log('db.test.ts: ok');