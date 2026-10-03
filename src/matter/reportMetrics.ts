/**
 * Diagnostics-only counters for Matter interaction traffic originating from this bridge.
 *
 * Counts the attribute/event writes the bridge actually performs (the only possible source of
 * attribute reports), plus subscription lifecycle, over a sliding time window. Used to confirm or
 * refute claims of an "event storm" with real numbers instead of inference.
 *
 * This module must never change bridge behavior — it only observes.
 */

/** Default sliding window for rate measurements (ms). Override with REPORT_WINDOW_MS. */
const DEFAULT_WINDOW_MS = 30_000;

/** Cap on retained timestamps per series; older entries are trimmed first. */
const MAX_EVENTS_PER_SERIES = 5_000;

/** Hard cap on tracked series to bound memory on pathological installs. */
const MAX_SERIES = 1_000;

interface Series {
    /** Timestamps (ms) of recorded events, oldest first. */
    events: number[];
    /** Total events ever recorded, independent of the window. */
    lifetime: number;
}

export interface ReportMetricsSnapshot {
    windowMs: number;
    windowStartedAt: string;
    now: string;
    /** Attribute/event writes observed in the window, across every endpoint. */
    total: number;
    /** Subscription change events observed in the window. */
    subscriptions: { changed: number };
    perEndpoint: Record<string, {
        total: number;
        perCluster: Record<string, number>;
        perAttribute: Record<string, number>;
    }>;
    /** Highest-volume attributes in the window (bounded list). */
    topAttributes: Array<{ endpoint: string; cluster: string; attribute: string; count: number }>;
    /** Distinct endpoints that emitted at least once in the window. */
    activeEndpointCount: number;
    /** Total events recorded since process start, for context. */
    lifetimeTotal: number;
}

export class ReportMetrics {
    readonly #windowMs: number;
    readonly #series = new Map<string, Series>();
    readonly #subscriptions: Series = { events: [], lifetime: 0 };
    #lifetimeTotal = 0;

    constructor(windowMs = Number(process.env['REPORT_WINDOW_MS'] ?? DEFAULT_WINDOW_MS)) {
        this.#windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
    }

    /** Record one attribute/event written by the bridge. */
    record(endpointId: string, cluster: string, attribute: string, count = 1): void {
        if (count <= 0) return;

        const key = `${endpointId}|${cluster}|${attribute}`;
        let series = this.#series.get(key);
        if (!series) {
            if (this.#series.size >= MAX_SERIES) return;
            series = { events: [], lifetime: 0 };
            this.#series.set(key, series);
        }

        const now = Date.now();
        for (let i = 0; i < count; i++) {
            series.events.push(now);
        }
        series.lifetime += count;
        this.#lifetimeTotal += count;

        const overflow = series.events.length - MAX_EVENTS_PER_SERIES;
        if (overflow > 0) {
            series.events.splice(0, overflow); // Oldest first — window never needs more than this.
        }
    }

    /** Record a subscription set change (hub (re)subscribing or dropping a subscription). */
    recordSubscriptionChanged(count = 1): void {
        if (count <= 0) return;
        const now = Date.now();
        for (let i = 0; i < count; i++) {
            this.#subscriptions.events.push(now);
        }
        this.#subscriptions.lifetime += count;
        const overflow = this.#subscriptions.events.length - MAX_EVENTS_PER_SERIES;
        if (overflow > 0) {
            this.#subscriptions.events.splice(0, overflow);
        }
    }

    snapshot(): ReportMetricsSnapshot {
        const now = Date.now();
        const cutoff = now - this.#windowMs;

        const perEndpoint: ReportMetricsSnapshot['perEndpoint'] = {};
        const topAttributes: ReportMetricsSnapshot['topAttributes'] = [];
        let total = 0;

        for (const [key, series] of this.#series) {
            const count = countSince(series.events, cutoff);
            if (count <= 0) continue;

            const [endpoint, cluster, attribute] = key.split('|');
            total += count;

            const ep = (perEndpoint[endpoint] ??= { total: 0, perCluster: {}, perAttribute: {} });
            ep.total += count;
            ep.perCluster[cluster] = (ep.perCluster[cluster] ?? 0) + count;
            ep.perAttribute[attribute] = (ep.perAttribute[attribute] ?? 0) + count;

            topAttributes.push({ endpoint, cluster, attribute, count });
        }

        topAttributes.sort((a, b) => b.count - a.count);

        return {
            windowMs: this.#windowMs,
            windowStartedAt: new Date(cutoff).toISOString(),
            now: new Date(now).toISOString(),
            total,
            subscriptions: { changed: countSince(this.#subscriptions.events, cutoff) },
            perEndpoint,
            topAttributes: topAttributes.slice(0, 40),
            activeEndpointCount: Object.keys(perEndpoint).length,
            lifetimeTotal: this.#lifetimeTotal,
        };
    }
}

/** Number of timestamps at or after `cutoff` (events are sorted oldest first). */
function countSince(events: number[], cutoff: number): number {
    let low = 0;
    let high = events.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (events[mid] < cutoff) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return events.length - low;
}

/** Shared instance used by bridge behaviors and the diagnostics endpoint. */
export const reportMetrics = new ReportMetrics();
