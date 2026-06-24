import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import fs from 'fs';
import path from 'path';
import { SETTINGS_FILE } from '../config/paths.js';

export interface ProtectControllerSettings {
    host: string;
    username: string;
    password: string;
}

export interface AppSettings {
    protectController?: ProtectControllerSettings;
}

type SettingsData = { settings: AppSettings };

const defaultData: SettingsData = { settings: {} };

export interface ProtectControllerPublic {
    host: string;
    username: string;
    hasPassword: boolean;
}

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

    getProtectController(): ProtectControllerSettings | undefined {
        const cfg = this.db.data?.settings.protectController;
        if (!cfg?.host || !cfg.username) return undefined;
        return { ...cfg };
    }

    getProtectControllerPublic(): ProtectControllerPublic | undefined {
        const cfg = this.getProtectController();
        if (!cfg) return undefined;
        return {
            host: cfg.host,
            username: cfg.username,
            hasPassword: Boolean(cfg.password),
        };
    }

    async setProtectController(cfg: ProtectControllerSettings): Promise<void> {
        const host = cfg.host.trim();
        const username = cfg.username.trim();
        if (!host || !username) {
            throw new Error('host and username are required');
        }
        this.db.data!.settings.protectController = {
            host,
            username,
            password: cfg.password,
        };
        await this.db.write();
    }

    async clearProtectController(): Promise<void> {
        delete this.db.data!.settings.protectController;
        await this.db.write();
    }
}

export const settings = new SettingsService();
