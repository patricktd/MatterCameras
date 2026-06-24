import type { Camera } from '../types/index.js';
import { redactRtspUrl } from './redactRtspUrl.js';

/** Camera fields safe for Web UI / API responses (passwords never exposed). */
export type PublicCamera = Omit<Camera, 'password'> & {
    rtspUrlRedacted: string;
    hasPassword: boolean;
};

export function sanitizeCameraForPublic(camera: Camera): PublicCamera {
    const { password, ...rest } = camera;
    return {
        ...rest,
        rtspUrlRedacted: redactRtspUrl(camera.rtspUrl),
        hasPassword: Boolean(password || /\/\/[^:@/]+:[^@/]+@/.test(camera.rtspUrl)),
    };
}
