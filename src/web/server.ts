import express from 'express';
import { join } from 'path';
import { PROJECT_ROOT } from '../config/paths.js';
import { storage } from '../storage/db.js';
import { settings } from '../storage/settings.js';
import { bridge } from '../matter/Bridge.js';
import { appConfig } from '../config/app.js';
import { appVersion } from '../config/version.js';
import { Camera } from '../types/index.js';
import { sanitizeCameraForPublic } from '../utils/sanitizeCamera.js';
import { Logger } from '../utils/Logger.js';
import { scheduleBridgeRestart } from '../utils/scheduleBridgeRestart.js';
import { probeOnvifDevices } from '../onvif/discovery.js';
import { getCameraProvider, listCameraProviders } from '../cameraProviders/registry.js';
import { onvifProvider } from '../cameraProviders/onvifProvider.js';
import { unifiProtectProvider } from '../cameraProviders/unifiProtectProvider.js';
import { draftToCamera } from '../cameraProviders/installCamera.js';
import { resolveProtectCredentials, protectControllerToSave } from '../cameraProviders/resolveControllerCreds.js';
import {
    connectProtect,
    listProtectCameras,
    logoutProtect,
} from '../cameraProviders/unifi/protectApi.js';
import { patchCameraFromProtect, syncExistingProtectCameras } from '../cameraProviders/unifi/syncExisting.js';
import { installCamera, refreshCameraRuntime } from './cameraInstall.js';
import { parseCameraMotionFields, parseMotionSource } from '../motion/parseMotionForm.js';
import { setBridgeCameraCount } from '../config/version.js';

const app = express();
const port = appConfig.webPort;

