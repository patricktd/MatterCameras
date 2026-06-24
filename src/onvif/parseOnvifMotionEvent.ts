import { normalizeOnvifTopic } from './stripNamespaces.js';
import { topicIndicatesMotion, topicIsCellMotionPulse } from './motionTopics.js';

const MOTION_STATE_KEYS = ['IsMotion', 'State', 'Value', 'isMotion', 'state'];

export type OnvifMotionKind = 'pulse' | 'start' | 'stop';

export interface OnvifMotionSignal {
    kind: OnvifMotionKind;
}

/**
 * Parse a PullPoint notification into a motion signal, or undefined if unrelated.
 * Scrypted-aligned: CellMotion ignores false; MotionAlarm stop re-extends hold (mapped to pulse).
 */
export function parseOnvifMotionEvent(message: unknown): OnvifMotionSignal | undefined {
    const record = asRecord(message);
    const rawTopic = extractTopic(record);
    if (!rawTopic || !topicIndicatesMotion(rawTopic)) {
        return undefined;
    }

    const topic = normalizeOnvifTopic(rawTopic);
    const data = extractSimpleItems(record);
    const boolState = readBoolState(data);

    if (topicIsCellMotionPulse(rawTopic)) {
        if (boolState === false) return undefined;
        return { kind: 'pulse' };
    }

    if (topic.includes('motionalarm')) {
        if (boolState === false) return { kind: 'stop' };
        return { kind: 'start' };
    }

    if (boolState === false) return { kind: 'stop' };
    if (boolState === true) return { kind: 'start' };

    return { kind: 'pulse' };
}

/** @deprecated Use parseOnvifMotionEvent + debouncer. Kept for tests migrating from boolean API. */
export function parseOnvifMotionEventLegacy(message: unknown): boolean | undefined {
    const signal = parseOnvifMotionEvent(message);
    if (!signal) return undefined;
    if (signal.kind === 'stop') return false;
    return true;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractTopic(message: Record<string, unknown>): string | undefined {
    const topic = message.topic as Record<string, unknown> | string | undefined;
    if (typeof topic === 'string') return topic;
    if (topic && typeof topic._ === 'string') return topic._;
    return undefined;
}

function extractSimpleItems(message: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    const messageData = message.message as Record<string, unknown> | undefined;
    const data = messageData?.data as Record<string, unknown> | undefined;
    const simpleItem = data?.simpleItem;
    const items = Array.isArray(simpleItem) ? simpleItem : simpleItem ? [simpleItem] : [];

    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const attrs = rec.$ as Record<string, string> | undefined;
        const name = attrs?.Name;
        const value = attrs?.Value;
        if (name && value !== undefined) {
            out[name] = value;
        }
    }
    return out;
}

function readBoolState(data: Record<string, string>): boolean | undefined {
    for (const key of MOTION_STATE_KEYS) {
        const value = data[key];
        if (value !== undefined) {
            return parseBool(String(value));
        }
    }
    return undefined;
}

function parseBool(value: string): boolean {
    return ['true', '1'].includes(value.trim().toLowerCase());
}
