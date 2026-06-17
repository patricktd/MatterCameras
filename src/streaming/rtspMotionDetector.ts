import { Logger } from '@matter/general';
import type { Go2RTCClient } from './Go2RTCClient.js';
import { motionConfig } from '../config/motion.js';

const logger = Logger.get('MotionDetect');

export interface MotionDetectorOptions {
    /** How often to sample a low-res JPEG frame from go2rtc. */
    pollIntervalMs?: number;
    /** Downscaled width for motion samples (height follows aspect ratio). */
    sampleWidth?: number;
    /** Fraction of changed samples to enter motion (0–1). Higher = less sensitive. */
    triggerRatio?: number;
    /** Fraction to exit motion while active; must be below triggerRatio (hysteresis). */
    clearRatio?: number;
    /** Consecutive active polls required before reporting motion. */
    activateAfter?: number;
    /** Consecutive inactive polls required before clearing motion. */
    deactivateAfter?: number;
}

const DEFAULT_OPTS: Required<MotionDetectorOptions> = {
    pollIntervalMs: motionConfig.pollIntervalMs,
    sampleWidth: 128,
    triggerRatio: 0.14,
    clearRatio: 0.08,
    activateAfter: 2,
    deactivateAfter: 4,
};

/**
 * Generic RTSP motion detection via consecutive JPEG frame comparison.
 * Uses go2rtc snapshots only — no vendor-specific APIs.
 */
export class RtspMotionDetector {
    readonly #cameraId: string;
    readonly #onActive: (active: boolean) => void;
    readonly #onPulse: () => void;
    readonly #opts: Required<MotionDetectorOptions>;
    #timer?: ReturnType<typeof setInterval>;
    #previous?: Uint8Array;
    #polling = false;
    #sensitivity = 3;
    #sensitivityMax = 10;
    #lastReportedActive = false;
    #consecutiveActive = 0;
    #consecutiveInactive = 0;

    constructor(
        cameraId: string,
        onActive: (active: boolean) => void,
        onPulse: () => void,
        opts?: MotionDetectorOptions,
    ) {
        this.#cameraId = cameraId;
        this.#onActive = onActive;
        this.#onPulse = onPulse;
        this.#opts = { ...DEFAULT_OPTS, ...opts };
    }

    setSensitivity(level: number, max = 10): void {
        this.#sensitivity = Math.max(1, Math.min(max, level));
        this.#sensitivityMax = max;
    }

    start(go2rtc: Go2RTCClient): void {
        if (this.#timer) return;

        logger.info(`Motion detector start camera=${this.#cameraId} poll=${this.#opts.pollIntervalMs}ms`);
        void this.#poll(go2rtc);
        this.#timer = setInterval(() => void this.#poll(go2rtc), this.#opts.pollIntervalMs);
    }

    stop(): void {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = undefined;
        }
        this.#previous = undefined;
        this.#consecutiveActive = 0;
        this.#consecutiveInactive = 0;
        if (this.#lastReportedActive) {
            this.#lastReportedActive = false;
            this.#onActive(false);
        }
        logger.info(`Motion detector stop camera=${this.#cameraId}`);
    }

    async #poll(go2rtc: Go2RTCClient): Promise<void> {
        if (this.#polling) return;
        this.#polling = true;
        try {
            const frame = await go2rtc.captureFrame(this.#cameraId, this.#opts.sampleWidth);
            const ratio = this.#motionRatio(frame);
            const active = this.#debouncedActive(ratio);

            if (active !== this.#lastReportedActive) {
                this.#lastReportedActive = active;
                this.#onActive(active);
            } else if (active) {
                this.#onPulse();
            }
        } catch (error) {
            logger.warn(`Motion poll failed camera=${this.#cameraId}: ${error}`);
        } finally {
            this.#polling = false;
        }
    }

    #debouncedActive(ratio: number): boolean {
        const threshold = this.#lastReportedActive ? this.#clearThreshold() : this.#triggerThreshold();

        if (ratio >= threshold) {
            this.#consecutiveActive++;
            this.#consecutiveInactive = 0;
            const need = this.#lastReportedActive ? 1 : this.#opts.activateAfter;
            return this.#consecutiveActive >= need;
        }

        this.#consecutiveInactive++;
        this.#consecutiveActive = 0;
        const need = this.#lastReportedActive ? this.#opts.deactivateAfter : 1;
        if (this.#lastReportedActive && this.#consecutiveInactive < need) {
            return true;
        }
        return false;
    }

    #motionRatio(frame: Uint8Array): number {
        const previous = this.#previous;
        this.#previous = frame;
        if (!previous) return 0;
        return changedSampleRatio(previous, frame);
    }

    /** Lower sensitivity number → higher threshold (less false triggers). */
    #triggerThreshold(): number {
        const span = Math.max(1, this.#sensitivityMax - 1);
        const t = (this.#sensitivityMax - this.#sensitivity) / span;
        return this.#opts.triggerRatio + t * 0.10;
    }

    #clearThreshold(): number {
        const span = Math.max(1, this.#sensitivityMax - 1);
        const t = (this.#sensitivityMax - this.#sensitivity) / span;
        return this.#opts.clearRatio + t * 0.05;
    }
}

/** Subsampled ratio of byte pairs that differ beyond JPEG noise (skips headers). */
function changedSampleRatio(prev: Uint8Array, curr: Uint8Array): number {
    const headerSkip = 1024;
    const len = Math.min(prev.length, curr.length);
    if (len <= headerSkip) return 0;

    let changed = 0;
    let samples = 0;
    const step = 64;
    const deltaMin = 18;
    for (let i = headerSkip; i < len; i += step) {
        if (Math.abs(prev[i] - curr[i]) >= deltaMin) {
            changed++;
        }
        samples++;
    }
    return samples > 0 ? changed / samples : 0;
}
