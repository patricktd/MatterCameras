#!/usr/bin/env node
/**
 * Bump package.json (and package-lock.json) for a community release.
 * Deploy scripts do NOT call this — run explicitly before tagging/publishing.
 *
 * Usage:
 *   node scripts/release-version.mjs patch          # 0.3.63-beta → 0.3.64-beta
 *   node scripts/release-version.mjs minor          # 0.3.63-beta → 0.4.0-beta
 *   node scripts/release-version.mjs major          # 0.3.63-beta → 1.0.0-beta
 *   node scripts/release-version.mjs 0.4.0-beta     # set exact version
 *   node scripts/release-version.mjs patch --dry-run
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/;

function parseVersion(version) {
    const match = version.match(SEMVER_RE);
    if (!match) {
        console.error(`release-version: unsupported version format "${version}"`);
        process.exit(1);
    }
    const [, major, minor, patch, prerelease = ''] = match;
    return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease };
}

function formatVersion({ major, minor, patch, prerelease }) {
    return `${major}.${minor}.${patch}${prerelease}`;
}

function bump(current, kind) {
    const parsed = parseVersion(current);
    switch (kind) {
        case 'patch':
            return formatVersion({ ...parsed, patch: parsed.patch + 1 });
        case 'minor':
            return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0, prerelease: parsed.prerelease });
        case 'major':
            return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0, prerelease: parsed.prerelease });
        default:
            console.error(`release-version: unknown bump kind "${kind}" (use patch, minor, major, or an explicit version)`);
            process.exit(1);
    }
}

function syncLockfile(version) {
    if (!existsSync(lockPath)) return;
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    lock.version = version;
    if (lock.packages?.['']) {
        lock.packages[''].version = version;
    }
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

const args = process.argv.slice(2).filter((arg) => arg !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const target = args[0] ?? 'patch';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const current = pkg.version;
const next = SEMVER_RE.test(target) ? target : bump(current, target);

if (next === current) {
    console.error(`release-version: version unchanged (${current})`);
    process.exit(1);
}

if (!SEMVER_RE.test(next)) {
    console.error(`release-version: result "${next}" is not a valid semver`);
    process.exit(1);
}

console.log(`==> Release version: ${current} → ${next}`);
if (dryRun) {
    console.log('    (dry run — no files written)');
    process.exit(0);
}

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
syncLockfile(next);

console.log('    Updated package.json and package-lock.json');
console.log('    Next: move CHANGELOG [Unreleased] → [' + next + '], commit, tag, then deploy.');
