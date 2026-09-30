import { spawn } from 'child_process';
import { createWriteStream, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const DOCKER_SOCKET = '/var/run/docker.sock';
const UPDATE_SCRIPT = 'scripts/self-update.sh';
const DEFAULT_UPDATE_ROOT = '/project';
const UPDATE_LOG = '/app/data/self-update.log';

let updateInProgress = false;

export function isUpdateInProgress(): boolean {
    return updateInProgress;
}

/**
 * Tail of the self-update log, so the Web UI can show why an update stalled
 * instead of leaving the user with a silent "waiting for restart".
 */
export function getSelfUpdateLogTail(maxLines = 20): string | null {
    try {
        if (!existsSync(UPDATE_LOG)) return null;
        const contents = readFileSync(UPDATE_LOG, 'utf-8');
        const lines = contents.split(/\r?\n/).filter(line => line.length > 0);
        return lines.slice(-maxLines).join('\n');
    } catch {
        return null;
    }
}

export function getSelfUpdateLogMtime(): number | null {
    try {
        return existsSync(UPDATE_LOG) ? statSync(UPDATE_LOG).mtimeMs : null;
    } catch {
        return null;
    }
}

function resolveSelfUpdateRoot(): string {
    const fromEnv = process.env.MATTER_CAMERAS_SELF_UPDATE_ROOT?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    if (existsSync(join(DEFAULT_UPDATE_ROOT, UPDATE_SCRIPT))) {
        return DEFAULT_UPDATE_ROOT;
    }
    return '';
}

export function getSelfUpdateStatus() {
    const root = resolveSelfUpdateRoot();
    const canAutoUpdate = Boolean(
        root &&
        existsSync(join(root, '.git')) &&
        existsSync(join(root, UPDATE_SCRIPT)) &&
        existsSync(DOCKER_SOCKET),
    );

    return { root, canAutoUpdate };
}

function resolveBashPath(): string | null {
    for (const candidate of ['/bin/bash', '/usr/bin/bash']) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

export function spawnSelfUpdate(targetVersion: string): void {
    if (updateInProgress) {
        throw new Error('An update is already in progress.');
    }

    const { root, canAutoUpdate } = getSelfUpdateStatus();
    if (!canAutoUpdate) {
        throw new Error(
            'One-click update is not available. Install from a git clone with Docker (see docs/INSTALL.md).',
        );
    }

    const bash = resolveBashPath();
    if (!bash) {
        throw new Error('bash is not available in the app container. Rebuild the Docker image (docker compose build app).');
    }

    updateInProgress = true;

    const scriptPath = join(root, UPDATE_SCRIPT);
    const logStream = createWriteStream(UPDATE_LOG, { flags: 'a' });
    logStream.write(`\n==> self-update ${targetVersion} started ${new Date().toISOString()}\n`);

    const child = spawn(bash, [scriptPath, targetVersion], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        logStream.write(`==> self-update exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
        logStream.end();
        updateInProgress = false;
    };

    child.on('error', (error) => {
        logStream.write(`==> self-update spawn error: ${error.message}\n`);
        finish(null, null);
    });

    child.on('exit', (code, signal) => {
        finish(code, signal);
    });

    child.unref();
}
