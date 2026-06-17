import { ZoneManagement } from '@matter/types/clusters/zone-management';

const Zm = ZoneManagement;

/** Must match CameraAvStreamManagement.videoSensorParams. */
export const SENSOR_WIDTH = 1920;
export const SENSOR_HEIGHT = 1080;

/** Manufacturer motion zone covering the full viewport. */
export const DEFAULT_MOTION_ZONE_ID = 1;

export function zoneManagementDefaults(): Partial<ZoneManagement.Attributes> {
    const fullFrameZone = new Zm.ZoneInformation({
        zoneId: DEFAULT_MOTION_ZONE_ID,
        zoneType: Zm.ZoneType.TwoDcartZone,
        zoneSource: Zm.ZoneSource.Mfg,
        twoDCartesianZone: new Zm.TwoDCartesianZone({
            name: 'Motion',
            use: Zm.ZoneUse.Motion,
            color: '#FF660080',
            vertices: [
                new Zm.TwoDCartesianVertex({ x: 0, y: 0 }),
                new Zm.TwoDCartesianVertex({ x: SENSOR_WIDTH - 1, y: 0 }),
                new Zm.TwoDCartesianVertex({ x: SENSOR_WIDTH - 1, y: SENSOR_HEIGHT - 1 }),
                new Zm.TwoDCartesianVertex({ x: 0, y: SENSOR_HEIGHT - 1 }),
            ],
        }),
    });

    return {
        maxZones: 6,
        maxUserDefinedZones: 5,
        zones: [fullFrameZone],
        triggers: [
            new Zm.ZoneTriggerControl({
                zoneId: DEFAULT_MOTION_ZONE_ID,
                initialDuration: 10,
                augmentationDuration: 5,
                maxDuration: 120,
                blindDuration: 30,
                sensitivity: 3,
            }),
        ],
        sensitivityMax: 10,
        twoDCartesianMax: new Zm.TwoDCartesianVertex({
            x: SENSOR_WIDTH - 1,
            y: SENSOR_HEIGHT - 1,
        }),
    };
}
