/** Matter BridgedDeviceBasicInformation uniqueId (max 32 bytes). */
export function bridgedUniqueId(endpointId: string, bindEpoch?: number): string {
    const raw = bindEpoch != null && bindEpoch > 0
        ? `${endpointId}-u${bindEpoch}`
        : `${endpointId}-uid`;
    return raw.length <= 32 ? raw : raw.slice(-32);
}
