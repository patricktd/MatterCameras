/** RTSP frame-diff motion detection (poll interval and detector tuning). */
export const motionConfig = {
    /** Poll interval for JPEG motion samples (ms). */
    pollIntervalMs: Number(process.env.MOTION_POLL_MS ?? 3_000),
};
