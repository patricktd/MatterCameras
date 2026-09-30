/**
 * CSA-assigned vendor IDs of common Matter admin ecosystems, used to label
 * fabrics whose controller never set a fabric label. The controller-provided
 * label always wins over this mapping.
 *
 * The vendor ID identifies the ecosystem/fabric controller, so it is stable
 * across hardware generations (e.g. every SmartThings Hub generation reports
 * the same fabric vendor). Only the controller-provided label carries a
 * generation/model name, and that label is optional — when it is absent and
 * the vendor is unknown we fall back to a generic name that still surfaces the
 * raw vendor ID, never a bare "Fabric N".
 */
const KNOWN_MATTER_VENDORS: Record<number, string> = {
    // Apple
    0x1349: 'Apple Home',
    0x1384: 'Apple Keychain',
    // Google
    0x6006: 'Google Home',
    // Samsung / SmartThings (stable across hub generations)
    0x110a: 'Samsung SmartThings',
    // Amazon
    0x1217: 'Amazon Alexa',
    // Home Assistant
    0x134b: 'Home Assistant',
    // Other ecosystems / hubs
    0x115f: 'Aqara',
    0x1002: 'Tuya',
    0x100b: 'Signify (Hue)',
    0x1041: 'IKEA',
    0x11a0: 'Hubitat',
    0x1258: 'Homey',
    0x1236: 'SmartThings',
    0x118c: 'eWeLink',
    0x1407: 'Shelly',
    // Device vendors that also ship Matter controllers / admin apps.
    0x1001: 'Legrand',
    0x1011: 'Control4',
    0x1012: 'Lutron',
    0x1013: 'Samsung SmartThings',
    0x104a: 'Somfy',
    0x1189: 'GM',
    // Test vendors.
    0xfff1: 'Test vendor',
    0xfff2: 'Test vendor',
    0xfff3: 'Test vendor',
    0xfff4: 'Test vendor',
};

export function matterVendorName(vendorId: number): string | undefined {
    return KNOWN_MATTER_VENDORS[vendorId];
}

/**
 * Fallback for a fabric whose controller set no label and whose vendor is not
 * in the known-ecosystem map. Keeps the raw vendor ID visible so support can
 * still identify the controller, and never degrades to a bare "Fabric N".
 */
export function genericFabricName(vendorId: number): string {
    const hex = `0x${vendorId.toString(16)}`;
    return `Hub (vendor ${hex})`;
}

/** Display name for a fabric: controller label > known ecosystem > generic. */
export function fabricDisplayName(fabric: { label: string; rootVendorId: number; fabricIndex: number }): string {
    if (fabric.label.trim().length > 0) return fabric.label.trim();
    return matterVendorName(fabric.rootVendorId) ?? genericFabricName(fabric.rootVendorId);
}
