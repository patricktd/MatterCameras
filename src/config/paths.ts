import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In src/config -> root is ../..
export const PROJECT_ROOT = join(__dirname, '../../');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const DB_FILE = join(DATA_DIR, 'cameras.json');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
