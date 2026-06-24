import type { Camera } from '../../../types/index.js';

export interface ReolinkCredentials {
    host: string;
    username: string;
    password: string;
    channel: number;
}

type AuthParams = Record<string, string>;

interface ReolinkResponse {
    cmd?: string;
    code?: number;
    error?: { detail?: string; rspCode?: number };
    value?: unknown;
}

/** Parse RTSP URL host and credentials for Reolink api.cgi. */
export function resolveReolinkTarget(camera: Camera): ReolinkCredentials | null {
    let host: string | undefined;
    let username = camera.username ?? '';
    let password = camera.password ?? '';

    try {
        const parsed = new URL(camera.rtspUrl);
        if (parsed.protocol === 'rtsp:' || parsed.protocol === 'rtsps:') {
            host = parsed.hostname;
            if (parsed.username) username = decodeURIComponent(parsed.username);
            if (parsed.password) password = decodeURIComponent(parsed.password);
        }
    } catch {
        return null;
    }

    if (!host || !username) return null;

    return {
        host,
        username,
        password,
        channel: camera.reolinkChannel ?? 0,
    };
}

export function cameraLooksLikeReolink(camera: Camera): boolean {
    const m = (camera.manufacturer ?? '').toLowerCase();
    if (m.includes('reolink')) return true;
    return camera.motionSource === 'reolink-native';
}

async function reolinkFetch(
    host: string,
    params: Record<string, string>,
    init?: { method?: string; body?: unknown },
): Promise<ReolinkResponse[]> {
    const url = new URL(`http://${host}/api.cgi`);
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
    #auth: AuthParams | null = null;
    #tokenExpiry = 0;

    constructor(host: string, username: string, password: string) {
        this.#host = host;
        this.#username = username;
        this.#password = password;
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
            });
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
        });

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
        });
        const state = (rows[0]?.value as { state?: number } | undefined)?.state;
        return state === 1;
    }

    async getAiMotion(channel: number): Promise<boolean> {
        const auth = await this.ensureAuth();
        const rows = await reolinkFetch(this.#host, {
            cmd: 'GetAiState',
            channel: String(channel),
            ...auth,
        });
        const value = (rows[0]?.value ?? rows) as Record<string, { alarm_state?: number } | number | undefined>;
        if (!value || typeof value !== 'object') return false;

        for (const key of ['people', 'vehicle', 'dog_cat', 'face', 'package', 'other']) {
            const entry = value[key];
            if (entry && typeof entry === 'object' && entry.alarm_state === 1) {
                return true;
            }
        }
        return false;
    }

    async isMotionActive(channel: number): Promise<boolean> {
        const [md, ai] = await Promise.all([
            this.getMotionState(channel).catch(() => false),
            this.getAiMotion(channel).catch(() => false),
        ]);
        return md || ai;
    }
}

function extractToken(rows: ReolinkResponse[]): string | undefined {
    const value = rows[0]?.value as { Token?: { name?: string } } | undefined;
    return value?.Token?.name;
}

function extractLeaseSeconds(rows: ReolinkResponse[]): number {
    const value = rows[0]?.value as { Token?: { leaseTime?: number } } | undefined;
    return value?.Token?.leaseTime ?? 3600;
}
