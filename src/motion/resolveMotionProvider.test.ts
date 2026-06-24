import assert from 'node:assert/strict';
import { MotionProviderRegistry } from './MotionProviderRegistry.js';
import {
    onvifTargetAvailable,
    resolveMotionProviderChain,
    resolvePreferredProvider,
} from './resolveMotionProvider.js';

const baseCamera = {
    id: 'cam-1',
    name: 'Test',
    rtspUrl: 'rtsp://user:pass@192.168.1.10:554/stream',
};

// resolveMotionProviderChain
{
    assert.deepEqual(resolveMotionProviderChain(baseCamera), ['frame-diff']);
    assert.deepEqual(
        resolveMotionProviderChain({ ...baseCamera, motionSource: 'auto' }),
        ['unifi-protect', 'reolink-native', 'onvif', 'frame-diff'],
    );
    assert.deepEqual(
        resolveMotionProviderChain({ ...baseCamera, motionSource: 'onvif' }),
        ['onvif', 'frame-diff'],
    );
    assert.deepEqual(
        resolveMotionProviderChain({
            ...baseCamera,
            motionSource: 'reolink-native',
            manufacturer: 'Reolink',
        }),
        ['reolink-native', 'onvif', 'frame-diff'],
    );
    assert.deepEqual(
        resolveMotionProviderChain({
            ...baseCamera,
            motionSource: 'unifi-protect',
            protectHost: '192.168.1.1',
            protectCameraId: 'abc123',
        }),
        ['unifi-protect', 'onvif', 'frame-diff'],
    );
}

// onvifTargetAvailable
{
    assert.equal(
        onvifTargetAvailable({
            ...baseCamera,
            onvifUrl: 'http://192.168.1.87:8000/onvif/device_service',
            motionSource: 'onvif',
        }),
        true,
    );
}

// resolvePreferredProvider
{
    const registry = new MotionProviderRegistry();

    const frameOnly = resolvePreferredProvider(baseCamera, registry.providers());
    assert.equal(frameOnly?.provider.id, 'frame-diff');

    const reolinkCam = {
        ...baseCamera,
        motionSource: 'auto' as const,
        manufacturer: 'Reolink',
    };
    const reolinkPreferred = resolvePreferredProvider(reolinkCam, registry.providers());
    assert.equal(reolinkPreferred?.provider.id, 'reolink-native');

    const protectCam = {
        ...baseCamera,
        motionSource: 'auto' as const,
        protectHost: '192.168.1.5',
        protectCameraId: 'camprotectid1234567890',
    };
    const protectPreferred = resolvePreferredProvider(protectCam, registry.providers());
    assert.equal(protectPreferred?.provider.id, 'unifi-protect');

    const onvifCam = {
        ...baseCamera,
        motionSource: 'onvif' as const,
        onvifUrl: 'http://192.168.1.87:8000/onvif/device_service',
    };
    const onvifPreferred = resolvePreferredProvider(onvifCam, registry.providers());
    assert.equal(onvifPreferred?.provider.id, 'onvif');
}

// registry priority order
{
    const registry = new MotionProviderRegistry();
    const unifi = registry.get('unifi-protect');
    const reolink = registry.get('reolink-native');
    const onvif = registry.get('onvif');
    const frameDiff = registry.get('frame-diff');
    assert.ok(unifi && reolink && onvif && frameDiff);
    assert.ok(unifi.priority < reolink.priority);
    assert.ok(reolink.priority < onvif.priority);
    assert.ok(onvif.priority < frameDiff.priority);
}

console.log('resolveMotionProvider.test.ts: ok');
