import { Logger } from '@matter/general';
import { CameraAvSettingsUserLevelManagement } from '@matter/types/clusters/camera-av-settings-user-level-management';
import { CameraAvSettingsUserLevelManagementServer as BaseCameraAvSettingsUserLevelManagementServer } from '@matter/node/behaviors/camera-av-settings-user-level-management';
import { ptzContext } from './ptzContext.js';
import {
    DEFAULT_MPTZ,
    mergeSetPositionHub,
} from '../ptzCoordinates.js';

const AvSettings = CameraAvSettingsUserLevelManagement;
const logger = Logger.get('MatterPtz');

const CameraAvSettingsUserLevelManagementWithMptz =
    BaseCameraAvSettingsUserLevelManagementServer.with(
        'MechanicalPan',
        'MechanicalTilt',
        'MechanicalZoom',
    );

/**
 * Matter mechanical PTZ cluster — delegates hub commands to {@link PtzService} via {@link ptzContext}.
 */
export class MatterCameraAvSettingsUserLevelManagementServer
    extends CameraAvSettingsUserLevelManagementWithMptz {

    async mptzSetPosition(request: {
        pan?: number;
        tilt?: number;
        zoom?: number;
    }) {
        const cameraId = String(this.endpoint.id);
        const handler = ptzContext.setPosition.get(cameraId);
        const hubReader = ptzContext.readHubPosition.get(cameraId);
        const hubCurrent = hubReader?.() ?? DEFAULT_MPTZ;

        const target = mergeSetPositionHub(hubCurrent, request);
        logger.info(
            `mptzSetPosition camera=${cameraId} pan=${target.pan} tilt=${target.tilt} `
            + `zoom=${request.zoom ?? hubCurrent.zoom} (hub zoom=1)`,
        );

        if (!handler) {
            logger.warn(`PTZ setPosition ignored — no handler camera=${cameraId}`);
            return;
        }

        this.state.movementState = AvSettings.PhysicalMovement.Moving;
        try {
            const ok = await handler(target);
            if (ok) {
                // Keep mptzPosition at defaults — updating it makes SmartThings show
                // "saved as preset" on every mptzSetPosition tap/hold.
                logger.info(`mptzSetPosition ok camera=${cameraId}`);
            } else {
                logger.warn(`mptzSetPosition failed camera=${cameraId}`);
            }
        } finally {
            this.state.movementState = AvSettings.PhysicalMovement.Idle;
        }
    }

    async mptzRelativeMove(request: {
        panDelta?: number;
        tiltDelta?: number;
        zoomDelta?: number;
    }) {
        const cameraId = String(this.endpoint.id);
        const handler = ptzContext.relativeMove.get(cameraId);

        logger.info(
            `mptzRelativeMove camera=${cameraId} panDelta=${request.panDelta ?? 0} `
            + `tiltDelta=${request.tiltDelta ?? 0} zoomDelta=${request.zoomDelta ?? 0}`,
        );

        if (!handler) {
            logger.warn(`PTZ relativeMove ignored — no handler camera=${cameraId}`);
            return;
        }

        this.state.movementState = AvSettings.PhysicalMovement.Moving;
        try {
            const ok = await handler({
                panDelta: request.panDelta ?? 0,
                tiltDelta: request.tiltDelta ?? 0,
                zoomDelta: request.zoomDelta ?? 0,
            });
            if (ok) {
                logger.info(`mptzRelativeMove ok camera=${cameraId}`);
            } else {
                logger.warn(`mptzRelativeMove failed camera=${cameraId}`);
            }
        } finally {
            this.state.movementState = AvSettings.PhysicalMovement.Idle;
        }
    }
}
