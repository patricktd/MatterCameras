import { readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './paths.js';

/** Single source of truth: package.json version (pre-1.0 beta).
 *  Bumped manually via `npm run release` — see scripts/release-version.mjs */
export const appVersion: string = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'),
).version as string;

const SOFTWARE_VERSION_BASE = 300;

let bridgeEndpointCount = 0;

/** Set before bridged endpoints are created (drives softwareVersion for hub reprofile). */
export function setBridgeEndpointCount(count: number): void {
    bridgeEndpointCount = Math.max(0, count);
}

/** @deprecated Use setBridgeEndpointCount() */
export function setBridgeCameraCount(count: number): void {
    setBridgeEndpointCount(count);
}

/**
 * Numeric softwareVersion for BasicInformation clusters.
 * Tied to camera count so SmartThings re-interviews the bridge when the roster changes.
 */
export function getMatterSoftwareVersion(): number {
    return SOFTWARE_VERSION_BASE + bridgeEndpointCount;
}

export function getMatterSoftwareVersionString(): string {
    return `${appVersion}+${bridgeEndpointCount}e`;
}

/** @deprecated Use getMatterSoftwareVersion() */
export const matterSoftwareVersion = SOFTWARE_VERSION_BASE + 1;
