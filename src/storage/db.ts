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
}

export const storage = new StorageService();
