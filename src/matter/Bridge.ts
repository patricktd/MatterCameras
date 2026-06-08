import './env.js';

import { ServerNode } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { Endpoint } from '@matter/node';
import { DeviceTypeId, VendorId } from '@matter/types';
import { appConfig } from '../config/app.js';
import { Camera } from '../types/index.js';
import { Go2RTCClient } from '../streaming/Go2RTCClient.js';
import { streamContext } from './behaviors/streamContext.js';
import { BridgedCameraDevice, bridgedCameraOptions } from './devices/BridgedCameraDevice.js';

/** Matter Aggregator (bridge) device type — must match mDNS commissioning advert. */
const BRIDGE_DEVICE_TYPE = DeviceTypeId(0x0e);

export class MatterBridge {
    private server?: ServerNode;
    private aggregator?: Endpoint;
    private readonly cameraEndpoints = new Map<string, Endpoint>();
    private started = false;
    readonly go2rtc: Go2RTCClient;

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
                // Bind all interfaces; mDNS uses MATTER_NETWORK_INTERFACE_* to pick LAN IP
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
        this.started = true;
        console.log(`Matter Bridge online at ${appConfig.matterHost}:${appConfig.matterPort}`);
    }

    #restoreCamerasFromStorage() {
        if (!this.aggregator) return;

        for (const child of this.aggregator.parts) {
            const id = String(child.id);
            if (id.startsWith('cam-')) {
                this.cameraEndpoints.set(id, child);
                console.log(`Restored bridged camera from storage: ${id}`);
            }
        }
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

    async removeCamera(id: string) {
        const endpoint = this.cameraEndpoints.get(id);
        if (!endpoint) {
            console.warn(`Camera ${id} not found on bridge`);
            return;
        }
        console.log(`Removing bridged camera: ${id}`);
        await endpoint.delete();
        this.cameraEndpoints.delete(id);
    }

    async factoryReset() {
        if (!this.server) return;
        console.log('Initiating Matter factory reset...');
        await this.server.erase();
        console.log('Factory reset complete. Restarting...');
        process.exit(0);
    }
}

export const bridge = new MatterBridge();
