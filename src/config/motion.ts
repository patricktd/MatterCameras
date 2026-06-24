/** RTSP frame-diff and ONVIF motion tuning. */
export const motionConfig = {
    /** Poll interval for JPEG motion samples (ms). */
    pollIntervalMs: Number(process.env.MOTION_POLL_MS ?? 3_000),
    /** ONVIF hold time after each motion pulse (ms). */
    onvifHoldMs: Number(process.env.MOTION_ONVIF_HOLD_MS ?? 30_000),
    /** Reolink native api.cgi poll interval (ms). */
    reolinkPollMs: Number(process.env.MOTION_REOLINK_POLL_MS ?? 1_000),
    /** Reolink motion hold after active poll (ms). */
    reolinkHoldMs: Number(process.env.MOTION_REOLINK_HOLD_MS ?? 20_000),
    /** UniFi Protect motion hold (ms). */
    unifiHoldMs: Number(process.env.MOTION_UNIFI_HOLD_MS ?? 25_000),
};
