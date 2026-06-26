import './matter/env.js';
import './utils/Logger.js';
import { storage } from './storage/db.js';
import { settings } from './storage/settings.js';
import { bridge } from './matter/Bridge.js';
import { startWebServer } from './web/server.js';
import { appConfig } from './config/app.js';
import { setBridgeEndpointCount, appVersion } from './config/version.js';
import { streamContext } from './matter/behaviors/streamContext.js';
import { getMatterStoragePath, wipeMatterStorage } from './matter/matterStorage.js';
import { countBridgedEndpoints, expectedBridgedEndpointIds } from './matter/personSensorConfig.js';
import { scheduleReolinkLightCapabilityProbes } from './web/cameraInstall.js';

let staleRecoveryInProgress = false;

function hasStaleFabricReference(error: unknown, visited = new Set<unknown>()): boolean {
    if (error === null || typeof error !== 'object' || visited.has(error)) {
        return false;
    }
    visited.add(error);

    const candidate = error as {
        message?: unknown;
        name?: unknown;
        code?: unknown;
        cause?: unknown;
        errors?: unknown;
    };

    const parts = [candidate.name, candidate.code, candidate.message]
        .filter(v => typeof v === 'string')
        .map(v => String(v).toLowerCase())
        .join(' ');

    if (parts.includes('fabric-not-found')
        || parts.includes('fabricnotfound')
        || (parts.includes('fabric index') && parts.includes('does not exist'))
    ) {
        return true;
    }

    if (Array.isArray(candidate.errors)) {
        for (const nested of candidate.errors) {
            if (hasStaleFabricReference(nested, visited)) {
                return true;
            }
        }
    }

    return hasStaleFabricReference(candidate.cause, visited);
}

async function recoverFromStaleFabricIfNeeded(error: unknown, source: string): Promise<boolean> {
    if (!hasStaleFabricReference(error)) {
        return false;
    }
    if (staleRecoveryInProgress) {
        return true;
    }

    staleRecoveryInProgress = true;
    const storagePath = getMatterStoragePath();
    console.error(
        `[${source}] Detected stale Matter fabric references (likely after bridge removal). `
        + 'Clearing Matter storage to return to pairing mode...',
    );
    await wipeMatterStorage();
    console.error(`Matter storage cleared at ${storagePath}. Restarting process...`);
    process.exit(0);
}

function installStaleFabricRecoveryHooks() {
    process.on('uncaughtException', error => {
        void (async () => {
            if (await recoverFromStaleFabricIfNeeded(error, 'uncaughtException')) {
                return;
            }
            console.error('Fatal uncaught exception:', error);
            process.exit(1);
        })();
    });

    process.on('unhandledRejection', reason => {
        void (async () => {
            if (await recoverFromStaleFabricIfNeeded(reason, 'unhandledRejection')) {
                return;
            }
            console.error('Fatal unhandled rejection:', reason);
            process.exit(1);
        })();
    });
}

async function main() {
    console.log(`Starting MatterCameras v${appVersion}...`);
    console.log(`Matter host: ${appConfig.matterHost}:${appConfig.matterPort}`);
    console.log(`Web UI: http://0.0.0.0:${appConfig.webPort}`);
    console.log(`go2rtc: ${appConfig.go2rtcUrl}`);

    await storage.init();
    await settings.init();
    await settings.clearBridgeRestartPending();

    try {
        await bridge.init();
    } catch (error) {
        if (await recoverFromStaleFabricIfNeeded(error, 'bridge.init')) {
            return;
        }
        throw error;
    }
    startWebServer();
    streamContext.refreshMotionSensitivity = id => bridge.motionDetection.applySensitivity(id);
    await bridge.go2rtc.waitUntilReady();

    const cameras = storage.getCameras();
    setBridgeEndpointCount(countBridgedEndpoints(cameras));
    const knownIds = expectedBridgedEndpointIds(cameras);
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
    setBridgeEndpointCount(countBridgedEndpoints(storage.getCameras()));
    await bridge.go2rtc.syncAllStreams();

    // Warm ffmpeg H.264 transcoders so the first live view does not hit a 5s+ cold start.
    await bridge.go2rtc.prewarmAllWebRtc();

    scheduleReolinkLightCapabilityProbes(storage.getCameras());

    // Start Matter only after cameras are on the aggregator (avoids hub seeing empty partsList).
    try {
        await bridge.start();
    } catch (error) {
        if (await recoverFromStaleFabricIfNeeded(error, 'bridge.start')) {
            return;
        }
        throw error;
    }

    if (bridge.isCommissioned()) {
        await bridge.notifyHubStructureChange();
    }

    // Motion polls go2rtc JPEG frames — must run only after every stream is registered.
    for (const cam of cameras) {
        const camera = storage.getCamera(cam.id) ?? cam;
        bridge.startMotionDetection(camera);
    }
    console.log(`Motion detection active for ${cameras.length} camera(s)`);

    bridge.go2rtc.startPeriodicPrune();
    bridge.go2rtc.startPeriodicPrewarm();
}

installStaleFabricRecoveryHooks();

main().catch(err => {
    void (async () => {
        if (await recoverFromStaleFabricIfNeeded(err, 'main.catch')) {
            return;
        }
        console.error('Fatal Error:', err);
        process.exit(1);
    })();
});
