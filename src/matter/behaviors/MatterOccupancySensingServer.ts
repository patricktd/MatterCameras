import { CameraRequirements } from '@matter/main/devices/camera';
import { Logger } from '@matter/general';
import { OccupancySensing } from '@matter/types/clusters/occupancy-sensing';

const Os = OccupancySensing;
const logger = Logger.get('OccupancySensing');

/** OccupancyEvent makes matter.js emit OccupancyChanged when `occupancy` flips. */
const OccServer = CameraRequirements.OccupancySensingServer.with('PassiveInfrared', 'OccupancyEvent');

/**
 * SmartThings routine "Motion detected" maps to OccupancySensing.occupied on Matter cameras.
 * Updated from Zone Management trigger state (not raw frame-diff pulses).
 */
export class MatterOccupancySensingServer extends OccServer {
    static override readonly id = 'occupancySensing';

    setOccupied(occupied: boolean): void {
        this.state.occupancy = new Os.Occupancy({ occupied });
        logger.info(`Occupancy camera=${this.endpoint.id} occupied=${occupied}`);
    }
}
