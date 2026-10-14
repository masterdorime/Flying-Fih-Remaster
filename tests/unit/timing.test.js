import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, resolveGate, gateBehind, gateCadence } from '../../js/timing.js';
import { GATE, ASSIST } from '../../js/config.js';
import { mulberry32 } from '../../js/worldgen.js';
import { surfaceHeight } from '../../js/wave.js';

test('createGate is deterministic for a seed and respects bounds', () => {
  const a = createGate(mulberry32(7), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 3 });
  const b = createGate(mulberry32(7), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 3 });
  assert.deepEqual({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }); // placement; id is a counter
  assert.ok(Math.abs(a.x) <= GATE.corridorX);
  assert.equal(a.z, GATE.spawnAhead);
  assert.ok(Math.abs(surfaceHeight(a.x, a.z, 3) + GATE.swimLift - a.y) < 1e-9);
});

test('flight gates sit inside the climb band', () => {
  for (let i = 0; i < 50; i++) {
    const g = createGate(mulberry32(100 + i), { locomotion: 'fly', playerPos: { x: 0, y: 80, z: 0 }, runTime: 5 });
    assert.ok(g.y >= GATE.flightMin && g.y <= GATE.flightMax, `gate y=${g.y}`);
  }
});

test('crossingSample interpolates the crossing plane (no tunneling misses)', () => {
  const s = crossingSample({ x: 0.2, y: 1.0, z: 88 }, { x: 0.4, y: 1.0, z: 92 }, 90);
  assert.ok(Math.abs(s.x - 0.3) < 1e-9 && s.z === 90);
  assert.equal(crossingSample({ x: 0, y: 0, z: 88 }, { x: 0, y: 0, z: 89 }, 90), null);
});

test('resolveGate bands: perfect / good / miss, idempotent', () => {
  assert.equal(resolveGate(gate(), { x: 0.5, y: 1.0, z: 100 }), 'perfect');        // <=1.2
  assert.equal(resolveGate(gate(), { x: 2, y: 1, z: 100 }), 'good');               // <=3.0
  assert.equal(resolveGate(gate(), { x: 4.5, y: 1, z: 100 }), 'miss');             // >3.0
  const g = gate();
  resolveGate(g, { x: 0, y: 1, z: 100 });
  assert.equal(resolveGate(g, { x: 4.5, y: 1, z: 100 }), 'perfect');              // stored result wins
  assert.equal(g.resolved, true);
});

test('assist widens the perfect circle but stays inside good', () => {
  assert.ok(GATE.perfectRadius * ASSIST.windowScale < GATE.goodRadius);
  assert.equal(resolveGate(gate(), { x: 1.5, y: 1, z: 100 }, { assist: true }), 'perfect');
});

test('gateBehind + gateCadence', () => {
  assert.equal(gateBehind(gate({ z: 100 }), { z: 106 }), true);  // >= 6 m past the plane
  assert.equal(gateBehind(gate({ z: 100 }), { z: 105 }), false); // 5 m past: still resolving
  assert.equal(gateBehind(gate({ z: 100 }), { z: 95 }), false);
  assert.equal(gateCadence(gate({ resolved: false }), 0), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0.3), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0), true);
});

// local fixture: a resolved-able gate at a known place
function gate(over = {}) {
  return { id: 1, x: 0, y: 1, z: 100, resolved: false, result: null, ...over };
}
