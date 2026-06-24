import { normalizeOnvifTopic } from './stripNamespaces.js';

/** ONVIF topic fragments that indicate motion or smart-detect activity. */
export const MOTION_TOPIC_MARKERS = [
    'cellmotiondetector/motion',
    'motionalarm',
    'fielddetector',
    'linedetector',
    'humanbodydetector',
    'videomotion',
    // Reolink ONVIF AI
    'peopledetect',
    'vehicledetect',
    'dogcatdetect',
    'facedetect',
    'packagedetect',
    // Generic smart detect / doorbell
    'ruleengine/objectdetector',
    'visitor',
    'videosource/alarm',
    'myruledetector',
    'ring',
    'camerabellbutton',
];

const TOPIC_COLLECT_RE = new RegExp(
    MOTION_TOPIC_MARKERS.map(m => `[^"]*${m}[^"]*`).join('|'),
    'gi',
);

export function topicIndicatesMotion(topic: string): boolean {
    const lc = normalizeOnvifTopic(topic);
    return MOTION_TOPIC_MARKERS.some(m => lc.includes(m));
}

/** CellMotion firmware often sends unreliable false edges — treat as pulse-only. */
export function topicIsCellMotionPulse(topic: string): boolean {
    return normalizeOnvifTopic(topic).includes('cellmotiondetector/motion');
}

export function collectMotionTopics(props: Record<string, unknown>): string[] {
    const topicSet = props.topicSet ?? props.TopicSet;
    if (!topicSet) return [];
    const json = JSON.stringify(topicSet);
    return json.match(TOPIC_COLLECT_RE) ?? [];
}

export function cameraSupportsOnvifMotion(props: Record<string, unknown>): boolean {
    return collectMotionTopics(props).length > 0;
}
