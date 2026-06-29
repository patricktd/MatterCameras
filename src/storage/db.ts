import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Camera } from '../types/index.js';
import { DB_FILE } from '../config/paths.js';
import { finalizeCameraMotionSettings } from '../matter/personSensorConfig.js';
import fs from 'fs';
import path from 'path';

type Data = {
    cameras: Camera[];
};

function createDefaultData(): Data {
    return { cameras: [] };
}

function cloneCamera(camera: Camera): Camera {
    return { ...camera };
}

function cloneData(data: Data): Data {
    return {
        cameras: data.cameras.map(cloneCamera),
    };
}

export class StorageService {
    private db: Low<Data>;

    constructor(dbFile: string = DB_FILE) {
        // Ensure data directory exists
        const dir = path.dirname(dbFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const adapter = new JSONFile<Data>(dbFile);
        this.db = new Low(adapter, createDefaultData());
    }

    private async reload(): Promise<void> {
        await this.db.read();
        this.db.data = cloneData(this.db.data ?? createDefaultData());
    }

    async init() {
        await this.reload();
        await this.db.write();
    }

    getCameras(): Camera[] {
        return this.db.data.cameras.map(cloneCamera);
    }

    async addCamera(camera: Camera): Promise<void> {
        await this.reload();
        this.db.data.cameras.push(cloneCamera(finalizeCameraMotionSettings(camera)));
        await this.db.write();
    }

    async removeCamera(id: string): Promise<void> {
        await this.reload();
        this.db.data.cameras = this.db.data.cameras.filter(c => c.id !== id);
        await this.db.write();
    }

    getCamera(id: string): Camera | undefined {
        const camera = this.db.data.cameras.find(c => c.id === id);
        return camera ? cloneCamera(camera) : undefined;
    }

    async updateCamera(id: string, updates: Partial<Omit<Camera, 'id'>>): Promise<Camera | undefined> {
        await this.reload();
        const index = this.db.data.cameras.findIndex(c => c.id === id);
        if (index === -1) return undefined;

        const current = this.db.data.cameras[index];
        const camera: Camera = cloneCamera(current);

        if (updates.name !== undefined) camera.name = updates.name;
        if (updates.rtspUrl !== undefined) camera.rtspUrl = updates.rtspUrl;
        if (updates.codec !== undefined) camera.codec = updates.codec || undefined;
        if (updates.motionSource !== undefined) camera.motionSource = updates.motionSource;
        if (updates.motionObjectType !== undefined) camera.motionObjectType = updates.motionObjectType;
        if (updates.personSensorEnabled !== undefined) camera.personSensorEnabled = updates.personSensorEnabled;
        if (updates.personSensorHoldSec !== undefined) camera.personSensorHoldSec = updates.personSensorHoldSec;
        if (updates.reolinkLightEnabled !== undefined) camera.reolinkLightEnabled = updates.reolinkLightEnabled;
        if ('reolinkLightCapable' in updates) {
            if (updates.reolinkLightCapable === undefined) {
                delete camera.reolinkLightCapable;
            } else {
                camera.reolinkLightCapable = updates.reolinkLightCapable;
            }
        }
        if (updates.ptzEnabled !== undefined) camera.ptzEnabled = updates.ptzEnabled;
        if ('ptzCapable' in updates) {
            if (updates.ptzCapable === undefined) {
                delete camera.ptzCapable;
            } else {
                camera.ptzCapable = updates.ptzCapable;
            }
        }
        if (updates.ptzBackend !== undefined) camera.ptzBackend = updates.ptzBackend;
        if (updates.onvifUrl !== undefined) camera.onvifUrl = updates.onvifUrl;
        if (updates.username !== undefined) camera.username = updates.username;
        if (updates.password !== undefined) camera.password = updates.password;
        if (updates.manufacturer !== undefined) camera.manufacturer = updates.manufacturer;
        if (updates.model !== undefined) camera.model = updates.model;
        if (updates.reolinkChannel !== undefined) camera.reolinkChannel = updates.reolinkChannel;
        if (updates.reolinkHost !== undefined) camera.reolinkHost = updates.reolinkHost;
        if (updates.reolinkHttpPort !== undefined) camera.reolinkHttpPort = updates.reolinkHttpPort;
        if (updates.reolinkUseHttps !== undefined) camera.reolinkUseHttps = updates.reolinkUseHttps;
        if (updates.reolinkRtspPort !== undefined) camera.reolinkRtspPort = updates.reolinkRtspPort;
        if (updates.reolinkProtocol !== undefined) camera.reolinkProtocol = updates.reolinkProtocol;
        if (updates.reolinkStream !== undefined) camera.reolinkStream = updates.reolinkStream;
        if (updates.reolinkDeviceUid !== undefined) camera.reolinkDeviceUid = updates.reolinkDeviceUid;
        if (updates.reolinkIsNvr !== undefined) camera.reolinkIsNvr = updates.reolinkIsNvr;
        if (updates.protectHost !== undefined) camera.protectHost = updates.protectHost;
        if (updates.protectCameraId !== undefined) camera.protectCameraId = updates.protectCameraId;
        if (updates.addSource !== undefined) camera.addSource = updates.addSource;

        const normalized = finalizeCameraMotionSettings(camera);
        this.db.data.cameras[index] = normalized;

        await this.db.write();
        return cloneCamera(normalized);
    }
}

export const storage = new StorageService();
