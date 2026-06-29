import { motionConfig } from '../../../config/motion.js';
import type { Camera } from '../../../types/index.js';
import type { MotionObjectType } from '../../types.js';

export interface ReolinkCredentials {
    host: string;
    username: string;
    password: string;
    channel: number;
    port?: number;
    useHttps?: boolean;
}

type AuthParams = Record<string, string>;

interface ReolinkConnectionOptions {
    port?: number;
    useHttps?: boolean;
}

interface ReolinkResponse {
    cmd?: string;
    code?: number;
    error?: { detail?: string; rspCode?: number };
    value?: unknown;
}

export interface ReolinkWhiteLedState {
    enabled: boolean;
    brightness?: number;
}

type ReolinkAiStateValue = Record<string, { alarm_state?: number } | number | undefined>;

const REOLINK_AI_TYPE_KEYS: Record<MotionObjectType, string[]> = {
    any: ['people', 'vehicle', 'dog_cat', 'face', 'package', 'other'],
    person: ['people'],
};

/** Parse RTSP URL host and credentials for Reolink api.cgi. */
export function resolveReolinkTarget(camera: Camera): ReolinkCredentials | null {
    let host = camera.reolinkHost?.trim() || undefined;
    let username = camera.username ?? '';
    let password = camera.password ?? '';
    const port = Number.isFinite(camera.reolinkHttpPort) ? camera.reolinkHttpPort : undefined;
    const useHttps = camera.reolinkUseHttps;

    try {
        const parsed = new URL(camera.rtspUrl);
        if (parsed.protocol === 'rtsp:' || parsed.protocol === 'rtsps:') {
            if (!host) host = parsed.hostname;
            if (!username && parsed.username) username = decodeURIComponent(parsed.username);
            if (!password && parsed.password) password = decodeURIComponent(parsed.password);
        }
    } catch {
        if (!host) return null;
    }

    if (!host || !username) return null;

    return {
        host,
        username,
        password,
        channel: camera.reolinkChannel ?? 0,
        port,
        useHttps,
    };
}

export function cameraLooksLikeReolink(camera: Camera): boolean {
    const m = (camera.manufacturer ?? '').toLowerCase();
    if (m.includes('reolink')) return true;
    return camera.motionSource === 'reolink-native';
}

export function reolinkAiStateMatches(
    value: unknown,
    motionObjectType: MotionObjectType = 'any',
): boolean {
    if (!value || typeof value !== 'object') return false;

    const state = value as ReolinkAiStateValue;
    return REOLINK_AI_TYPE_KEYS[motionObjectType].some(key => {
        const entry = state[key];
        return Boolean(entry && typeof entry === 'object' && entry.alarm_state === 1);
    });
}

export interface ReolinkWhiteLedProbeSteps {
    initial: ReolinkWhiteLedState | null;
    setOnOk: boolean;
    afterSetOn: ReolinkWhiteLedState | null;
    setOffOk?: boolean;
    afterSetOff?: ReolinkWhiteLedState | null;
    restoreOnOk?: boolean;
    afterRestoreOn?: ReolinkWhiteLedState | null;
}

/** Pure check: WhiteLed hardware actually toggled after SetWhiteLed (not just API success). */
export function reolinkWhiteLedHardwareVerified(steps: ReolinkWhiteLedProbeSteps): boolean {
    if (!steps.initial) return false;

    if (steps.initial.enabled) {
        if (!steps.setOffOk || !steps.afterSetOff || steps.afterSetOff.enabled) return false;
        return Boolean(steps.restoreOnOk && steps.afterRestoreOn?.enabled);
    }

    return steps.setOnOk && Boolean(steps.afterSetOn?.enabled);
}

export function parseReolinkWhiteLedState(rows: ReolinkResponse[]): ReolinkWhiteLedState | null {
    const row = rows[0];
    if (!row) return null;
    if (row.code !== undefined && row.code !== 0) return null;

    const whiteLed = (row.value as { WhiteLed?: { state?: number; bright?: number } } | undefined)?.WhiteLed;
    if (!whiteLed) return null;

    const state = Number(whiteLed.state);
    const brightnessRaw = whiteLed.bright;
    const brightness = Number.isFinite(Number(brightnessRaw)) ? Number(brightnessRaw) : undefined;

    return {
        enabled: state === 1,
        brightness,
    };
}

