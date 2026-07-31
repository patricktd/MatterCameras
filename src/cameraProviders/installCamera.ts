import { randomUUID } from 'node:crypto';
import type { Camera } from '../types/index.js';
import type { ResolvedCameraDraft } from './types.js';

export function draftToCamera(draft: ResolvedCameraDraft): Camera {
    return {
        // Same scheme as POST /api/cameras — avoid Date.now() collisions on bulk import.
        id: 'cam-' + randomUUID().replace(/-/g, '').slice(0, 12),
        name: draft.name,
        rtspUrl: draft.rtspUrl,
        motionSource: draft.suggestedMotionSource ?? 'auto',
        motionObjectType: 'any',
        personSensorEnabled: false,
        reolinkLightEnabled: false,
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
