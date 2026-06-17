import { rm } from 'fs/promises';
import { MATTER_STORAGE_DIR } from '../config/paths.js';

export function getMatterStoragePath(): string {
    return process.env.MATTER_STORAGE_PATH ?? process.env['storage.path'] ?? MATTER_STORAGE_DIR;
}

/** Remove all Matter persistence (fabrics, peers, bridged endpoint state). */
export async function wipeMatterStorage(): Promise<void> {
    await rm(getMatterStoragePath(), { recursive: true, force: true });
}
