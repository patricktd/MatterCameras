import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Camera } from '../types/index.js';
import { DB_FILE } from '../config/paths.js';
import fs from 'fs';
import path from 'path';

type Data = {
    cameras: Camera[];
};

const defaultData: Data = { cameras: [] };

export class StorageService {
    private db: Low<Data>;

    constructor() {
        // Ensure data directory exists
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const adapter = new JSONFile<Data>(DB_FILE);
        this.db = new Low(adapter, defaultData);
    }

    async init() {
        await this.db.read();
        this.db.data ||= defaultData; // Default if file is empty
        await this.db.write();
    }

    getCameras(): Camera[] {
        return this.db.data.cameras;
    }

    async addCamera(camera: Camera): Promise<void> {
        this.db.data.cameras.push(camera);
        await this.db.write();
    }

    async removeCamera(id: string): Promise<void> {
        this.db.data.cameras = this.db.data.cameras.filter(c => c.id !== id);
        await this.db.write();
    }

    getCamera(id: string): Camera | undefined {
        return this.db.data.cameras.find(c => c.id === id);
    }

    async updateCamera(id: string, updates: Partial<Omit<Camera, 'id'>>): Promise<Camera | undefined> {
        const camera = this.db.data.cameras.find(c => c.id === id);
        if (!camera) return undefined;

        if (updates.name !== undefined) camera.name = updates.name;
        if (updates.rtspUrl !== undefined) camera.rtspUrl = updates.rtspUrl;
        if (updates.codec !== undefined) camera.codec = updates.codec || undefined;
        if (updates.onvifUrl !== undefined) camera.onvifUrl = updates.onvifUrl;
        if (updates.username !== undefined) camera.username = updates.username;
        if (updates.password !== undefined) camera.password = updates.password;

        await this.db.write();
        return camera;
    }
}

export const storage = new StorageService();
