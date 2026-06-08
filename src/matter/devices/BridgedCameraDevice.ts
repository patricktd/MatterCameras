import { CameraDevice } from '@matter/main/devices/camera';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { MatterCameraAvStreamManagementServer } from '../behaviors/MatterCameraAvStreamManagementServer.js';
import { MatterWebRtcTransportProviderServer } from '../behaviors/MatterWebRtcTransportProviderServer.js';
import { cameraAvStreamDefaults } from './cameraAvStreamDefaults.js';
import { Camera } from '../../types/index.js';

/**
 * Matter 1.5 Camera device type (0x0142) exposed as a bridged endpoint.
 * Video-only AV + custom WebRTC provider (go2rtc).
 */
export const BridgedCameraDevice = CameraDevice.with(
    BridgedDeviceBasicInformationServer,
    MatterCameraAvStreamManagementServer,
    MatterWebRtcTransportProviderServer,
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
            uniqueId: `${camera.id}-uid`,
            hardwareVersion: 1,
            hardwareVersionString: '1.0',
            softwareVersion: 1,
            softwareVersionString: '1.0.0',
        },
        cameraAvStreamManagement: cameraAvStreamDefaults(),
    };
}
