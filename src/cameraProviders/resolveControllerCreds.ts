import { settings } from '../storage/settings.js';
import type { ProtectControllerSettings } from '../storage/settings.js';
import type { CameraDiscoverContext, CameraResolveContext } from './types.js';

export interface ResolvedControllerCreds {
    host: string;
    username: string;
    password: string;
    fromSaved: boolean;
}

/** Merge request body with saved Protect controller credentials. */
export function resolveProtectCredentials(
    ctx: Pick<CameraDiscoverContext | CameraResolveContext, 'host' | 'username' | 'password'>,
): ResolvedControllerCreds {
    const saved = settings.getProtectController();
    const host = String(ctx.host ?? saved?.host ?? '').trim();
    const username = String(ctx.username ?? saved?.username ?? '').trim();
    let password = String(ctx.password ?? '');
    let fromSaved = false;

    if (!password && saved && saved.host.toLowerCase() === host.toLowerCase()) {
        password = saved.password;
        fromSaved = true;
    }

    if (!host || !username) {
        throw new Error('controller host and username are required (save them in Options or enter here)');
    }

    return { host, username, password, fromSaved };
}

export function protectControllerToSave(
    creds: ResolvedControllerCreds,
): ProtectControllerSettings {
    return {
        host: creds.host,
        username: creds.username,
        password: creds.password,
    };
}
