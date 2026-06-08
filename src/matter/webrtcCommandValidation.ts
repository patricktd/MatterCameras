import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const supervisionConfigPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/@matter/node/dist/esm/behavior/supervision/SupervisionConfig.js',
);
const { GlobalConfig, commandSupervisionConfigs } = require(supervisionConfigPath);

const WEBRTC_COMMANDS = ['provideOffer', 'solicitOffer', 'provideAnswer', 'provideIceCandidates'];

/** Disable strict TLV validation for WebRTC commands (SmartThings sends partial sFrameConfig). */
export function disableWebRtcCommandValidation(constructor: Function) {
    const prototype = constructor.prototype;
    let map = commandSupervisionConfigs.get(prototype);
    if (map === undefined) {
        map = new Map();
        commandSupervisionConfigs.set(prototype, map);
    }

    for (const method of WEBRTC_COMMANDS) {
        let config = map.get(method);
        if (config === undefined) {
            config = new GlobalConfig();
            map.set(method, config);
        }
        config.supervision ??= {};
        config.supervision.validate = false;
    }
}
