import type { Go2RTCClient } from '../../streaming/Go2RTCClient.js';

/** Shared streaming dependencies for Matter camera behaviors */
export const streamContext = {
    go2rtc: null as Go2RTCClient | null,
};
