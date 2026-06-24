/** Normalize ONVIF event topic strings (strip xmlns prefixes before matching). */
export function stripNamespaces(topic: string): string {
    return topic.replace(/\b(tns1|tt|wsnt|tev|timg):/gi, '');
}

export function normalizeOnvifTopic(topic: string): string {
    return stripNamespaces(topic).toLowerCase();
}
