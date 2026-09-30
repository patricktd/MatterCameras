import assert from 'node:assert/strict';
import { fabricDisplayName, genericFabricName, matterVendorName } from './fabricVendors.js';

assert.equal(matterVendorName(0x110a), 'Samsung SmartThings');
assert.equal(matterVendorName(0x1349), 'Apple Home');
assert.equal(matterVendorName(0x6006), 'Google Home');
assert.equal(matterVendorName(0x1217), 'Amazon Alexa');
assert.equal(matterVendorName(0x134b), 'Home Assistant');
assert.equal(matterVendorName(0x11a0), 'Hubitat');
assert.equal(matterVendorName(0xfff1), 'Test vendor');
assert.equal(matterVendorName(0x0042), undefined);

// Generic fallback keeps the raw vendor ID visible.
assert.equal(genericFabricName(0x1234), 'Hub (vendor 0x1234)');
assert.equal(genericFabricName(0x0042), 'Hub (vendor 0x42)');

// Controller-provided label always wins.
assert.equal(
    fabricDisplayName({ label: 'Casa', rootVendorId: 0x110a, fabricIndex: 1 }),
    'Casa',
);
// Whitespace-only label falls back to the known ecosystem name.
assert.equal(
    fabricDisplayName({ label: '   ', rootVendorId: 0x1349, fabricIndex: 2 }),
    'Apple Home',
);
// Known ecosystem without label still names the ecosystem.
assert.equal(
    fabricDisplayName({ label: '', rootVendorId: 0x110a, fabricIndex: 3 }),
    'Samsung SmartThings',
);
// Unknown vendor without label gets a generic name carrying the vendor ID.
assert.equal(
    fabricDisplayName({ label: '', rootVendorId: 0x0042, fabricIndex: 4 }),
    'Hub (vendor 0x42)',
);

console.log('fabricVendors tests passed');
