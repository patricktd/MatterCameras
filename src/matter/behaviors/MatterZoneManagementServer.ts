import { CameraRequirements } from '@matter/main/devices/camera';
import { Logger } from '@matter/general';
import { ZoneManagement } from '@matter/types/clusters/zone-management';
import { StatusResponseError } from '@matter/types/common';
import { Status } from '@matter/types';
import { streamContext } from './streamContext.js';
import { DEFAULT_MOTION_ZONE_ID } from '../devices/zoneManagementDefaults.js';
import { OccupancySensing } from '@matter/types/clusters/occupancy-sensing';
import { MatterOccupancySensingServer } from './MatterOccupancySensingServer.js';

const Zm = ZoneManagement;
const logger = Logger.get('ZoneManagement');

const ZoneMgmtServer = CameraRequirements.ZoneManagementServer.with(
    'TwoDimensionalCartesianZone',
    'UserDefined',
    'PerZoneSensitivity',
);

interface TriggerRuntime {
    control: ZoneManagement.ZoneTriggerControl;
    triggered: boolean;
    blindUntil: number;
    triggerStartedAt: number;
    extendedUntil: number;
    stopTimer?: ReturnType<typeof setTimeout>;
    maxTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Matter 1.5 Zone Management — ZoneTriggered events + OccupancySensing for SmartThings
 * motionSensor routines (matter-switch maps occupancy, not zone events, to automations).
 * Motion source: generic RTSP frame-diff via MotionDetectionService (not vendor-specific).
 */
export class MatterZoneManagementServer extends ZoneMgmtServer {
    static override readonly id = 'zoneManagement';

    #nextUserZoneId = 10;
    #runtime = new Map<number, TriggerRuntime>();

