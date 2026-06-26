import { DimmableLightDevice } from '@matter/main/devices/dimmable-light';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import type { Camera } from '../../types/index.js';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../../config/version.js';
import { reolinkLightEndpointId, reolinkLightLabel } from '../reolinkLightConfig.js';
import { reolinkBrightToMatterLevel } from '../reolinkLightLevels.js';
import { MatterReolinkLightOnOffServer } from '../behaviors/MatterReolinkLightOnOffServer.js';
import { MatterReolinkLightLevelControlServer } from '../behaviors/MatterReolinkLightLevelControlServer.js';
import { bridgedUniqueId } from '../bridgedUniqueId.js';

export const BridgedReolinkLightDevice = DimmableLightDevice.with(
    BridgedDeviceBasicInformationServer,
    MatterReolinkLightOnOffServer,
    MatterReolinkLightLevelControlServer,
);

export function bridgedReolinkLightOptions(camera: Camera) {
    const id = reolinkLightEndpointId(camera.id);
    const name = reolinkLightLabel(camera);

    return {
        id,
        bridgedDeviceBasicInformation: {
            nodeLabel: name,
            reachable: true,
            vendorName: 'MatterCameras',
            productName: 'Light',
            serialNumber: id,
            uniqueId: bridgedUniqueId(id, camera.matterBindEpoch),
            hardwareVersion: 1,
            hardwareVersionString: '1.0',
            softwareVersion: getMatterSoftwareVersion(),
            softwareVersionString: getMatterSoftwareVersionString(),
        },
        onOff: {
            onOff: false,
        },
        levelControl: {
            currentLevel: reolinkBrightToMatterLevel(100),
            minLevel: 1,
            maxLevel: 254,
        },
    };
}
