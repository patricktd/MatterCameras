import { CameraDevice } from '@matter/main/devices/camera';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { MatterCameraAvStreamManagementServer } from '../behaviors/MatterCameraAvStreamManagementServer.js';
import { MatterWebRtcTransportProviderServer } from '../behaviors/MatterWebRtcTransportProviderServer.js';
import { MatterZoneManagementServer } from '../behaviors/MatterZoneManagementServer.js';
import { MatterOccupancySensingServer } from '../behaviors/MatterOccupancySensingServer.js';
import { cameraAvStreamDefaults } from './cameraAvStreamDefaults.js';
import { zoneManagementDefaults } from './zoneManagementDefaults.js';
import { occupancySensingDefaults } from './occupancySensingDefaults.js';
import { Camera } from '../../types/index.js';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../../config/version.js';
import { bridgedUniqueId } from '../bridgedUniqueId.js';

/**
 * Matter 1.5 Camera device type (0x0142) exposed as a bridged endpoint.
 * Video-only AV + custom WebRTC provider (go2rtc).
 */
export const BridgedCameraDevice = CameraDevice.with(
    BridgedDeviceBasicInformationServer,
    MatterCameraAvStreamManagementServer,
    MatterWebRtcTransportProviderServer,
    MatterZoneManagementServer,
    MatterOccupancySensingServer,
);

export function bridgedCameraOptions(camera: Camera) {
    return {
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
}
