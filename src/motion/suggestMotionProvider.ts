import type { MotionProviderId, MotionSource } from './types.js';

export interface SuggestMotionInput {
    manufacturer?: string;
    model?: string;
    supportsMotion?: boolean;
}

export interface SuggestedMotion {
    /** Recommended `motionSource` for cameras.json / Web UI. */
    motionSource: MotionSource;
    /** Primary provider id that will run when motionSource is `auto`. */
    suggestedProvider: MotionProviderId;
    reason: string;
}

/** Heuristic motion backend suggestion after ONVIF resolve or manual setup. */
export function suggestMotionProvider(input: SuggestMotionInput): SuggestedMotion {
    const manufacturer = (input.manufacturer ?? '').toLowerCase();
    const model = (input.model ?? '').toLowerCase();

    if (manufacturer.includes('reolink')) {
        return {
            motionSource: 'auto',
            suggestedProvider: 'reolink-native',
            reason: 'Reolink camera — native api.cgi preferred over generic ONVIF',
        };
    }

    if (manufacturer.includes('ubiquiti') || manufacturer.includes('unifi') || model.includes('unifi')) {
        return {
            motionSource: 'auto',
            suggestedProvider: 'unifi-protect',
            reason: 'UniFi device — configure Protect controller host and camera id',
        };
    }

    if (manufacturer.includes('tapo') || manufacturer.includes('tp-link') || model.includes('tapo')) {
        return {
            motionSource: 'auto',
            suggestedProvider: 'onvif',
            reason: 'Tapo — use ONVIF Camera Account (often port 2020)',
        };
    }

    if (manufacturer.includes('sonoff')) {
        return {
            motionSource: 'auto',
            suggestedProvider: 'onvif',
            reason: 'Sonoff — ONVIF PullPoint motion',
        };
    }

    if (input.supportsMotion) {
        return {
            motionSource: 'auto',
            suggestedProvider: 'onvif',
            reason: 'ONVIF motion topics detected on device',
        };
    }

    return {
        motionSource: 'auto',
        suggestedProvider: 'frame-diff',
        reason: 'No native motion API detected — auto will fall back to frame diff',
    };
}
