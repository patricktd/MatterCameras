declare module 'onvif' {
    import type { EventEmitter } from 'node:events';

    export class Cam {
        constructor(options: {
            hostname: string;
            port?: number;
            username?: string;
            password?: string;
            path?: string;
            urn?: string;
            useSecure?: boolean;
            preserveAddress?: boolean;
            autoconnect?: boolean;
        }, callback: (err: Error | null) => void);

        connect(callback: (err: Error | null) => void): void;
        on(event: 'connect' | 'event' | 'eventsError', listener: (...args: unknown[]) => void): void;
        removeAllListeners(event?: string): void;
        unsubscribe(callback: () => void, preserveListeners?: boolean): void;
        getDeviceInformation(callback: (err: Error | null, info: Record<string, string>) => void): void;
        getStreamUri(
            options: { protocol: string },
            callback: (err: Error | null, stream: Record<string, unknown>) => void,
        ): void;
        getEventProperties(callback: (err: Error | null, props: Record<string, unknown>) => void): void;
    }

    export const Discovery: EventEmitter & {
        probe(
            options: { timeout?: number; resolve?: boolean; device?: string },
            callback: (err: Error | null | Error[], devices: unknown[]) => void,
        ): void;
    };
}
