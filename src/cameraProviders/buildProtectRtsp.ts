/** Build RTSPS URL for a UniFi Protect channel (same pattern as Scrypted unifi-protect plugin). */
export function buildProtectRtspUrl(opts: {
    controllerHost: string;
    connectionHost?: string;
    username: string;
    password: string;
    rtspAlias: string;
}): string {
    const streamHost = opts.connectionHost?.trim() || opts.controllerHost;
    const user = encodeURIComponent(opts.username);
    const pass = encodeURIComponent(opts.password);
    return `rtsps://${user}:${pass}@${streamHost}:7441/${opts.rtspAlias}`;
}

export interface ProtectChannelLike {
    id?: number;
    name?: string;
    rtspAlias?: string;
    width?: number;
    height?: number;
}

/** Prefer the highest-resolution channel that exposes an RTSP alias. */
export function pickProtectStreamChannel(channels: ProtectChannelLike[] | undefined): ProtectChannelLike | null {
    if (!channels?.length) return null;
    const withAlias = channels.filter(ch => ch.rtspAlias);
    if (!withAlias.length) return channels[0] ?? null;
    return withAlias.reduce((best, ch) => {
        const score = (ch.width ?? 0) * (ch.height ?? 0);
        const bestScore = (best.width ?? 0) * (best.height ?? 0);
        return score > bestScore ? ch : best;
    });
}
