#!/usr/bin/env node
/**
 * Bump package.json (and package-lock.json) for a community release, and — with
 * --publish — drive the full publish flow (CHANGELOG move, commit, tag, push). The
 * pushed tag triggers .github/workflows/release.yml, which builds/pushes the
 * multi-arch images and creates the GitHub Release.
 *
 * Bump only (UNCHANGED legacy behavior — `npm run release` still does just this):
 *   node scripts/release-version.mjs patch          # 0.4.2-beta → 0.4.3-beta
 *   node scripts/release-version.mjs minor          # 0.4.2-beta → 0.5.0-beta
 *   node scripts/release-version.mjs major          # 0.4.2-beta → 1.0.0-beta
 *   node scripts/release-version.mjs 0.5.0-beta     # set exact version
 *   node scripts/release-version.mjs patch --dry-run
 *
 * Full release (bump + CHANGELOG + commit + tag + push → CI publishes):
 *   node scripts/release-version.mjs minor --publish
 *   node scripts/release-version.mjs minor --publish --dry-run
 *   node scripts/release-version.mjs minor --publish --local-images   # build+push images and create the Release locally
 *
 * Print the release notes for a version (used by CI for `gh release --notes-file`):
 *   node scripts/release-version.mjs --notes 0.5.0-beta
 *
 * Configurable (flag overrides env, env overrides default):
 *   --repo          / GITHUB_REPO   (patricktd/MatterCameras)
 *   --registry      / REGISTRY      (ghcr.io)
 *   --owner         / IMAGE_OWNER   (patricktd)
 *   --app-image     / APP_IMAGE     (mattercameras)
 *   --go2rtc-image  / GO2RTC_IMAGE  (matter-go2rtc)
 *   --tag-prefix    / TAG_PREFIX    (v)
 *   --platforms     / PLATFORMS     (linux/amd64,linux/arm64)
 *   --no-verify                     (skip clean-tree / branch / gh-auth checks; used in CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const changelogPath = join(root, 'CHANGELOG.md');

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

function bumpVersion(current, kind) {
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

function normalizeVersion(value) {
    return String(value).trim().replace(/^v/i, '');
}

/** Read the body of one `## [version]` section from CHANGELOG.md (no headings/separators). */
function extractNotes(version) {
    const content = readFileSync(changelogPath, 'utf-8');
    const marker = `## [${version}]`;
    const idx = content.indexOf(marker);
    if (idx === -1) return '';
    const lineEnd = content.indexOf('\n', idx);
    const start = lineEnd === -1 ? content.length : lineEnd + 1;
    const nextIdx = content.indexOf('\n## [', start);
    const end = nextIdx === -1 ? content.length : nextIdx;
    return content.slice(start, end).replace(/^\s*---\s*$/gm, '').trim();
}

/** Move `## [Unreleased]` content into a new `## [version] — date` section. */
function transformChangelog(version, date, dryRun) {
    const content = readFileSync(changelogPath, 'utf-8');
    const marker = '## [Unreleased]';
    const idx = content.indexOf(marker);
    if (idx === -1) {
        console.error(`release-version: '${marker}' not found in CHANGELOG.md`);
        process.exit(1);
    }
    const afterMarker = idx + marker.length;
    const nextIdx = content.indexOf('\n## [', afterMarker);
    if (nextIdx === -1) {
        console.error('release-version: no prior version heading found after [Unreleased]');
        process.exit(1);
    }
    const unreleasedBlock = content.slice(afterMarker, nextIdx);
    const notesBody = unreleasedBlock.replace(/^\s*---\s*$/gm, '').trim();

    if (!notesBody) {
        console.warn('release-version: WARNING — [Unreleased] is empty; release notes will be a placeholder.');
    }

    if (!dryRun) {
        const block =
            `${marker}\n\n` +
            `---\n\n` +
            `## [${version}] — ${date}\n\n` +
            (notesBody ? `${notesBody}\n\n` : '') +
            `---\n\n`;
        const newContent = content.slice(0, idx) + block + content.slice(nextIdx + 1);
        writeFileSync(changelogPath, newContent);
    }
    return { notesBody };
}

