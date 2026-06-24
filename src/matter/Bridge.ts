import './env.js';

import { ServerNode } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { Endpoint } from '@matter/node';
import { DeviceTypeId, VendorId } from '@matter/types';
import { appConfig } from '../config/app.js';
import { Camera } from '../types/index.js';
import { Go2RTCClient } from '../streaming/Go2RTCClient.js';
import { MotionDetectionService } from '../streaming/MotionDetectionService.js';
import { streamContext } from './behaviors/streamContext.js';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { BridgedCameraDevice, bridgedCameraOptions } from './devices/BridgedCameraDevice.js';
import { BasicInformationServer } from '@matter/main/behaviors/basic-information';
import { DescriptorServer } from '@matter/main/behaviors/descriptor';
import { getMatterSoftwareVersion, getMatterSoftwareVersionString } from '../config/version.js';
import { getMatterStoragePath, wipeMatterStorage } from './matterStorage.js';
import { EndpointNumber } from '@matter/types';

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
        const msg = `Bridge structure: ${this.cameraEndpoints.size} camera(s), `
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
            if (id.startsWith('cam-') && !isLegacySlotEndpointId(id)) {
                this.cameraEndpoints.set(id, child);
                console.log(`Restored bridged camera from storage: ${id}`);
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

    async addCamera(camera: Camera) {
        if (!this.aggregator) return;

        if (this.cameraEndpoints.has(camera.id)) {
            console.warn(`Camera ${camera.id} already bridged`);
            return;
        }

        const existing = this.aggregator.parts.get(camera.id);
        if (existing) {
            this.cameraEndpoints.set(camera.id, existing);
            console.log(`Camera ${camera.name} (${camera.id}) already on aggregator`);
            return;
        }

        console.log(`Adding bridged camera: ${camera.name} (${camera.id})`);
        const endpoint = await this.aggregator.add(
            BridgedCameraDevice,
            bridgedCameraOptions(camera),
        );
        this.cameraEndpoints.set(camera.id, endpoint);

        if (this.started) {
            await this.notifyHubStructureChange();
        }
    }

    async getPairingInfo() {
        if (!this.server) return { qrCode: '', manualPairingCode: '' };

        const { commissioning } = this.server.state;
        if (!commissioning.commissioned) {
            const { manualPairingCode, qrPairingCode } = commissioning.pairingCodes;
            return { qrCode: qrPairingCode, manualPairingCode };
        }
        return { qrCode: '', manualPairingCode: '' };
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
    }

    /** Start motion detection — call only after go2rtc stream is registered for this camera. */
    startMotionDetection(camera: Camera): void {
        this.motionDetection.startCamera(camera, this.go2rtc);
    }

    async removeCamera(id: string) {
        const endpoint = this.cameraEndpoints.get(id);
        if (!endpoint) {
            console.warn(`Camera ${id} not found on bridge`);
            return;
        }
        console.log(`Removing bridged camera: ${id}`);
        this.motionDetection.stopCamera(id);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);

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
}

export const bridge = new MatterBridge();
