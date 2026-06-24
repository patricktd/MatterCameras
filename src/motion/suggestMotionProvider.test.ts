import assert from 'node:assert/strict';
import { suggestMotionProvider } from './suggestMotionProvider.js';

{
    const r = suggestMotionProvider({ manufacturer: 'Reolink', supportsMotion: true });
    assert.equal(r.suggestedProvider, 'reolink-native');
    assert.equal(r.motionSource, 'auto');
}

{
    const u = suggestMotionProvider({ manufacturer: 'Ubiquiti', model: 'UVC G4' });
    assert.equal(u.suggestedProvider, 'unifi-protect');
}

{
    const t = suggestMotionProvider({ manufacturer: 'TP-Link', model: 'Tapo C200' });
    assert.equal(t.suggestedProvider, 'onvif');
}

{
    const s = suggestMotionProvider({ manufacturer: 'SONOFF', supportsMotion: true });
    assert.equal(s.suggestedProvider, 'onvif');
}

console.log('suggestMotionProvider.test.ts: ok');
