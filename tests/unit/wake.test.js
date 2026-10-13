import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrail, trailPush, wakeWidthForSpeed } from '../../js/wake-trail.js';

// Pure wake-trail logic (the three.js ribbon in the same file is verified
// live + via t20; only the math lives here so it can be unit-tested).

test('trailPush spaces samples and caps the buffer', () => {
  const trail = createTrail(6, 1.0);
  trailPush(trail, 0, 0, 0);
  assert.equal(trail.points.length, 1);
  trailPush(trail, 0, 0.2, 0.05); // too close -> ignored
  assert.equal(trail.points.length, 1);
  trailPush(trail, 0, 1.5, 0.2);
  assert.equal(trail.points.length, 2);
  for (let i = 0; i < 10; i++) trailPush(trail, 0, 2 + i * 2, 0.4 + i * 0.2);
  assert.equal(trail.points.length, 6); // capped
  assert.equal(trail.points[0].z, 10);  // oldest evicted first (keeps last 6)
});

test('trailPush keeps the newest sample even when it overflows', () => {
  const trail = createTrail(3, 0.5);
  trailPush(trail, 0, 0, 0);
  trailPush(trail, 1, 1, 1);
  trailPush(trail, 2, 2, 2);
  trailPush(trail, 3, 3, 3);
  assert.deepEqual([trail.points.at(-1).x, trail.points.at(-1).z], [3, 3]);
});

test('wake width grows with speed: calm at min speed, wide at cruise', () => {
  const calm = wakeWidthForSpeed(8);
  const cruise = wakeWidthForSpeed(35);
  const fast = wakeWidthForSpeed(110);
  assert.ok(calm < cruise && cruise <= fast, `${calm} < ${cruise} <= ${fast}`);
  assert.ok(calm >= 0.2 && fast <= 2.5, `bounded (${calm}, ${fast})`);
});