function run(cmd, cmdArgs, { capture = false, allowFail = false } = {}) {
    const res = spawnSync(cmd, cmdArgs, { encoding: 'utf-8', stdio: capture ? 'pipe' : 'inherit', shell: false });
    if (res.error) {
        if (allowFail) return { status: 1, stdout: '', stderr: String(res.error.message) };
        console.error(`release-version: failed to run ${cmd}: ${res.error.message}`);
        process.exit(1);
    }
    if (!allowFail && res.status !== 0) {
        if (capture && res.stderr) console.error(res.stderr);
        console.error(`release-version: command failed (exit ${res.status}): ${cmd} ${cmdArgs.join(' ')}`);
        process.exit(1);
    }
    return { status: res.status ?? 0, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function ensurePreconditions() {
    const status = run('git', ['status', '--porcelain'], { capture: true });
    if (status.stdout.trim()) {
        console.error('release-version: working tree is not clean. Commit or stash changes first.');
        process.exit(1);
    }
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).stdout.trim();
    if (branch !== 'main') {
        console.error(`release-version: not on 'main' (on '${branch}'). Switch to main before releasing.`);
        process.exit(1);
    }
    const gh = run('gh', ['auth', 'status'], { capture: true, allowFail: true });
    if (gh.status !== 0) {
        console.error('release-version: gh CLI is not authenticated. Run `gh auth login`.');
        process.exit(1);
    }
}

// --- parse args ---------------------------------------------------------------
const opts = {
    publish: false,
    dryRun: false,
    noPush: false,
    noVerify: false,
    localImages: false,
    notes: null,
    repo: process.env.GITHUB_REPO || 'patricktd/MatterCameras',
    registry: process.env.REGISTRY || 'ghcr.io',
    owner: process.env.IMAGE_OWNER || 'patricktd',
    appImage: process.env.APP_IMAGE || 'mattercameras',
    go2rtcImage: process.env.GO2RTC_IMAGE || 'matter-go2rtc',
    tagPrefix: process.env.TAG_PREFIX || 'v',
    platforms: process.env.PLATFORMS || 'linux/amd64,linux/arm64',
};
const positionals = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
        case '--publish': opts.publish = true; break;
        case '--dry-run': opts.dryRun = true; break;
        case '--no-push': opts.noPush = true; break;
        case '--no-verify': opts.noVerify = true; break;
        case '--local-images': opts.localImages = true; break;
        case '--notes': opts.notes = argv[++i]; break;
        case '--repo': opts.repo = argv[++i]; break;
        case '--registry': opts.registry = argv[++i]; break;
        case '--owner': opts.owner = argv[++i]; break;
        case '--app-image': opts.appImage = argv[++i]; break;
        case '--go2rtc-image': opts.go2rtcImage = argv[++i]; break;
        case '--tag-prefix': opts.tagPrefix = argv[++i]; break;
        case '--platforms': opts.platforms = argv[++i]; break;
        default:
            if (a.startsWith('--')) {
                console.error(`release-version: unknown option "${a}"`);
                process.exit(1);
            }
            positionals.push(a);
    }
}

// --- --notes <version>: print notes and exit (used by CI) ---------------------
if (opts.notes != null) {
    const version = normalizeVersion(opts.notes);
    const body = extractNotes(version);
    process.stdout.write(`${body || `Release ${version}.`}\n`);
    process.exit(0);
}

// --- determine target version -------------------------------------------------
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const current = pkg.version;
const target = positionals[0] ?? 'patch';
const next = SEMVER_RE.test(target) ? target : bumpVersion(current, target);

if (next === current) {
    console.error(`release-version: version unchanged (${current})`);
    process.exit(1);
}
if (!SEMVER_RE.test(next)) {
    console.error(`release-version: result "${next}" is not a valid semver`);
    process.exit(1);
}

const tag = `${opts.tagPrefix}${next}`;
const date = new Date().toISOString().slice(0, 10);

console.log(`==> Release version: ${current} → ${next}${opts.publish ? ` (full release → tag ${tag})` : ''}`);

