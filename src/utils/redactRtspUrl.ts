/**
 * Redact credentials from an RTSP/RTSPS URL for safe logging and UI display.
 * Replaces `user:password@` with `***@` (mirrors matter-onvif-bridge).
 */
export function redactRtspUrl(url: string): string {
    if (!url) return '<empty-url>';

    try {
        const parsed = new URL(url);
        if (parsed.username || parsed.password) {
            parsed.username = '***';
            parsed.password = '';
        }
        return parsed.toString();
    } catch {
        return url.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//$1:***@');
    }
}

/** Inject or replace RTSP credentials (used after ONVIF GetStreamUri). */
export function injectRtspCredentials(rtspUrl: string, username: string, password: string): string {
    if (!username && !password) return rtspUrl;
    try {
        const parsed = new URL(rtspUrl);
        if (username) parsed.username = encodeURIComponent(username);
        if (password) parsed.password = encodeURIComponent(password);
        return parsed.toString();
    } catch {
        return rtspUrl;
    }
}

/** Redact RTSP credentials embedded in arbitrary log text (e.g. go2rtc error bodies). */
export function redactRtspInText(text: string): string {
    return text.replace(/(rtsps?:\/\/)([^:@/]+):([^@/]+)@/gi, '$1$2:***@');
}
