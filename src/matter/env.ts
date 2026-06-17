/**
 * Must load before @matter/main/platform — configures storage path early.
 */
import { MATTER_STORAGE_DIR } from '../config/paths.js';

if (!process.env['storage.path'] && !process.env.MATTER_STORAGE_PATH) {
    process.env.MATTER_STORAGE_PATH = MATTER_STORAGE_DIR;
}

import './tlvPatch.js';
import '@matter/main/platform';
