import { WebRtcTransportDefinitions } from '@matter/types/clusters/web-rtc-transport-definitions';
import type { Go2RtcIceServer } from '../streaming/Go2RTCClient.js';

export function mapMatterIceServers(
    iceServers?: WebRtcTransportDefinitions.IceServer[],
): Go2RtcIceServer[] | undefined {
    if (!iceServers?.length) return undefined;

    const mapped = iceServers
        .map(s => ({
            urls: s.urLs ?? [],
            username: s.username,
            credential: s.credential,
        }))
        .filter(s => s.urls.length > 0);

    return mapped.length ? mapped : undefined;
}

/** Parse a=candidate lines from SDP into Matter IceCandidate objects. */
export function parseSdpIceCandidates(sdp: string): WebRtcTransportDefinitions.IceCandidate[] {
    const results: WebRtcTransportDefinitions.IceCandidate[] = [];
    let currentMid: string | null = null;
    let mLineIndex = -1;

    for (const line of sdp.split(/\r?\n/)) {
        if (line.startsWith('m=')) {
            mLineIndex++;
            currentMid = null;
        }
        if (line.startsWith('a=mid:')) {
            currentMid = line.slice(6);
        }
        if (line.startsWith('a=candidate:')) {
            results.push(new WebRtcTransportDefinitions.IceCandidate({
                candidate: line.slice(2),
                sdpMid: currentMid,
                sdpmLineIndex: mLineIndex >= 0 ? mLineIndex : null,
            }));
        }
    }

    return results;
}

/** Build WHEP trickle-ice-sdpfrag body from Matter ICE candidates. */
export function matterIceToSdpFrag(candidates: WebRtcTransportDefinitions.IceCandidate[]): string {
    const lines: string[] = [];

    for (const c of candidates) {
        const raw = c.candidate?.trim() ?? '';
        if (!raw || raw === 'end-of-candidates') {
            lines.push('a=end-of-candidates');
            continue;
        }
        const cand = raw.startsWith('candidate:') ? raw : `candidate:${raw}`;
        if (c.sdpMid != null) {
            lines.push(`a=mid:${c.sdpMid}`);
        } else if (c.sdpmLineIndex != null) {
            lines.push(`a=mid:${c.sdpmLineIndex}`);
        }
        lines.push(`a=${cand}`);
    }

    return `${lines.join('\r\n')}\r\n`;
}
