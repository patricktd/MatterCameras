import { CameraAvSettingsUserLevelManagement } from '@matter/types/clusters/camera-av-settings-user-level-management';
import { DEFAULT_MPTZ } from '../ptzCoordinates.js';

const AvSettings = CameraAvSettingsUserLevelManagement;

export function cameraAvSettingsDefaults(): Partial<CameraAvSettingsUserLevelManagement.Attributes> {
    return {
        mptzPosition: { ...DEFAULT_MPTZ },
        movementState: AvSettings.PhysicalMovement.Idle,
        zoomMax: 100,
        tiltMin: -90,
        tiltMax: 90,
        panMin: -180,
        panMax: 180,
    };
}