async function reolinkFetch(
    host: string,
    params: Record<string, string>,
    init?: { method?: string; body?: unknown },
    connection?: ReolinkConnectionOptions,
): Promise<ReolinkResponse[]> {
    const url = buildReolinkApiUrl(host, connection);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const response = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
        throw new Error(`Reolink HTTP ${response.status}`);
    }

    const body = await response.json() as ReolinkResponse | ReolinkResponse[];
    return Array.isArray(body) ? body : [body];
}

export class ReolinkClient {
    readonly #host: string;
    readonly #username: string;
    readonly #password: string;
    readonly #connection: ReolinkConnectionOptions;
    #auth: AuthParams | null = null;
    #tokenExpiry = 0;

    constructor(host: string, username: string, password: string, connection: ReolinkConnectionOptions = {}) {
        this.#host = host;
        this.#username = username;
        this.#password = password;
        this.#connection = connection;
    }

    async ensureAuth(): Promise<AuthParams> {
        if (this.#auth && this.#tokenExpiry > Date.now()) {
            return this.#auth;
        }

        try {
            const probe = await reolinkFetch(this.#host, {
                cmd: 'GetDevInfo',
                user: this.#username,
                password: this.#password,
            }, undefined, this.#connection);
            const err = probe[0]?.error;
            if (!err) {
                this.#auth = { user: this.#username, password: this.#password };
                this.#tokenExpiry = Number.MAX_SAFE_INTEGER;
                return this.#auth;
            }
        } catch {
            // fall through to token login
        }

        const login = await reolinkFetch(this.#host, { cmd: 'Login' }, {
            method: 'POST',
            body: [{
                cmd: 'Login',
                action: 0,
                param: { User: { userName: this.#username, password: this.#password } },
            }],
        }, this.#connection);

        const token = extractToken(login);
        if (!token) {
            this.#auth = { user: this.#username, password: this.#password };
            this.#tokenExpiry = Date.now() + 60_000;
            return this.#auth;
        }

        const lease = extractLeaseSeconds(login);
        this.#auth = { token };
        this.#tokenExpiry = Date.now() + lease * 1000;
        return this.#auth;
    }

    async getMotionState(channel: number): Promise<boolean> {
        const auth = await this.ensureAuth();
        const rows = await reolinkFetch(this.#host, {
            cmd: 'GetMdState',
            channel: String(channel),
            ...auth,
        }, undefined, this.#connection);
        const state = (rows[0]?.value as { state?: number } | undefined)?.state;
        return state === 1;
    }

    async getAiMotion(channel: number, motionObjectType: MotionObjectType = 'any'): Promise<boolean> {
        const auth = await this.ensureAuth();
        const rows = await reolinkFetch(this.#host, {
            cmd: 'GetAiState',
            channel: String(channel),
            ...auth,
        }, undefined, this.#connection);
        return reolinkAiStateMatches(rows[0]?.value ?? rows, motionObjectType);
    }

    async isMotionActive(channel: number, motionObjectType: MotionObjectType = 'any'): Promise<boolean> {
        if (motionObjectType === 'person') {
            return this.getAiMotion(channel, 'person').catch(() => false);
        }

        const [md, ai] = await Promise.all([
            this.getMotionState(channel).catch(() => false),
            this.getAiMotion(channel, 'any').catch(() => false),
        ]);
        return md || ai;
    }

    async getWhiteLedState(channel: number): Promise<ReolinkWhiteLedState | null> {
        const auth = await this.ensureAuth();
        const rows = await reolinkFetch(this.#host, {
            cmd: 'GetWhiteLed',
            ...auth,
        }, {
            method: 'POST',
            body: [{
                cmd: 'GetWhiteLed',
                action: 1,
                param: { channel },
            }],
        }, this.#connection);

        return parseReolinkWhiteLedState(rows);
    }

    /** Turn the WhiteLed spotlight on or off. Returns false when the API rejects the command. */
    async setWhiteLed(
        channel: number,
        enabled: boolean,
        brightness = 100,
    ): Promise<boolean> {
        const auth = await this.ensureAuth();
        const rows = await reolinkFetch(this.#host, {
            cmd: 'SetWhiteLed',
            ...auth,
        }, {
            method: 'POST',
            body: [{
                cmd: 'SetWhiteLed',
                action: 0,
                param: {
                    WhiteLed: {
                        channel,
                        mode: 1,
                        state: enabled ? 1 : 0,
                        bright: Math.max(0, Math.min(100, Math.round(brightness))),
                    },
                },
            }],
        }, this.#connection);

        return reolinkCommandSucceeded(rows);
    }

    /** Poll GetWhiteLed until `enabled` matches or attempts are exhausted. */
    async waitWhiteLedState(channel: number, expectedEnabled: boolean): Promise<boolean> {
        const attempts = motionConfig.reolinkLightProbeAttempts;
        const delayMs = motionConfig.reolinkLightProbePollMs;

        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0) {
                await sleep(delayMs);
            }

            const state = await this.getWhiteLedState(channel).catch(() => null);
            if (state && state.enabled === expectedEnabled) {
                return true;
            }
        }

        return false;
    }

