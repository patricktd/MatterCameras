import './matter/env.js';
import './utils/Logger.js';
import { storage } from './storage/db.js';
import { settings } from './storage/settings.js';
import { bridge } from './matter/Bridge.js';
import { startWebServer } from './web/server.js';
import { appConfig } from './config/app.js';
import { setBridgeCameraCount, appVersion } from './config/version.js';
import { streamContext } from './matter/behaviors/streamContext.js';

async function main() {
    console.log(`Starting MatterCameras v${appVersion}...`);
    console.log(`Matter host: ${appConfig.matterHost}:${appConfig.matterPort}`);
    console.log(`Web UI: http://0.0.0.0:${appConfig.webPort}`);
    console.log(`go2rtc: ${appConfig.go2rtcUrl}`);

    await storage.init();
    await settings.init();

    await bridge.init();
    startWebServer();
    streamContext.refreshMotionSensitivity = id => bridge.motionDetection.applySensitivity(id);
    await bridge.go2rtc.waitUntilReady();

    const cameras = storage.getCameras();
    setBridgeCameraCount(cameras.length);
    const knownIds = new Set(cameras.map(c => c.id));
    const orphans = bridge.listOrphanBridgedCameraIds(knownIds);
    if (orphans.length > 0) {
        console.warn(
            `Matter storage has ${orphans.length} bridged endpoint(s) not in cameras.json: `
            + `${orphans.join(', ')} — SmartThings may show cameras without preview until removed`,
        );
    }
    for (const cam of cameras) {
        await bridge.addCamera(cam);
        await bridge.go2rtc.addStream(cam.id, cam.name, cam.rtspUrl);
    }
    await bridge.go2rtc.syncAllStreams();

    // Warm ffmpeg H.264 transcoders so the first live view does not hit a 5s+ cold start.
    await bridge.go2rtc.prewarmAllWebRtc();

    // Start Matter only after cameras are on the aggregator (avoids hub seeing empty partsList).
    await bridge.start();

    // Motion polls go2rtc JPEG frames — must run only after every stream is registered.
    for (const cam of cameras) {
        bridge.startMotionDetection(cam);
    }
    console.log(`Motion detection active for ${cameras.length} camera(s)`);

    bridge.go2rtc.startPeriodicPrune();
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
