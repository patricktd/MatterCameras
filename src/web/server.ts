import express from 'express';
import { join } from 'path';
import { PROJECT_ROOT } from '../config/paths.js';
import { storage } from '../storage/db.js';
import { bridge } from '../matter/Bridge.js';
import { appConfig } from '../config/app.js';
import { Camera } from '../types/index.js';
import { Logger } from '../utils/Logger.js';

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
    res.render('index', { cameras, pairingInfo, bridgeStatus });
});

app.post('/api/cameras', async (req, res) => {
    const config: Camera = {
        id: 'cam-' + Date.now(),
        name: req.body.name,
        rtspUrl: req.body.rtspUrl,
        codec: req.body.codec
    };

    await storage.addCamera(config);
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
    // TODO: Remove from bridge (restart required usually or dynamic removal)
    await bridge.removeCamera(id);
    await bridge.go2rtc.removeStream(id);
    res.redirect('/');
});

app.post('/api/reset', async (req, res) => {
    try {
        await bridge.factoryReset();
        // Bridge will restart process, so this might not respond, but we try
        res.redirect('/');
    } catch (e) {
        console.error(e);
        res.status(500).send('Reset failed');
    }
});

export function startWebServer() {
    app.listen(port, '0.0.0.0', () => {
        console.log(`Web Dashboard running at http://localhost:${port}`);
    });
}
