import { manualProvider } from './manualProvider.js';
import { onvifProvider } from './onvifProvider.js';
import { reolinkProvider } from './reolinkProvider.js';
import { tapoSonoffProvider } from './tapoSonoffProvider.js';
import { unifiProtectProvider } from './unifiProtectProvider.js';
import type { CameraAddProvider, CameraAddSource } from './types.js';

const providers: CameraAddProvider[] = [
    unifiProtectProvider,
    reolinkProvider,
    tapoSonoffProvider,
    onvifProvider,
    manualProvider,
];

const byId = new Map<CameraAddSource, CameraAddProvider>(
    providers.map(p => [p.meta.id, p]),
);

export function listCameraProviders() {
    return providers.map(p => p.meta);
}

export function getCameraProvider(id: string): CameraAddProvider | undefined {
    return byId.get(id as CameraAddSource);
}
