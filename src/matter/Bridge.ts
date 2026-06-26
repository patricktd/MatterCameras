import './env.js';

import { ServerNode } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { Endpoint } from '@matter/node';
import { DeviceTypeId, VendorId } from '@matter/types';
import { appConfig } from '../config/app.js';
import { Camera } from '../types/index.js';
import { Go2RTCClient } from '../streaming/Go2RTCClient.js';
import { MotionDetectionService } from '../streaming/MotionDetectionService.js';
import { ReolinkLightService } from '../streaming/ReolinkLightService.js';
import { streamContext } from './behaviors/streamContext.js';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { BridgedCameraDevice, bridgedCameraOptions } from './devices/BridgedCameraDevice.js';
import { BridgedPersonSensorDevice, bridgedPersonSensorOptions } from './devices/BridgedPersonSensorDevice.js';
import { BridgedReolinkLightDevice, bridgedReolinkLightOptions } from './devices/BridgedReolinkLightDevice.js';
import { BasicInformationServer } from '@matter/main/behaviors/basic-information';
import { DescriptorServer } from '@matter/main/behaviors/descriptor';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../config/version.js';
import { getMatterStoragePath, wipeMatterStorage } from './matterStorage.js';
import { EndpointNumber } from '@matter/types';
import {
    buildCameraMotionCamera,
    buildPersonSensorMotionCamera,
    countBridgedEndpoints,
    isPersonSensorEndpointId,
    personSensorLabel,
    shouldExposePersonSensor,
} from './personSensorConfig.js';
import {
    isReolinkLightEndpointId,
    reolinkLightEndpointId,
    reolinkLightLabel,
    shouldExposeReolinkLight,
} from './reolinkLightConfig.js';
import { OccupancySensing } from '@matter/types/clusters/occupancy-sensing';
import { OccupancySensingServer } from '@matter/node/behaviors/occupancy-sensing';
import { OnOffServer } from '@matter/node/behaviors/on-off';
import { LevelControlServer } from '@matter/node/behaviors/level-control';
import { CommissioningServer } from '@matter/node/behaviors/system/commissioning';
import { randomInt } from 'node:crypto';
import type { PairingInfo } from '../types/index.js';

/** Matter Aggregator (bridge) device type — must match mDNS commissioning advert. */
const BRIDGE_DEVICE_TYPE = DeviceTypeId(0x0e);

/** Legacy placeholder ids from an abandoned slot-pool experiment — must not stay on the bridge. */
function isLegacySlotEndpointId(id: string): boolean {
    return /^cam-slot-\d{2}$/.test(id);
}

export class MatterBridge {
    private server?: ServerNode;
    private aggregator?: Endpoint;
    private readonly cameraEndpoints = new Map<string, Endpoint>();
    private started = false;
    readonly go2rtc: Go2RTCClient;
    readonly motionDetection = new MotionDetectionService();
    readonly reolinkLight = new ReolinkLightService();

    constructor() {
        this.go2rtc = new Go2RTCClient(appConfig.go2rtcUrl);
        streamContext.go2rtc = this.go2rtc;
    }

    async init() {
        console.log('Initializing Matter Bridge (matter.js 0.17 / Matter 1.5)...');

        this.server = await ServerNode.create({
            id: 'matter-cameras-bridge',
            basicInformation: {
                vendorId: VendorId(appConfig.vendor.vendorId),
                vendorName: appConfig.vendor.vendorName,
                productId: appConfig.vendor.productId,
                productName: appConfig.vendor.productName,
                serialNumber: 'MC-BRIDGE-001',
                uniqueId: 'MatterCameras-Bridge',
            },
            network: {
                port: appConfig.matterPort,
                listeningAddressIpv4: appConfig.matterBindHost,
                tcp: { incoming: true, outgoing: true },
            },
            commissioning: {
                passcode: appConfig.commissioning.passcode,
                discriminator: appConfig.commissioning.discriminator,
            },
            productDescription: {
                name: appConfig.vendor.productName,
                deviceType: BRIDGE_DEVICE_TYPE,
                vendorId: VendorId(appConfig.vendor.vendorId),
                productId: appConfig.vendor.productId,
            },
        });

        this.aggregator = await this.server.add(AggregatorEndpoint, { id: 'bridge' });
        this.#restoreCamerasFromStorage();
    }

    /** Start Matter networking after all bridged endpoints are registered. */
    async start() {
        if (!this.server) throw new Error('Bridge not initialized');
        if (this.started) return;

        await this.server.start();
        await this.#purgeLegacyPlaceholderEndpoints();
        this.started = true;
        await this.#announceStructureToHub();
        console.log(`Matter Bridge online at ${appConfig.matterHost}:${appConfig.matterPort}`);
    }