    override initialize(): void {
        const cameraId = String(this.endpoint.id);
        this.#syncRuntimeFromState();

        streamContext.reportMotionActivity.set(cameraId, active => this.#onMotionActivity(active));
        streamContext.reportMotionPulse.set(cameraId, () => this.#onMotionPulseContinued());

        this.#applyMotionSensitivity(cameraId, DEFAULT_MOTION_ZONE_ID);

        const msg = `ZoneManagement ready camera=${cameraId} zones=${this.state.zones?.length ?? 0}`;
        logger.info(msg);
        console.log(msg);
    }

    override async [Symbol.asyncDispose](): Promise<void> {
        const cameraId = String(this.endpoint.id);
        streamContext.reportMotionActivity.delete(cameraId);
        streamContext.reportMotionPulse.delete(cameraId);
        streamContext.motionSensitivity.delete(cameraId);
        for (const rt of this.#runtime.values()) {
            this.#clearTimers(rt);
        }
        this.#runtime.clear();
    }

    override async createOrUpdateTrigger(request: ZoneManagement.CreateOrUpdateTriggerRequest): Promise<void> {
        const trigger = request.trigger;
        const zones = this.state.zones ?? [];
        if (!zones.some(z => z.zoneId === trigger.zoneId)) {
            throw new StatusResponseError(`Unknown zone ${trigger.zoneId}`, Status.Failure);
        }

        const triggers = [...(this.state.triggers ?? [])];
        const idx = triggers.findIndex(t => t.zoneId === trigger.zoneId);
        if (idx >= 0) {
            triggers[idx] = trigger;
        } else {
            triggers.push(trigger);
        }
        this.state.triggers = triggers;
        this.#syncRuntimeFromState();
        this.#applyMotionSensitivity(String(this.endpoint.id), trigger.zoneId);
        logger.info(`Trigger updated camera=${this.endpoint.id} zone=${trigger.zoneId} sensitivity=${trigger.sensitivity ?? 'default'}`);
    }

    override async removeTrigger(request: ZoneManagement.RemoveTriggerRequest): Promise<void> {
        this.state.triggers = (this.state.triggers ?? []).filter(t => t.zoneId !== request.zoneId);
        const rt = this.#runtime.get(request.zoneId);
        if (rt) {
            this.#clearTimers(rt);
            this.#runtime.delete(request.zoneId);
        }
    }

    override async createTwoDCartesianZone(
        request: ZoneManagement.CreateTwoDCartesianZoneRequest,
    ): Promise<ZoneManagement.CreateTwoDCartesianZoneResponse> {
        const zones = this.state.zones ?? [];
        if (zones.length >= (this.state.maxZones ?? 1)) {
            throw new StatusResponseError('Max zones reached', Status.ResourceExhausted);
        }

        const zoneId = this.#nextUserZoneId++;
        const entry = new Zm.ZoneInformation({
            zoneId,
            zoneType: Zm.ZoneType.TwoDcartZone,
            zoneSource: Zm.ZoneSource.User,
            twoDCartesianZone: request.zone,
        });
        this.state.zones = [...zones, entry];
        logger.info(`User zone created camera=${this.endpoint.id} zone=${zoneId} name=${request.zone.name}`);
        return new Zm.CreateTwoDCartesianZoneResponse({ zoneId });
    }

    override async updateTwoDCartesianZone(request: ZoneManagement.UpdateTwoDCartesianZoneRequest): Promise<void> {
        const zones = this.state.zones ?? [];
        const idx = zones.findIndex(z => z.zoneId === request.zoneId);
        if (idx < 0) {
            throw new StatusResponseError(`Zone ${request.zoneId} not found`, Status.NotFound);
        }
        if (zones[idx].zoneSource !== Zm.ZoneSource.User) {
            throw new StatusResponseError('Manufacturer zones cannot be modified', Status.Failure);
        }
        const updated = [...zones];
        updated[idx] = new Zm.ZoneInformation({
            ...updated[idx],
            twoDCartesianZone: request.zone,
        });
        this.state.zones = updated;
    }

    override async removeZone(request: ZoneManagement.RemoveZoneRequest): Promise<void> {
        const zones = this.state.zones ?? [];
        const zone = zones.find(z => z.zoneId === request.zoneId);
        if (!zone) {
            throw new StatusResponseError(`Zone ${request.zoneId} not found`, Status.NotFound);
        }
        if (zone.zoneSource !== Zm.ZoneSource.User) {
            throw new StatusResponseError('Manufacturer zones cannot be removed', Status.Failure);
        }
        this.state.zones = zones.filter(z => z.zoneId !== request.zoneId);
        await this.removeTrigger(new Zm.RemoveTriggerRequest({ zoneId: request.zoneId }));
    }

    #syncRuntimeFromState(): void {
        for (const trigger of this.state.triggers ?? []) {
            if (!this.#runtime.has(trigger.zoneId)) {
                this.#runtime.set(trigger.zoneId, {
                    control: trigger,
                    triggered: false,
                    blindUntil: 0,
                    triggerStartedAt: 0,
                    extendedUntil: 0,
                });
            } else {
                this.#runtime.get(trigger.zoneId)!.control = trigger;
            }
        }
    }

    #onMotionActivity(active: boolean): void {
        const now = Date.now();
        const rt = this.#runtime.get(DEFAULT_MOTION_ZONE_ID);
        if (!rt || now < rt.blindUntil) {
            return;
        }

