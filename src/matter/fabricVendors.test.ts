import assert from 'node:assert/strict';
import { fabricDisplayName, matterVendorName } from './fabricVendors.js';

assert.equal(matterVendorName(0x110a), 'Samsung SmartThings');
assert.equal(matterVendorName(0x1349), 'Apple Home');
assert.equal(matterVendorName(0x6006), 'Google Home');
assert.equal(matterVendorName(0x1217), 'Amazon Alexa');
assert.equal(matterVendorName(0xfff1), 'Test vendor');
assert.equal(matterVendorName(0x0042), undefined);

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
// Unknown vendor without label gets a generic name from the fabric index.
assert.equal(
    fabricDisplayName({ label: '', rootVendorId: 0x0042, fabricIndex: 3 }),
    'Fabric 3',
);

console.log('fabricVendors tests passed');
