import assert from 'node:assert/strict';
import { ReportMetrics } from './reportMetrics.js';

// Sliding window: a short window lets us prove old buckets fall out of the count.
const metrics = new ReportMetrics(1_000);

metrics.record('cam-1', 'occupancySensing', 'occupancy');
metrics.record('cam-1', 'occupancySensing', 'occupancy');
metrics.record('cam-2', 'zoneManagement', 'zoneTriggered');
metrics.record('cam-1', 'occupancySensing', 'occupancy');

let snap = metrics.snapshot();
assert.equal(snap.total, 4, 'total counts every recorded write');
assert.equal(snap.activeEndpointCount, 2, 'distinct endpoints emitting in the window');
assert.equal(snap.perEndpoint['cam-1'].total, 3);
assert.equal(snap.perEndpoint['cam-1'].perCluster['occupancySensing'], 3);
assert.equal(snap.perEndpoint['cam-1'].perAttribute['occupancy'], 3);
assert.equal(snap.topAttributes[0].count, 3, 'highest-volume attribute first');

// Idle bridge reports nothing.
snap = metrics.snapshot();
assert.equal(snap.total, 4);

// Non-positive counts are ignored (never inflate the rate).
metrics.record('cam-1', 'occupancySensing', 'occupancy', 0);
metrics.record('cam-1', 'occupancySensing', 'occupancy', -5);
assert.equal(metrics.snapshot().total, 4);

// Subscription lifecycle counters are tracked separately from attribute writes.
metrics.recordSubscriptionChanged();
metrics.recordSubscriptionChanged();
metrics.recordSubscriptionChanged();
snap = metrics.snapshot();
assert.equal(snap.subscriptions.changed, 3);
assert.equal(snap.total, 4, 'subscription events do not count as attribute reports');

// Window expiry: everything recorded earlier must drop out of a 1s window.
await new Promise(resolve => setTimeout(resolve, 1_100));
snap = metrics.snapshot();
assert.equal(snap.total, 0, 'writes older than the window are excluded');
assert.equal(snap.subscriptions.changed, 0);
assert.equal(snap.activeEndpointCount, 0);
assert.equal(snap.lifetimeTotal, 4, 'lifetime total is window-independent');

console.log('reportMetrics.test.ts: ok');
