import Onvif from 'onvif';
import type { Camera } from '../types/index.js';

export interface DiscoveredOnvifDevice {
    /** Stable ONVIF endpoint URN */
    urn: string;
    hostname: string;
    port: number;
    path: string;
    onvifUrl: string;
    /** Human-readable label from WS-Discovery scopes when available */
    label?: string;
}

const DEFAULT_PROBE_MS = 5_000;

/**
 * WS-Discovery probe for ONVIF NetworkVideoTransmitter devices on the LAN.
 * Requires UDP 3702 multicast (works with Docker host networking).
 */
export function probeOnvifDevices(timeoutMs = DEFAULT_PROBE_MS): Promise<DiscoveredOnvifDevice[]> {
    return new Promise((resolve, reject) => {
        Onvif.Discovery.probe({ timeout: timeoutMs, resolve: false }, (err, devices) => {
            const list = Array.isArray(devices) ? devices : [];
            if (err && list.length === 0) {
                reject(err);
                return;
            }

            const seen = new Set<string>();
            const out: DiscoveredOnvifDevice[] = [];

            for (const raw of list) {
                const device = normalizeProbeMatch(raw);
                if (!device || seen.has(device.urn)) continue;
                seen.add(device.urn);
                out.push(device);
            }

            out.sort((a, b) => a.label?.localeCompare(b.label ?? '') ?? a.hostname.localeCompare(b.hostname));
            resolve(out);
        });
    });
}

/** Drop ONVIF devices that match a camera already in cameras.json (by ONVIF URL or RTSP host). */
export function filterNewOnvifDevices(
    devices: DiscoveredOnvifDevice[],
    cameras: Camera[],
): DiscoveredOnvifDevice[] {
    return devices.filter(device => !isOnvifDeviceAlreadyAdded(device, cameras));
}

function isOnvifDeviceAlreadyAdded(device: DiscoveredOnvifDevice, cameras: Camera[]): boolean {
    const deviceKey = normalizeOnvifEndpoint(device.hostname, device.port, device.path);

    for (const cam of cameras) {
        if (cam.onvifUrl) {
            try {
                const parsed = new URL(cam.onvifUrl);
                const port = parsed.port
                    ? Number(parsed.port)
                    : (parsed.protocol === 'https:' ? 443 : 80);
                const key = normalizeOnvifEndpoint(parsed.hostname, port, parsed.pathname);
                if (key === deviceKey) return true;
            } catch {
                // ignore malformed onvifUrl
            }
        }

        try {
            const rtsp = new URL(cam.rtspUrl);
            if (rtsp.hostname.toLowerCase() === device.hostname.toLowerCase()) {
                return true;
            }
        } catch {
            // ignore malformed rtspUrl
        }
    }

    return false;
}

function normalizeOnvifEndpoint(hostname: string, port: number, path: string): string {
    const normalizedPath = path || '/onvif/device_service';
    return `${hostname.toLowerCase()}:${port}${normalizedPath}`;
}

function normalizeProbeMatch(raw: unknown): DiscoveredOnvifDevice | null {
    const data = asRecord(raw);
    const probeMatches = asRecord(data.probeMatches);
    const probeMatch = asRecord(probeMatches.probeMatch ?? data.probeMatch);
    if (!Object.keys(probeMatch).length) return null;

    const urn = stringField(probeMatch.endpointReference, 'address')
        || stringField(probeMatch, 'endpointReference')
        || '';

    const xaddrs = String(probeMatch.xaddrs ?? probeMatch.XAddrs ?? '');
    const firstAddr = xaddrs.split(/\s+/).find(Boolean);
    if (!firstAddr) return null;

    let parsed: URL;
    try {
        parsed = new URL(firstAddr);
    } catch {
        return null;
    }

    const hostname = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    const path = parsed.pathname || '/onvif/device_service';
    const onvifUrl = `${parsed.protocol}//${parsed.host}${path}`;

    return {
        urn: urn || `${hostname}:${port}`,
        hostname,
        port,
        path,
        onvifUrl,
        label: labelFromScopes(String(probeMatch.scopes ?? probeMatch.Scopes ?? '')),
    };
}

/** ONVIF scopes often include onvif://www.onvif.org/name/MyCamera */
function labelFromScopes(scopes: string): string | undefined {
    const parts = scopes.split(/\s+/).filter(Boolean);
    for (const scope of parts) {
        const nameMatch = scope.match(/\/name\/([^/]+)$/i);
        if (nameMatch) return decodeURIComponent(nameMatch[1].replace(/%20/g, ' '));
    }
    return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringField(obj: unknown, key: string): string | undefined {
    const rec = asRecord(obj);
    const value = rec[key];
    return typeof value === 'string' ? value : undefined;
}