    /**
     * Active hardware probe: briefly toggles WhiteLed and confirms GetWhiteLed reflects the change.
     * NVR channels without a spotlight often accept SetWhiteLed but never report enabled=true.
     */
    async verifyWhiteLedControl(channel: number): Promise<boolean> {
        const initial = await this.getWhiteLedState(channel);
        if (!initial) return false;

        const bright = initial.brightness && initial.brightness > 0 ? initial.brightness : 50;

        if (initial.enabled) {
            const setOffOk = await this.setWhiteLed(channel, false, bright);
            const afterSetOff = setOffOk
                ? await this.readWhiteLedAfterWait(channel, false)
                : null;
            const restoreOnOk = afterSetOff && !afterSetOff.enabled
                ? await this.setWhiteLed(channel, true, bright)
                : false;
            const afterRestoreOn = restoreOnOk
                ? await this.readWhiteLedAfterWait(channel, true)
                : null;

            return reolinkWhiteLedHardwareVerified({
                initial,
                setOnOk: false,
                afterSetOn: null,
                setOffOk,
                afterSetOff,
                restoreOnOk,
                afterRestoreOn,
            });
        }

        const setOnOk = await this.setWhiteLed(channel, true, bright);
        const afterSetOn = setOnOk ? await this.readWhiteLedAfterWait(channel, true) : null;
        await this.setWhiteLed(channel, false, bright).catch(() => undefined);

        return reolinkWhiteLedHardwareVerified({
            initial,
            setOnOk,
            afterSetOn,
        });
    }

    async readWhiteLedAfterWait(channel: number, expectedEnabled: boolean): Promise<ReolinkWhiteLedState | null> {
        const matched = await this.waitWhiteLedState(channel, expectedEnabled);
        if (!matched) return null;
        return this.getWhiteLedState(channel).catch(() => null);
    }

    /** Reolink native PTZ — more reliable than ONVIF AbsoluteMove on TrackMix and similar models. */
    async ptzCtrl(channel: number, op: string, speed?: number): Promise<boolean> {
        const result = await this.ptzCtrlResult(channel, op, speed);
        return result.ok;
    }

    async ptzCtrlResult(channel: number, op: string, speed?: number): Promise<{ ok: boolean; error?: string }> {
        await this.ensureAuth();
        const param: Record<string, unknown> = { channel, op };
        if (speed !== undefined) param.speed = Math.max(1, Math.min(63, Math.round(speed)));

        const rows = await reolinkFetch(this.#host, {
            cmd: 'PtzCtrl',
            ...this.#auth!,
        }, {
            method: 'POST',
            body: [{ cmd: 'PtzCtrl', action: 0, param }],
        }, this.#connection);

        if (reolinkCommandSucceeded(rows)) {
            return { ok: true };
        }
        return { ok: false, error: reolinkCommandError(rows) };
    }
}

export function reolinkCommandSucceeded(rows: ReolinkResponse[]): boolean {
    const row = rows[0];
    if (!row) return false;
    return row.code === undefined || row.code === 0;
}

export function reolinkCommandError(rows: ReolinkResponse[]): string | undefined {
    const row = rows[0];
    if (!row) return 'empty response';
    if (row.code === undefined || row.code === 0) return undefined;
    const detail = row.error?.detail?.trim();
    return detail || `code ${row.code}`;
}

function extractToken(rows: ReolinkResponse[]): string | undefined {
    const value = rows[0]?.value as { Token?: { name?: string } } | undefined;
    return value?.Token?.name;
}

function extractLeaseSeconds(rows: ReolinkResponse[]): number {
    const value = rows[0]?.value as { Token?: { leaseTime?: number } } | undefined;
    return value?.Token?.leaseTime ?? 3600;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buildReolinkApiUrl(host: string, connection?: ReolinkConnectionOptions): URL {
    const hasScheme = /^[a-z]+:\/\//i.test(host);
    const scheme = connection?.useHttps ? 'https' : 'http';
    const url = hasScheme ? new URL(host) : new URL(`${scheme}://${host}`);

    if (connection?.port !== undefined) {
        url.port = String(connection.port);
    }

    url.pathname = '/api.cgi';
    url.search = '';
    url.hash = '';
    return url;
}
