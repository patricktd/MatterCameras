import express from 'express';
import { join } from 'path';
import { PROJECT_ROOT } from '../config/paths.js';
import { storage } from '../storage/db.js';
import { settings } from '../storage/settings.js';
import { bridge } from '../matter/Bridge.js';
import { appConfig } from '../config/app.js';
import { appVersion } from '../config/version.js';
import { Camera } from '../types/index.js';
import { Logger } from '../utils/Logger.js';
import { scheduleBridgeRestart } from '../utils/scheduleBridgeRestart.js';
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
    const cameras = storage.getCameras();
    const pairingInfo = await bridge.getPairingInfo();
    const bridgeStatus = bridge.isCommissioned() ? 'Commissioned' : 'Ready to Pair';
    res.render('index', { cameras, pairingInfo, bridgeStatus, appVersion });
});

app.get('/options', (_req, res) => {
    const bridgeStatus = bridge.isCommissioned() ? 'Commissioned' : 'Ready to Pair';
    res.render('options', { bridgeStatus, appVersion });
});

app.get('/api/settings', (_req, res) => {
    res.json(settings.getSettings());
});

/** Deploy verification — compare with local package.json after quick-deploy. */
app.get('/api/version', (_req, res) => {
    res.json({ version: appVersion });
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

app.post('/api/restart', (req, res) => {
    scheduleBridgeRestart('manual restart from Web UI');
    const returnTo = req.body.returnTo === '/options' ? '/options' : '/';
    res.redirect(returnTo);
});

app.post('/api/cameras', async (req, res) => {
    const config: Camera = {
        id: 'cam-' + Date.now(),
        name: req.body.name,
        rtspUrl: req.body.rtspUrl,
        codec: req.body.codec
    };

    await storage.addCamera(config);
    setBridgeCameraCount(storage.getCameras().length);
    await bridge.addCamera(config);
    await bridge.go2rtc.addStream(config.id, config.name, config.rtspUrl);

    res.redirect('/');
});

app.post('/api/cameras/:id', async (req, res) => {
    const { id } = req.params;
    const existing = storage.getCamera(id);
    if (!existing) {
        res.status(404).send('Camera not found');
        return;
    }

    const updated = await storage.updateCamera(id, {
        name: req.body.name,
        rtspUrl: req.body.rtspUrl,
        codec: req.body.codec,
    });

    if (!updated) {
        res.status(404).send('Camera not found');
        return;
    }

    await bridge.updateCamera(updated);

    const rtspChanged = updated.rtspUrl !== existing.rtspUrl;
    if (rtspChanged) {
        await bridge.go2rtc.removeStream(id);
        await bridge.go2rtc.addStream(updated.id, updated.name, updated.rtspUrl);
    } else if (updated.name !== existing.name) {
        await bridge.go2rtc.addStream(updated.id, updated.name, updated.rtspUrl);
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
