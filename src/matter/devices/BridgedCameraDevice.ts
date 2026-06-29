import { CameraDevice } from '@matter/main/devices/camera';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { MatterCameraAvStreamManagementServer } from '../behaviors/MatterCameraAvStreamManagementServer.js';
import { MatterCameraAvSettingsUserLevelManagementServer } from '../behaviors/MatterCameraAvSettingsUserLevelManagementServer.js';
import { MatterWebRtcTransportProviderServer } from '../behaviors/MatterWebRtcTransportProviderServer.js';
import { MatterZoneManagementServer } from '../behaviors/MatterZoneManagementServer.js';
import { MatterOccupancySensingServer } from '../behaviors/MatterOccupancySensingServer.js';
import { cameraAvStreamDefaults } from './cameraAvStreamDefaults.js';
import { cameraAvSettingsDefaults } from './cameraAvSettingsDefaults.js';
import { zoneManagementDefaults } from './zoneManagementDefaults.js';
import { occupancySensingDefaults } from './occupancySensingDefaults.js';
import { Camera } from '../../types/index.js';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../../config/version.js';
import { bridgedUniqueId } from '../bridgedUniqueId.js';
import { shouldExposePtz } from '../ptzConfig.js';

const BridgedCameraDeviceCore = CameraDevice.with(
    BridgedDeviceBasicInformationServer,
    MatterCameraAvStreamManagementServer,
    MatterWebRtcTransportProviderServer,
    MatterZoneManagementServer,
    MatterOccupancySensingServer,
);

/**
 * Matter 1.5 Camera device type (0x0142) exposed as a bridged endpoint.
 * Video-only AV + custom WebRTC provider (go2rtc).
 */
export const BridgedCameraDevice = BridgedCameraDeviceCore;

/** Same as {@link BridgedCameraDevice} but advertises mechanical PTZ to the hub. */
export const BridgedCameraDeviceWithPtz = BridgedCameraDeviceCore.with(
    MatterCameraAvSettingsUserLevelManagementServer,
);

export function bridgedCameraDeviceType(camera: Camera) {
    return shouldExposePtz(camera) ? BridgedCameraDeviceWithPtz : BridgedCameraDevice;
}

export function bridgedCameraOptions(camera: Camera) {
    const options: Record<string, unknown> = {
        id: camera.id,
        bridgedDeviceBasicInformation: {
            nodeLabel: camera.name,
            reachable: true,
            vendorName: 'MatterCameras',
            productName: 'RTSP Camera',
            serialNumber: camera.id,
            uniqueId: bridgedUniqueId(camera.id, camera.matterBindEpoch),
            hardwareVersion: 1,
            hardwareVersionString: '1.0',
            softwareVersion: getMatterSoftwareVersion(),
            softwareVersionString: getMatterSoftwareVersionString(),
        },
        cameraAvStreamManagement: cameraAvStreamDefaults(),
        zoneManagement: zoneManagementDefaults(),
        occupancySensing: occupancySensingDefaults(),
    };

    if (shouldExposePtz(camera)) {
        options.cameraAvSettingsUserLevelManagement = cameraAvSettingsDefaults();
    }

    return options;
}

export { MatterCameraAvSettingsUserLevelManagementServer };
