import { readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './paths.js';

/** Single source of truth: package.json version (pre-1.0 beta).
 *  Bumped automatically (+0.0.1 patch) on each deploy — see scripts/bump-deploy-version.mjs */
export const appVersion: string = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'),
).version as string;

const SOFTWARE_VERSION_BASE = 300;

let bridgeCameraCount = 0;

/** Set before bridged endpoints are created (drives softwareVersion for hub reprofile). */
export function setBridgeCameraCount(count: number): void {
    bridgeCameraCount = Math.max(0, count);
}

/**
 * Numeric softwareVersion for BasicInformation clusters.
 * Tied to camera count so SmartThings re-interviews the bridge when the roster changes.
 */
export function getMatterSoftwareVersion(): number {
    return SOFTWARE_VERSION_BASE + bridgeCameraCount;
}

export function getMatterSoftwareVersionString(): string {
    return `${appVersion}+${bridgeCameraCount}c`;
}

/** @deprecated Use getMatterSoftwareVersion() */
export const matterSoftwareVersion = SOFTWARE_VERSION_BASE + 1;
