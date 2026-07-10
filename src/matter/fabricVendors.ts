/**
 * CSA-assigned vendor IDs of common Matter admin ecosystems, used to label
 * fabrics whose controller never set a fabric label. The controller-provided
 * label always wins over this mapping.
 */
const KNOWN_MATTER_VENDORS: Record<number, string> = {
    0x1349: 'Apple Home',
    0x1384: 'Apple Keychain',
    0x6006: 'Google Home',
    0x110a: 'Samsung SmartThings',
    0x1217: 'Amazon Alexa',
    0x134b: 'Home Assistant',
    0x115f: 'Aqara',
    0x1002: 'Tuya',
    0x100b: 'Signify (Hue)',
    0x1041: 'IKEA',
    0xfff1: 'Test vendor',
    0xfff2: 'Test vendor',
    0xfff3: 'Test vendor',
    0xfff4: 'Test vendor',
};

export function matterVendorName(vendorId: number): string | undefined {
    return KNOWN_MATTER_VENDORS[vendorId];
}

/** Display name for a fabric: controller label > known ecosystem > generic. */
export function fabricDisplayName(fabric: { label: string; rootVendorId: number; fabricIndex: number }): string {
    if (fabric.label.trim().length > 0) return fabric.label.trim();
    return matterVendorName(fabric.rootVendorId) ?? `Fabric ${fabric.fabricIndex}`;
}
