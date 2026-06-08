/**
 * Must load before @matter/main/platform — configures storage path early.
 */
import { join } from 'path';
import { DATA_DIR } from '../config/paths.js';

if (!process.env['storage.path'] && !process.env.MATTER_STORAGE_PATH) {
    process.env.MATTER_STORAGE_PATH = join(DATA_DIR, 'matter-storage');
}

import './tlvPatch.js';
import '@matter/main/platform';