        if (active) {
            this.#onMotionPulse(DEFAULT_MOTION_ZONE_ID, rt, now);
        } else if (rt.triggered && now >= rt.extendedUntil) {
            this.#emitStopped(DEFAULT_MOTION_ZONE_ID, rt, Zm.ZoneEventStoppedReason.ActionStopped);
        }
    }

    #onMotionPulseContinued(): void {
        const rt = this.#runtime.get(DEFAULT_MOTION_ZONE_ID);
        if (!rt?.triggered) return;
        this.#onMotionPulse(DEFAULT_MOTION_ZONE_ID, rt, Date.now());
    }

    #onMotionPulse(zoneId: number, rt: TriggerRuntime, now: number): void {
        if (!rt.triggered) {
            rt.triggered = true;
            rt.triggerStartedAt = now;
            rt.extendedUntil = now + rt.control.initialDuration * 1_000;
            this.#emitTriggered(zoneId);
            this.#armMaxTimer(zoneId, rt);
        } else if (now >= rt.extendedUntil) {
            rt.extendedUntil = now + rt.control.augmentationDuration * 1_000;
        } else {
            rt.extendedUntil = now + rt.control.augmentationDuration * 1_000;
        }

        this.#armStopTimer(zoneId, rt);
    }

    #armStopTimer(zoneId: number, rt: TriggerRuntime): void {
        if (rt.stopTimer) clearTimeout(rt.stopTimer);
        const delay = Math.max(1_000, rt.extendedUntil - Date.now());
        rt.stopTimer = setTimeout(() => {
            if (rt.triggered && Date.now() >= rt.extendedUntil) {
                this.#emitStopped(zoneId, rt, Zm.ZoneEventStoppedReason.ActionStopped);
            }
        }, delay);
    }

    #armMaxTimer(zoneId: number, rt: TriggerRuntime): void {
        if (rt.maxTimer) return;
        rt.maxTimer = setTimeout(() => {
            if (rt.triggered) {
                this.#emitStopped(zoneId, rt, Zm.ZoneEventStoppedReason.Timeout);
            }
        }, rt.control.maxDuration * 1_000);
    }

    #emitTriggered(zoneId: number): void {
        const msg = `ZoneTriggered camera=${this.endpoint.id} zone=${zoneId}`;
        logger.info(msg);
        console.log(msg);
        this.#setOccupancy(true);
        this.events.zoneTriggered.emit(
            new Zm.ZoneTriggeredEvent({
                zone: zoneId,
                reason: Zm.ZoneEventTriggeredReason.Motion,
            }),
            this.context,
        );
    }

    #emitStopped(zoneId: number, rt: TriggerRuntime, reason: ZoneManagement.ZoneEventStoppedReason): void {
        if (!rt.triggered) return;

        const msg = `ZoneStopped camera=${this.endpoint.id} zone=${zoneId} reason=${reason}`;
        logger.info(msg);
        console.log(msg);
        this.#setOccupancy(false);
        rt.triggered = false;
        rt.blindUntil = Date.now() + rt.control.blindDuration * 1_000;
        this.#clearTimers(rt);

        this.events.zoneStopped.emit(
            new Zm.ZoneStoppedEvent({ zone: zoneId, reason }),
            this.context,
        );
    }

    #applyMotionSensitivity(cameraId: string, zoneId: number): void {
        if (zoneId !== DEFAULT_MOTION_ZONE_ID) return;
        const trigger = (this.state.triggers ?? []).find(t => t.zoneId === zoneId);
        if (!trigger) return;
        streamContext.motionSensitivity.set(cameraId, {
            level: trigger.sensitivity ?? 3,
            max: this.state.sensitivityMax ?? 10,
        });
        streamContext.refreshMotionSensitivity?.(cameraId);
    }

    #setOccupancy(occupied: boolean): void {
        const msg = `Occupancy camera=${this.endpoint.id} occupied=${occupied}`;
        logger.info(msg);
        void this.endpoint.setStateOf(MatterOccupancySensingServer, {
            occupancy: new OccupancySensing.Occupancy({ occupied }),
        }).catch(() => undefined);
    }

    #clearTimers(rt: TriggerRuntime): void {
        if (rt.stopTimer) {
            clearTimeout(rt.stopTimer);
            rt.stopTimer = undefined;
        }
        if (rt.maxTimer) {
            clearTimeout(rt.maxTimer);
            rt.maxTimer = undefined;
        }
    }
}
