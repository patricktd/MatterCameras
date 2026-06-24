import { bridge } from '../matter/Bridge.js';
import { storage } from '../storage/db.js';
import { setBridgeCameraCount } from '../config/version.js';
import type { Camera } from '../types/index.js';

export async function installCamera(config: Camera): Promise<Camera> {
    await storage.addCamera(config);
    setBridgeCameraCount(storage.getCameras().length);
    await bridge.addCamera(config);
    await bridge.go2rtc.addStream(config.id, config.name, config.rtspUrl);
    bridge.startMotionDetection(config);
    return config;
}

export async function refreshCameraRuntime(existing: Camera, updated: Camera): Promise<void> {
    await bridge.updateCamera(updated);

    const rtspChanged = updated.rtspUrl !== existing.rtspUrl;
    const motionChanged = updated.motionSource !== existing.motionSource
        || updated.onvifUrl !== existing.onvifUrl
        || updated.username !== existing.username
        || updated.password !== existing.password
        || updated.protectHost !== existing.protectHost
        || updated.protectCameraId !== existing.protectCameraId
        || updated.reolinkChannel !== existing.reolinkChannel
        || updated.manufacturer !== existing.manufacturer;

    if (rtspChanged) {
        await bridge.go2rtc.removeStream(updated.id);
        await bridge.go2rtc.addStream(updated.id, updated.name, updated.rtspUrl);
    } else if (updated.name !== existing.name) {
        await bridge.go2rtc.addStream(updated.id, updated.name, updated.rtspUrl);
    }

    if (motionChanged || rtspChanged) {
        bridge.startMotionDetection(updated);
    }
}
