#!/usr/bin/env node
/**
 * Bump package.json patch by +0.0.1 before each production deploy.
 * Agents: always run via ./scripts/quick-deploy.sh or ./scripts/deploy.sh — do not rsync manually.
 *
 * 0.3.0-beta → 0.3.1-beta → 0.3.2-beta …
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const current = pkg.version;

const match = current.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/);
if (!match) {
    console.error(`bump-deploy-version: unsupported version format "${current}" (expected major.minor.patch[-prerelease])`);
    process.exit(1);
}

const [, major, minor, patch, prerelease = ''] = match;
const next = `${major}.${minor}.${Number(patch) + 1}${prerelease}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`==> Deploy version bump: ${current} → ${next}`);
