import type { Camera } from '../types/index.js';
import type { ResolvedCameraDraft } from './types.js';

let cameraIdSeq = 0;

export function draftToCamera(draft: ResolvedCameraDraft): Camera {
    cameraIdSeq += 1;
    return {
        id: `cam-${Date.now()}-${cameraIdSeq}`,
        name: draft.name,
        rtspUrl: draft.rtspUrl,
        motionSource: draft.suggestedMotionSource ?? 'auto',
        username: draft.username,
        password: draft.password,
        manufacturer: draft.manufacturer,
        model: draft.model,
        onvifUrl: draft.onvifUrl,
        reolinkChannel: draft.reolinkChannel,
        protectHost: draft.protectHost,
        protectCameraId: draft.protectCameraId,
        addSource: draft.addSource,
    };
}