app.set('view engine', 'ejs');
app.set('views', join(PROJECT_ROOT, 'views'));
app.get('/api/logs', (req, res) => {
    res.json(Logger.getLogs().reverse()); // Newest first
});
app.use(express.static(join(PROJECT_ROOT, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', async (req, res) => {
    const cameras = storage.getCameras().map(sanitizeCameraForPublic);
    const pairingInfo = await bridge.getPairingInfo();
    const bridgeStatus = bridge.isCommissioned() ? 'Commissioned' : 'Ready to Pair';
    res.render('index', {
        cameras,
        pairingInfo,
        bridgeStatus,
        appVersion,
        protectController: settings.getProtectControllerPublic(),
    });
});

app.get('/options', (_req, res) => {
    const bridgeStatus = bridge.isCommissioned() ? 'Commissioned' : 'Ready to Pair';
    res.render('options', {
        bridgeStatus,
        appVersion,
        protectController: settings.getProtectControllerPublic(),
    });
});

app.get('/api/settings', (_req, res) => {
    res.json(settings.getSettings());
});

/** Saved vendor controller logins (passwords never returned). */
app.get('/api/settings/controllers', (_req, res) => {
    res.json({ protect: settings.getProtectControllerPublic() ?? null });
});

app.put('/api/settings/protect-controller', async (req, res) => {
    const host = String(req.body?.host ?? '').trim();
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const existing = settings.getProtectController();

    try {
        await settings.setProtectController({
            host,
            username,
            password: password || existing?.password || '',
        });
        res.json({ protect: settings.getProtectControllerPublic() });
    } catch (error) {
        res.status(400).json({ error: String(error) });
    }
});

app.delete('/api/settings/protect-controller', async (_req, res) => {
    await settings.clearProtectController();
    res.json({ ok: true });
});

/** Deploy verification — compare with local package.json after quick-deploy. */
app.get('/api/version', (_req, res) => {
    res.json({ version: appVersion });
});

/** Dashboard preview — JPEG snapshot from go2rtc (same path as SmartThings CaptureSnapshot). */
app.get('/api/cameras/:id/snapshot', async (req, res) => {
    const camera = storage.getCameras().find(c => c.id === req.params.id);
    if (!camera) {
        res.status(404).json({ error: 'Camera not found' });
        return;
    }

    const rawW = Number(req.query.w);
    const width = Number.isFinite(rawW) ? Math.min(1280, Math.max(160, rawW)) : 320;

    try {
        const jpeg = await bridge.go2rtc.captureFrame(camera.id, width);
        res.set('Cache-Control', 'no-store');
        res.type('image/jpeg').send(Buffer.from(jpeg));
    } catch (error) {
        res.status(503).json({ error: String(error) });
    }
});

/** Test go2rtc snapshot for every camera in cameras.json (hub-independent). */
app.get('/api/diagnostics/snapshots', async (_req, res) => {
    const cameras = storage.getCameras();
    const results = await Promise.all(cameras.map(async cam => {
        const started = Date.now();
        try {
            const jpeg = await bridge.go2rtc.captureFrame(cam.id, 640);
            return {
                id: cam.id,
                name: cam.name,
                ok: true,
                bytes: jpeg.byteLength,
                ms: Date.now() - started,
            };
        } catch (error) {
            return {
                id: cam.id,
                name: cam.name,
                ok: false,
                ms: Date.now() - started,
                error: String(error),
            };
        }
    }));
    res.json({ cameras: results, orphanMatterEndpoints: bridge.listOrphanBridgedCameraIds(new Set(cameras.map(c => c.id))) });
});

/** Camera add plugins (UniFi Protect, Reolink, ONVIF, manual). */
app.get('/api/camera-providers', (_req, res) => {
    res.json({ providers: listCameraProviders() });
});

app.post('/api/camera-providers/:providerId/discover', async (req, res) => {
    const provider = getCameraProvider(req.params.providerId);
    if (!provider) {
        res.status(404).json({ error: 'Unknown camera provider' });
        return;
    }

    try {
        const cameras = storage.getCameras();
        const devices = await provider.discover(req.body ?? {}, cameras);
        res.json({
            providerId: provider.meta.id,
            devices,
            count: devices.length,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

app.post('/api/camera-providers/:providerId/resolve', async (req, res) => {
    const provider = getCameraProvider(req.params.providerId);
    if (!provider) {
        res.status(404).json({ error: 'Unknown camera provider' });
        return;
    }

    try {
        const draft = await provider.resolve(req.body ?? {});
        res.json(draft);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

/** WS-Discovery scan for ONVIF cameras on the LAN (UDP 3702 multicast). */
app.post('/api/onvif/discover', async (req, res) => {
    const raw = Number(req.body?.timeoutMs);
    const timeoutMs = Number.isFinite(raw) ? Math.min(15_000, Math.max(2_000, raw)) : 5_000;
    try {
        const cameras = storage.getCameras();
        const devices = await onvifProvider.discover({ timeoutMs }, cameras);
        const all = await probeOnvifDevices(timeoutMs);
        res.json({
            devices,
            count: devices.length,
            totalFound: all.length,
            skippedCount: all.length - devices.length,
            timeoutMs,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

/** Connect to a discovered ONVIF device and fetch RTSP stream URI + device info. */
app.post('/api/onvif/resolve', async (req, res) => {
    const hostname = String(req.body?.hostname ?? '').trim();
    const port = Number(req.body?.port) || 80;
    const path = String(req.body?.path ?? '/onvif/device_service').trim();
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!hostname || !username) {
        res.status(400).json({ error: 'hostname and username are required' });
        return;
    }

    try {
        const camera = await onvifProvider.resolve({
            deviceId: hostname,
            username,
            password,
            payload: { hostname, port, path },
        });
        res.json(camera);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

/** Import one or all new UniFi Protect cameras into the bridge roster. */
app.post('/api/camera-providers/unifi-protect/import', async (req, res) => {
    try {
        const creds = resolveProtectCredentials(req.body ?? {});
        if (req.body?.saveController) {
            await settings.setProtectController(protectControllerToSave(creds));
        }

        const roster = storage.getCameras();
        let deviceIds = Array.isArray(req.body?.deviceIds)
            ? req.body.deviceIds.map((id: unknown) => String(id))
            : undefined;

        if (!deviceIds?.length) {
            const discovered = await unifiProtectProvider.discover(creds, roster);
            deviceIds = discovered.map(d => d.id);
        }

        const added: Array<{ id: string; name: string; protectCameraId: string }> = [];
        const errors: Array<{ deviceId: string; error: string }> = [];

        for (const deviceId of deviceIds) {
            try {
                const draft = await unifiProtectProvider.resolve({
                    deviceId,
                    host: creds.host,
                    username: creds.username,
                    password: creds.password,
                    payload: { host: creds.host, cameraId: deviceId },
                });
                const config = draftToCamera(draft);
                await installCamera(config);
                added.push({
                    id: config.id,
                    name: config.name,
                    protectCameraId: config.protectCameraId ?? deviceId,
                });
            } catch (error) {
                errors.push({ deviceId, error: String(error) });
            }
        }

        if (added.length > 0 && bridge.isCommissioned()) {
            scheduleBridgeRestart(`UniFi import: ${added.length} camera(s)`);
        }

        res.json({ added, errors, count: added.length });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

/** Link existing roster cameras to Protect (by name or RTSP alias). */
app.post('/api/camera-providers/unifi-protect/sync-existing', async (req, res) => {
    try {
        const creds = resolveProtectCredentials(req.body ?? {});
        if (req.body?.saveController) {
            await settings.setProtectController(protectControllerToSave(creds));
        }

        const roster = storage.getCameras();
        const preview = await syncExistingProtectCameras(creds, roster);
        if (!preview.updated.length) {
            res.json({ updated: [], skipped: preview.skipped });
            return;
        }

        const api = await connectProtect(creds.host, creds.username, creds.password);
        const rows = listProtectCameras(api);
        const updated: Array<{ id: string; name: string; protectCameraId: string }> = [];

        try {
            for (const item of preview.updated) {
                const existing = storage.getCamera(item.id);
                const row = rows.find(r => r.id === item.protectCameraId);
                if (!existing || !row) continue;

                const patched = patchCameraFromProtect(
                    existing,
                    creds.host,
                    item.protectCameraId,
                    creds.username,
                    creds.password,
                    row,
                );

                const saved = await storage.updateCamera(item.id, {
                    protectHost: patched.protectHost,
                    protectCameraId: patched.protectCameraId,
                    manufacturer: patched.manufacturer,
                    model: patched.model,
                    username: patched.username,
                    password: patched.password,
                    motionSource: patched.motionSource,
                    rtspUrl: patched.rtspUrl,
                    addSource: patched.addSource,
                });
                if (!saved) continue;

                await refreshCameraRuntime(existing, saved);
                updated.push({
                    id: saved.id,
                    name: saved.name,
                    protectCameraId: saved.protectCameraId ?? item.protectCameraId,
                });
            }
        } finally {
            logoutProtect(api);
        }

        res.json({ updated, skipped: preview.skipped });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

app.post('/api/restart', (req, res) => {
    scheduleBridgeRestart('manual restart from Web UI');
    const returnTo = req.body.returnTo === '/options' ? '/options' : '/';
    res.redirect(returnTo);
});

app.post('/api/cameras', async (req, res) => {
    const motionFields = parseCameraMotionFields(req.body as Record<string, unknown>);
    const config: Camera = {
        id: 'cam-' + Date.now(),
        name: req.body.name,
        rtspUrl: req.body.rtspUrl,
        codec: req.body.codec,
        ...motionFields,
    };

    await installCamera(config);

    if (bridge.isCommissioned()) {
        scheduleBridgeRestart(`camera added: ${config.name}`);
    }

    res.redirect('/');
});

app.post('/api/cameras/:id', async (req, res) => {
    const { id } = req.params;
    const existing = storage.getCamera(id);
    if (!existing) {
        res.status(404).send('Camera not found');
        return;
    }

    const motionFields = parseCameraMotionFields(req.body as Record<string, unknown>);
    const updated = await storage.updateCamera(id, {
        name: req.body.name,
        rtspUrl: req.body.rtspUrl,
        codec: req.body.codec,
        ...motionFields,
        motionSource: parseMotionSource(
            req.body.motionSource,
            existing.motionSource ?? 'frame-diff',
        ),
    });

    if (!updated) {
        res.status(404).send('Camera not found');
        return;
    }

    await refreshCameraRuntime(existing, updated);

    res.redirect('/');
});

app.post('/api/cameras/:id/duplicate', async (req, res) => {
    const { id } = req.params;
    const existing = storage.getCamera(id);
    if (!existing) {
        res.status(404).send('Camera not found');
        return;
    }

    const name = String(req.body?.name ?? '').trim();
    if (!name) {
        res.status(400).send('Name is required');
        return;
    }

    const config: Camera = {
        id: 'cam-' + Date.now(),
        name,
        rtspUrl: existing.rtspUrl,
        codec: existing.codec,
        motionSource: existing.motionSource ?? 'frame-diff',
        onvifUrl: existing.onvifUrl,
        username: existing.username,
        password: existing.password,
        manufacturer: existing.manufacturer,
        model: existing.model,
        reolinkChannel: existing.reolinkChannel,
        protectHost: existing.protectHost,
        protectCameraId: existing.protectCameraId,
    };

    await installCamera(config);

    if (bridge.isCommissioned()) {
        scheduleBridgeRestart(`camera duplicated: ${config.name}`);
    }

    res.redirect('/');
});

app.post('/api/cameras/:id/delete', async (req, res) => {
    const { id } = req.params;
    await storage.removeCamera(id);
    setBridgeCameraCount(storage.getCameras().length);
    await bridge.removeCamera(id);
    await bridge.go2rtc.removeStream(id);

    res.redirect('/');
});

app.post('/api/reset', (_req, res) => {
    res.status(202).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Resetting pairing…</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.25rem; }
    p { line-height: 1.5; color: #444; }
    .status { margin-top: 1.5rem; padding: 0.75rem 1rem; background: #f4f4f5; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Resetting Matter pairing</h1>
  <p>Pairing data was cleared and the bridge is restarting. Your camera list is unchanged.</p>
  <p class="status" id="status">Waiting for the bridge to come back online…</p>
  <p><a href="/">Open dashboard</a> if this page does not redirect automatically.</p>
  <script>
    const status = document.getElementById('status');
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (r.ok) {
          clearInterval(poll);
          status.textContent = 'Bridge is back online. Redirecting…';
          location.href = '/';
        }
      } catch (_) {}
      if (attempts >= 45) {
        clearInterval(poll);
        status.textContent = 'Still restarting — try opening the dashboard manually.';
      }
    }, 2000);
  </script>
</body>
</html>`);

    setImmediate(() => {
        bridge.factoryReset().catch(error => {
            console.error('Factory reset failed:', error);
            process.exit(1);
        });
    });
});

let webServerStarted = false;

export function startWebServer() {
    if (webServerStarted) return;
    webServerStarted = true;
    app.listen(port, '0.0.0.0', () => {
        console.log(`Web Dashboard running at http://localhost:${port}`);
    });
}
