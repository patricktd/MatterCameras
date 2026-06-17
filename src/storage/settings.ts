import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import fs from 'fs';
import path from 'path';
import { SETTINGS_FILE } from '../config/paths.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppSettings {}

type SettingsData = { settings: AppSettings };

const defaultData: SettingsData = { settings: {} };

export class SettingsService {
    private db: Low<SettingsData>;

    constructor() {
        const dir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Low(new JSONFile<SettingsData>(SETTINGS_FILE), defaultData);
    }

    async init(): Promise<void> {
        await this.db.read();
        this.db.data ||= defaultData;
        this.db.data.settings ??= {};
        await this.db.write();
    }

    getSettings(): AppSettings {
        return { ...this.db.data!.settings };
    }
}

export const settings = new SettingsService();