function writePkg(version) {
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// --- legacy bump-only path (no --publish): identical to previous behavior ------
if (!opts.publish) {
    if (opts.dryRun) {
        console.log('    (dry run — no files written)');
        process.exit(0);
    }
    writePkg(next);
    syncLockfile(next);
    console.log('    Updated package.json and package-lock.json');
    console.log(`    Next: move CHANGELOG [Unreleased] → [${next}], commit, tag, then deploy.`);
    console.log('    (or re-run with --publish to do CHANGELOG + commit + tag + push automatically)');
    process.exit(0);
}

// --- full release path (--publish) --------------------------------------------
const notesFile = `.release-notes-${next}.md`;
const isPrerelease = next.includes('-');

if (opts.dryRun) {
    console.log('    (dry run — no files written, no git/docker actions)');
    const { notesBody } = transformChangelog(next, date, true);
    console.log(`\n-- would set package.json version → ${next}`);
    console.log(`-- would move CHANGELOG [Unreleased] → [${next}] — ${date}`);
    console.log(`-- would write ${notesFile}:`);
    console.log('   ' + (notesBody || '(empty — fill the [Unreleased] section first!)').replace(/\n/g, '\n   '));
    console.log(`-- would commit (release: ${tag}), tag ${tag}${opts.noPush ? '' : ', push origin main --follow-tags'}`);
    if (opts.localImages) {
        console.log(`-- would buildx build+push ${opts.registry}/${opts.owner}/${opts.appImage} and ${opts.registry}/${opts.owner}/${opts.go2rtcImage} (${opts.platforms})`);
        console.log(`-- would gh release create ${tag}${isPrerelease ? ' --prerelease' : ''}`);
    } else {
        console.log('-- pushing the tag would trigger .github/workflows/release.yml to build images + create the Release');
    }
    process.exit(0);
}

if (!opts.noVerify) {
    ensurePreconditions();
}

const { notesBody } = transformChangelog(next, date, false);
writePkg(next);
syncLockfile(next);
writeFileSync(notesFile, `${notesBody || `Release ${next}.`}\n`);
console.log(`    Updated package.json, package-lock.json, CHANGELOG.md, ${notesFile}`);

run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md', notesFile]);
run('git', ['commit', '-m', `release: ${tag}`]);
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
if (!opts.noPush) {
    run('git', ['push', 'origin', 'main']);
    // Push the tag explicitly: `--follow-tags` skips lightweight tags, and both the
    // CI tag trigger and `gh release create` need the tag present on the remote.
    run('git', ['push', 'origin', tag]);
}

if (opts.localImages) {
    const sha = run('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim();
    const appRef = `${opts.registry}/${opts.owner}/${opts.appImage}`;
    const go2rtcRef = `${opts.registry}/${opts.owner}/${opts.go2rtcImage}`;
    console.log(`==> Building + pushing images (${opts.platforms})`);
    run('docker', ['buildx', 'build', '--platform', opts.platforms, '--push',
        '-t', `${appRef}:${tag}`, '-t', `${appRef}:latest`,
        '--build-arg', `VERSION=${tag}`, '--build-arg', `VCS_REF=${sha}`, '.']);
    run('docker', ['buildx', 'build', '--platform', opts.platforms, '--push',
        '-t', `${go2rtcRef}:${tag}`, '-t', `${go2rtcRef}:latest`, 'docker/go2rtc']);
    console.log('==> Creating GitHub Release');
    const ghArgs = ['release', 'create', tag, '--repo', opts.repo, '--title', tag, '--notes-file', notesFile];
    if (isPrerelease) ghArgs.push('--prerelease');
    run('gh', ghArgs);
    console.log(`==> Done: ${tag} published to ${opts.registry}/${opts.owner} and released on ${opts.repo}.`);
} else if (opts.noPush) {
    console.log(`==> Tagged ${tag} locally (--no-push). Push it to trigger CI:`);
    console.log(`    git push origin main && git push origin ${tag}`);
} else {
    console.log(`==> Pushed ${tag}. GitHub Actions (.github/workflows/release.yml) will build the`);
    console.log('    multi-arch images and create the Release. Remember: GHCR packages start');
    console.log('    PRIVATE — make them public after the first publish.');
}
