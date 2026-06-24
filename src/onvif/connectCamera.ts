import { openOnvifCam } from './createOnvifCam.js';
import { suggestMotionProvider } from '../motion/suggestMotionProvider.js';
import { injectRtspCredentials, redactRtspUrl } from '../utils/redactRtspUrl.js';
import { cameraSupportsOnvifMotion } from './motionTopics.js';
import type { OnvifTarget } from '../streaming/resolveOnvifTarget.js';
import type { OnvifCam } from './createOnvifCam.js';
import type { MotionProviderId, MotionSource } from '../motion/types.js';

export interface ResolvedOnvifCamera {
    name: string;
    rtspUrl: string;
    rtspUrlRedacted: string;
    onvifUrl: string;
    hostname: string;
    port: number;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    supportsMotion: boolean;
    suggestedMotionSource: MotionSource;
    suggestedMotionProvider: MotionProviderId;
    suggestedMotionReason: string;
}

/**
 * Connect to an ONVIF camera and fetch device info + primary RTSP stream URI.
 */
export async function resolveOnvifCamera(target: OnvifTarget): Promise<ResolvedOnvifCamera> {
    const cam = await openOnvifCam(target);
    const [info, streamUri, supportsMotion] = await Promise.all([
        getDeviceInfo(cam),
        getPrimaryStreamUri(cam),
        probeMotionSupport(cam).catch(() => false),
    ]);

    const scheme = target.useSecure ? 'https' : 'http';
    const name = [info.manufacturer, info.model].filter(Boolean).join(' ').trim()
        || info.serialNumber
        || target.hostname;

    const onvifUrl = `${scheme}://${target.hostname}:${target.port}${target.path}`;
    const rtspUrl = injectRtspCredentials(streamUri, target.username, target.password);
    const suggestion = suggestMotionProvider({
        manufacturer: info.manufacturer,
        model: info.model,
        supportsMotion,
    });

    return {
        name,
        rtspUrl,
        rtspUrlRedacted: redactRtspUrl(rtspUrl),
        onvifUrl,
        hostname: target.hostname,
        port: target.port,
        manufacturer: info.manufacturer,
        model: info.model,
        serialNumber: info.serialNumber,
        supportsMotion,
        suggestedMotionSource: suggestion.motionSource,
        suggestedMotionProvider: suggestion.suggestedProvider,
        suggestedMotionReason: suggestion.reason,
    };
}

function getDeviceInfo(cam: OnvifCam): Promise<{
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
}> {
    return new Promise((resolve, reject) => {
        cam.getDeviceInformation((err: Error | null, info: Record<string, string>) => {
            if (err) reject(err);
            else resolve({
                manufacturer: info?.manufacturer,
                model: info?.model,
                serialNumber: info?.serialNumber,
            });
        });
    });
}

function getPrimaryStreamUri(cam: OnvifCam): Promise<string> {
    return new Promise((resolve, reject) => {
        cam.getStreamUri({ protocol: 'RTSP' }, (err: Error | null, stream: Record<string, unknown>) => {
            if (err) {
                reject(err);
                return;
            }
            const uri = String(stream?.uri ?? stream?.Uri ?? '');
            if (!uri) {
                reject(new Error('ONVIF GetStreamUri returned empty URI'));
                return;
            }
            resolve(uri);
        });
    });
}

async function probeMotionSupport(cam: OnvifCam): Promise<boolean> {
    const props = await new Promise<Record<string, unknown>>((resolve, reject) => {
        cam.getEventProperties((err: Error | null, data: Record<string, unknown>) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
    return cameraSupportsOnvifMotion(props);
}
