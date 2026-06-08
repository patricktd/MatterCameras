import './matter/env.js';
import './utils/Logger.js';
import { storage } from './storage/db.js';
import { bridge } from './matter/Bridge.js';
import { startWebServer } from './web/server.js';
import { appConfig } from './config/app.js';

async function main() {
    console.log('Starting MatterCameras...');
    console.log(`Matter host: ${appConfig.matterHost}:${appConfig.matterPort}`);
    console.log(`Web UI: http://0.0.0.0:${appConfig.webPort}`);
    console.log(`go2rtc: ${appConfig.go2rtcUrl}`);

    await storage.init();

    await bridge.init();
    await bridge.go2rtc.waitUntilReady();

    const cameras = storage.getCameras();
    for (const cam of cameras) {
        await bridge.addCamera(cam);
        await bridge.go2rtc.addStream(cam.id, cam.name, cam.rtspUrl);
    }
    await bridge.go2rtc.syncAllStreams();

    // Warm ffmpeg H.264 transcoders so the first live view does not hit a 5s+ cold start.
    await bridge.go2rtc.prewarmAllWebRtc();

    // Start Matter only after cameras are on the aggregator (avoids hub seeing empty partsList).
    await bridge.start();

    bridge.go2rtc.startPeriodicPrune();
    startWebServer();
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
