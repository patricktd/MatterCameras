import type { Camera } from '../types/index.js';
import { FrameDiffMotionProvider } from './providers/frameDiffProvider.js';
import { OnvifMotionProvider } from './providers/onvifProvider.js';
import { ReolinkMotionProvider } from './providers/reolinkProvider.js';
import { UnifiProtectMotionProvider } from './providers/unifiProtectProvider.js';
import { resolveMotionProviderChain } from './resolveMotionProvider.js';
import type { MotionCallbacks, MotionContext, MotionProvider, MotionProviderId } from './types.js';

/** Registry of built-in motion providers. */
export class MotionProviderRegistry {
    readonly #providers = new Map<MotionProviderId, MotionProvider>();

    constructor() {
        this.register(new UnifiProtectMotionProvider());
        this.register(new ReolinkMotionProvider());
        this.register(new OnvifMotionProvider());
        this.register(new FrameDiffMotionProvider());
    }

    register(provider: MotionProvider): void {
        this.#providers.set(provider.id, provider);
    }

    get(id: MotionProviderId): MotionProvider | undefined {
        return this.#providers.get(id);
    }

    providers(): ReadonlyMap<MotionProviderId, MotionProvider> {
        return this.#providers;
    }

    async startCamera(
        camera: Camera,
        ctx: MotionContext,
        callbacks: MotionCallbacks,
        onAttemptFailed: (providerId: MotionProviderId, error: unknown) => void,
    ): Promise<MotionProviderId | null> {
        const chain = resolveMotionProviderChain(camera);

        for (const id of chain) {
            const provider = this.#providers.get(id);
            if (!provider) continue;

            const match = provider.canHandle(camera);
            if (!match) continue;

            try {
                await provider.start(camera, ctx, callbacks);
                return id;
            } catch (error) {
                provider.stop(camera.id);
                onAttemptFailed(id, error);
            }
        }

        return null;
    }

    stopCamera(cameraId: string, providerId: MotionProviderId): void {
        this.#providers.get(providerId)?.stop(cameraId);
    }

    applySensitivity(cameraId: string, providerId: MotionProviderId, level: number, max: number): void {
        const provider = this.#providers.get(providerId);
        if (!provider?.supportsSensitivity) return;
        provider.applySensitivity?.(cameraId, level, max);
    }
}
