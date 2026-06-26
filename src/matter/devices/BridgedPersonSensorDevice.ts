import { OccupancySensorDevice } from '@matter/main/devices/occupancy-sensor';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { OccupancySensingServer } from '@matter/node/behaviors/occupancy-sensing';
import { occupancySensingDefaults } from './occupancySensingDefaults.js';
import type { Camera } from '../../types/index.js';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../../config/version.js';
import { personSensorEndpointId, personSensorLabel } from '../personSensorConfig.js';
import { bridgedUniqueId } from '../bridgedUniqueId.js';

export const BridgedPersonSensorDevice = OccupancySensorDevice.with(
    BridgedDeviceBasicInformationServer,
    OccupancySensingServer.with('PassiveInfrared'),
);

export function bridgedPersonSensorOptions(camera: Camera) {
    const id = personSensorEndpointId(camera.id);
    const name = personSensorLabel(camera);

    return {
        id,
        bridgedDeviceBasicInformation: {
            nodeLabel: name,
            reachable: true,
            vendorName: 'MatterCameras',
            productName: 'Presence Sensor',
            serialNumber: id,
            uniqueId: bridgedUniqueId(id, camera.matterBindEpoch),
            hardwareVersion: 1,
            hardwareVersionString: '1.0',
            softwareVersion: getMatterSoftwareVersion(),
            softwareVersionString: getMatterSoftwareVersionString(),
        },
        occupancySensing: occupancySensingDefaults(),
    };
}