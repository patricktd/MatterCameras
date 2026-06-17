import { readFileSync, existsSync } from 'fs';
import { CONFIG_FILE } from './paths.js';

export interface AppConfig {
    /** LAN IP advertised to go2rtc / docs */
    matterHost: string;
    /** IPv4 bind address for Matter UDP/TCP (0.0.0.0 = all interfaces) */
    matterBindHost: string;
    matterPort: number;
    webPort: number;
    go2rtcUrl: string;
    commissioning: {
        passcode: number;
        discriminator: number;
    };
    vendor: {
        vendorId: number;
        vendorName: string;
        productId: number;
        productName: string;
    };
}

/** Fallback when no config file / MATTER_HOST; run scripts/setup.sh for a real LAN IP. */
const DEFAULT_HOST = '127.0.0.1';

const defaults: AppConfig = {
    matterHost: process.env.MATTER_HOST ?? DEFAULT_HOST,
    matterBindHost: process.env.MATTER_BIND_HOST ?? '0.0.0.0',
    matterPort: Number(process.env.MATTER_PORT ?? 5550),
    webPort: Number(process.env.WEB_PORT ?? 3202),
    go2rtcUrl: process.env.GO2RTC_URL ?? 'http://127.0.0.1:3203',
    commissioning: {
        passcode: Number(process.env.MATTER_PASSCODE ?? 20202021),
        discriminator: Number(process.env.MATTER_DISCRIMINATOR ?? 3840),
    },
    vendor: {
        vendorId: Number(process.env.MATTER_VENDOR_ID ?? 0xfff1),
        vendorName: 'MatterCameras',
        productId: Number(process.env.MATTER_PRODUCT_ID ?? 0x8000),
        productName: 'MatterCameras Bridge',
    },
};

function loadFileConfig(): Partial<AppConfig> {
    if (!existsSync(CONFIG_FILE)) return {};
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<AppConfig>;
    } catch {
        console.warn(`Failed to parse ${CONFIG_FILE}, using defaults`);
        return {};
    }
}

export const appConfig: AppConfig = {
    ...defaults,
    ...loadFileConfig(),
    commissioning: { ...defaults.commissioning, ...loadFileConfig().commissioning },
    vendor: { ...defaults.vendor, ...loadFileConfig().vendor },
};