    /** Bump softwareVersion + re-report PartsList so hubs re-discover bridged cameras. */
    async notifyHubStructureChange() {
        await this.#announceStructureToHub();
    }

    async #announceStructureToHub() {
        if (!this.server || !this.aggregator) return;

        const version = getMatterSoftwareVersion();
        const versionString = getMatterSoftwareVersionString();
        const versionState = { softwareVersion: version, softwareVersionString: versionString };

        try {
            await this.server.setStateOf(BasicInformationServer, versionState);
            for (const endpoint of this.cameraEndpoints.values()) {
                await endpoint.setStateOf(BridgedDeviceBasicInformationServer, versionState);
            }

            await this.aggregator.setStateOf(DescriptorServer, {
                partsList: this.#aggregatorPartNumbers(),
            });
        } catch (error) {
            console.warn(`Bridge structure announce failed: ${error}`);
        }

        const partNumbers = this.#aggregatorPartNumbers();
        const msg = `Bridge structure: ${this.cameraEndpoints.size} bridged endpoint(s), `
            + `softwareVersion=${version}, Matter endpoints=[${partNumbers.join(', ')}]`;
        console.log(msg);
    }

    #aggregatorPartNumbers(): EndpointNumber[] {
        if (!this.aggregator) return [];
        return [...this.aggregator.parts]
            .map(part => (part.lifecycle.hasNumber ? part.number : undefined))
            .filter(n => n !== undefined)
            .sort((a, b) => Number(a) - Number(b)) as EndpointNumber[];
    }

    async #purgeLegacyPlaceholderEndpoints() {
        if (!this.aggregator) return;

        const placeholders = [...this.aggregator.parts]
            .filter(part => isLegacySlotEndpointId(String(part.id)));

        for (const endpoint of placeholders) {
            console.log(`Removing legacy placeholder endpoint: ${endpoint.id}`);
            await endpoint.delete();
        }

        if (placeholders.length > 0) {
            console.log(`Purged ${placeholders.length} unused cam-slot placeholder(s) from Matter storage`);
        }
    }

    #restoreCamerasFromStorage() {
        if (!this.aggregator) return;

        for (const child of this.aggregator.parts) {
            const id = String(child.id);
            if ((id.startsWith('cam-') || isPersonSensorEndpointId(id) || isReolinkLightEndpointId(id))
                && !isLegacySlotEndpointId(id)) {
                this.cameraEndpoints.set(id, child);
                console.log(`Restored bridged endpoint from storage: ${id}`);
            }
        }
    }

    /** Matter endpoints on the aggregator that are not in cameras.json (hub may still show them). */
    listOrphanBridgedCameraIds(knownIds: Set<string>): string[] {
        const orphans: string[] = [];
        for (const id of this.cameraEndpoints.keys()) {
            if (!knownIds.has(id)) {
                orphans.push(id);
            }
        }
        return orphans;
    }

    listBridgedMatterEndpoints(): Array<{ id: string; endpointNumber?: EndpointNumber }> {
        if (!this.aggregator) return [];

        return [...this.aggregator.parts].map(part => ({
            id: String(part.id),
            endpointNumber: part.lifecycle.hasNumber ? part.number : undefined,
        }));
    }

    async addCamera(camera: Camera) {
        if (!this.aggregator) return;

        const existing = this.aggregator.parts.get(camera.id);
        if (existing) {
            this.cameraEndpoints.set(camera.id, existing);
            console.log(`Camera ${camera.name} (${camera.id}) already on aggregator`);
            if (shouldExposePersonSensor(camera)) {
                await this.#addPersonSensor(camera);
            } else {
                await this.#removePersonSensor(camera.id);
            }
            if (shouldExposeReolinkLight(camera)) {
                await this.#ensureReolinkLight(camera);
            } else {
                await this.#removeReolinkLight(camera.id);
            }
            return;
        }

        if (this.cameraEndpoints.has(camera.id)) {
            console.warn(`Camera ${camera.id} already bridged`);
            if (shouldExposePersonSensor(camera)) {
                await this.#addPersonSensor(camera);
            } else {
                await this.#removePersonSensor(camera.id);
            }
            if (shouldExposeReolinkLight(camera)) {
                await this.#ensureReolinkLight(camera);
            } else {
                await this.#removeReolinkLight(camera.id);
            }
            return;
        }

        console.log(`Adding bridged camera: ${camera.name} (${camera.id})`);
        const endpoint = await this.aggregator.add(
            BridgedCameraDevice,
            bridgedCameraOptions(camera),
        );
        this.cameraEndpoints.set(camera.id, endpoint);

        if (shouldExposePersonSensor(camera)) {
            await this.#addPersonSensor(camera);
        }
        if (shouldExposeReolinkLight(camera)) {
            await this.#ensureReolinkLight(camera);
        }

        if (this.started) {
            await this.notifyHubStructureChange();
        }
    }

    async getPairingInfo(): Promise<PairingInfo> {
        if (!this.server) return { qrCode: '', manualPairingCode: '' };

        const { commissioning } = this.server.state;
        if (!commissioning.commissioned) {
            const { manualPairingCode, qrPairingCode } = commissioning.pairingCodes;
            return { qrCode: qrPairingCode, manualPairingCode };
        }
        return { qrCode: '', manualPairingCode: '' };
    }

    /** Rotate the commissioning discriminator so SmartThings gets a new QR/manual code. */
    async refreshPairingCodes(): Promise<PairingInfo> {
        if (!this.server || this.isCommissioned()) {
            return { qrCode: '', manualPairingCode: '' };
        }

        const current = this.server.state.commissioning.discriminator;
        let discriminator = current;
        while (discriminator === current) {
            discriminator = randomInt(1, 4095);
        }

        await this.server.setStateOf(CommissioningServer, { discriminator });
        console.log(`Refreshed Matter pairing codes discriminator=${discriminator}`);

        try {
            await this.server.act(async agent => {
                const commissioning = agent.get(CommissioningServer);
                await commissioning.enterCommissionableMode();
            });
        } catch (error) {
            console.warn(`Pairing mDNS refresh failed after discriminator change: ${error}`);
        }

        return this.getPairingInfo();
    }

    isCommissioned() {
        return this.server?.state.commissioning.commissioned ?? false;
    }

    async updateCamera(camera: Camera) {
        const endpoint = this.cameraEndpoints.get(camera.id);
        if (!endpoint) {
            console.warn(`Camera ${camera.id} not found on bridge`);
            return;
        }

        console.log(`Updating bridged camera: ${camera.name} (${camera.id})`);
        await endpoint.setStateOf(BridgedDeviceBasicInformationServer, {
            nodeLabel: camera.name,
        });

        if (shouldExposePersonSensor(camera)) {
            const personEndpoint = await this.#ensurePersonSensor(camera);
            await personEndpoint.setStateOf(BridgedDeviceBasicInformationServer, {
                nodeLabel: personSensorLabel(camera),
            });
        } else {
            await this.#removePersonSensor(camera.id);
        }

        if (shouldExposeReolinkLight(camera)) {
            const lightEndpoint = await this.#ensureReolinkLight(camera);
            if (lightEndpoint) {
                await lightEndpoint.setStateOf(BridgedDeviceBasicInformationServer, {
                    nodeLabel: reolinkLightLabel(camera),
                });
            }
        } else {
            await this.#removeReolinkLight(camera.id);
        }
    }

    /** Start motion detection — call only after go2rtc stream is registered for this camera. */
    startMotionDetection(camera: Camera): void {
        this.motionDetection.startCamera(buildCameraMotionCamera(camera), this.go2rtc);
        if (shouldExposePersonSensor(camera)) {
            this.#startPersonSensorMotion(camera);
        } else {
            this.motionDetection.stopCamera(`person-${camera.id}`);
        }
        void this.#syncReolinkLightRuntime(camera);
    }

    async #syncReolinkLightRuntime(camera: Camera): Promise<void> {
        const lightId = reolinkLightEndpointId(camera.id);
        const lightEndpoint = this.cameraEndpoints.get(lightId) ?? this.aggregator?.parts.get(lightId);
        if (shouldExposeReolinkLight(camera) && lightEndpoint) {
            await this.#startReolinkLight(camera, lightEndpoint);
            return;
        }
        this.reolinkLight.stop(camera.id);
    }

    async removeCamera(id: string) {
        const endpoint = this.cameraEndpoints.get(id);
        if (!endpoint) {
            console.warn(`Camera ${id} not found on bridge`);
            return;
        }
        console.log(`Removing bridged camera: ${id}`);
        this.motionDetection.stopCamera(id);
        this.motionDetection.stopCamera(`person-${id}`);
        this.reolinkLight.stop(id);
        await this.#removePersonSensor(id);
        await this.#removeReolinkLight(id);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);

        if (this.started) {
            await this.notifyHubStructureChange();
        }
    }

    /**
     * Delete and re-create Matter bridged endpoints for a camera (same cameras.json id).
     * Bumps uniqueId so SmartThings treats the child devices as new after a stale binding.
     */
    async recycleMatterBinding(camera: Camera, bindEpoch: number): Promise<void> {
        const id = camera.id;
        const endpoint = this.cameraEndpoints.get(id) ?? this.aggregator?.parts.get(id);
        if (!endpoint) {
            console.warn(`Cannot recycle Matter binding — camera ${id} not on bridge`);
            return;
        }

        console.log(`Recycling Matter binding camera=${camera.name} (${id}) bindEpoch=${bindEpoch}`);
        this.motionDetection.stopCamera(id);
        this.motionDetection.stopCamera(`person-${id}`);
        this.reolinkLight.stop(id);
        await this.#removePersonSensor(id);
        await this.#removeReolinkLight(id);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);

        const rebound = { ...camera, matterBindEpoch: bindEpoch };
        await this.addCamera(rebound);
        this.startMotionDetection(rebound);

        if (this.started) {
            await this.notifyHubStructureChange();
        }
    }

    async factoryReset() {
        if (!this.server) return;
        console.log('Initiating Matter factory reset...');

        if (this.started) {
            try {
                await this.server.stop();
            } catch (error) {
                console.warn(`Matter bridge offline step failed: ${error}`);
            }
        }

        try {
            await this.server.close();
        } catch (error) {
            console.warn(`Matter bridge close failed: ${error}`);
        }

        const storagePath = getMatterStoragePath();
        console.log(`Removing Matter storage at ${storagePath}...`);
        await wipeMatterStorage();
        console.log('Factory reset complete. Restarting...');
        process.exit(0);
    }

    async #addPersonSensor(camera: Camera): Promise<Endpoint> {
        if (!this.aggregator) throw new Error('Bridge aggregator unavailable');

        const id = `person-${camera.id}`;
        const existing = this.cameraEndpoints.get(id) ?? this.aggregator.parts.get(id);
        if (existing) {
            this.cameraEndpoints.set(id, existing);
            return existing;
        }

        console.log(`Adding bridged person sensor: ${camera.name} (${id})`);
        const endpoint = await this.aggregator.add(
            BridgedPersonSensorDevice,
            bridgedPersonSensorOptions(camera),
        );
        this.cameraEndpoints.set(id, endpoint);
        return endpoint;
    }

    async #ensurePersonSensor(camera: Camera): Promise<Endpoint> {
        return this.#addPersonSensor(camera);
    }

    async #removePersonSensor(cameraId: string): Promise<void> {
        const id = `person-${cameraId}`;
        const endpoint = this.cameraEndpoints.get(id) ?? this.aggregator?.parts.get(id);
        if (!endpoint) return;

        console.log(`Removing bridged person sensor: ${id}`);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);
    }

    #startPersonSensorMotion(camera: Camera): void {
        const personMotionCamera = buildPersonSensorMotionCamera(camera);
        const endpoint = this.cameraEndpoints.get(personMotionCamera.id);
        if (!endpoint) return;

        this.motionDetection.startCamera(personMotionCamera, this.go2rtc, {
            onActive: active => {
                void endpoint.setStateOf(OccupancySensingServer, {
                    occupancy: new OccupancySensing.Occupancy({ occupied: active }),
                });
            },
            onPulse: () => undefined,
        });
    }

    async #ensureReolinkLight(camera: Camera): Promise<Endpoint | undefined> {
        if (!this.aggregator) throw new Error('Bridge aggregator unavailable');

        const id = reolinkLightEndpointId(camera.id);
        const existing = this.cameraEndpoints.get(id) ?? this.aggregator.parts.get(id);
        if (existing) {
            this.cameraEndpoints.set(id, existing);
            await this.#startReolinkLight(camera, existing);
            return existing;
        }

        const capable = camera.reolinkLightCapable === true
            || (camera.reolinkLightCapable === undefined
                && await this.reolinkLight.probePassiveCapability(camera));
        if (!capable) {
            console.log(`Reolink light unsupported camera=${camera.id} — skipping bridged light endpoint`);
            return undefined;
        }

        console.log(`Adding bridged Reolink light: ${camera.name} (${id})`);
        const endpoint = await this.aggregator.add(
            BridgedReolinkLightDevice,
            bridgedReolinkLightOptions(camera),
        );
        this.cameraEndpoints.set(id, endpoint);
        await this.#startReolinkLight(camera, endpoint);

        if (this.started) {
            await this.notifyHubStructureChange();
        }

        return endpoint;
    }

    async #startReolinkLight(camera: Camera, endpoint: Endpoint): Promise<void> {
        this.reolinkLight.stop(camera.id);
        const started = await this.reolinkLight.start(camera, endpoint, state => {
            void endpoint.setStateOf(OnOffServer, { onOff: state.on });
            void endpoint.setStateOf(LevelControlServer, { currentLevel: state.level });
        });
        if (!started) {
            await this.#removeReolinkLight(camera.id);
        }
    }

    async #removeReolinkLight(cameraId: string): Promise<void> {
        const id = reolinkLightEndpointId(cameraId);
        this.reolinkLight.stop(cameraId);
        const endpoint = this.cameraEndpoints.get(id) ?? this.aggregator?.parts.get(id);
        if (!endpoint) return;

        console.log(`Removing bridged Reolink light: ${id}`);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);

        if (this.started) {
            await this.notifyHubStructureChange();
        }
    }
}

export const bridge = new MatterBridge();
