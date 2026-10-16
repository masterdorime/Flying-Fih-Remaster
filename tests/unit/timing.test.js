import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate, resolveGateOverlap } from '../../js/timing.js';
import { GATE, ASSIST, QTE } from '../../js/config.js';
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

test('flight gates are reachable: spawned near the fish, clamped into the band', () => {
  for (let i = 0; i < 50; i++) {
    const g = createGate(mulberry32(100 + i), { locomotion: 'fly', playerPos: { x: 0, y: 80, z: 0 }, runTime: 5, speed: 110 });
    assert.ok(Math.abs(g.y - 80) <= 8, `gate reachable by W/S within the lead (y=${g.y.toFixed(2)}, fish 80)`);
    assert.ok(g.y >= GATE.flightMin && g.y <= GATE.flightMax, `gate in band (y=${g.y})`);
  }
  // clamped at the band edges: a fish hugging the ceiling still gets in-band gates
  const high = createGate(mulberry32(5), { locomotion: 'fly', playerPos: { x: 0, y: 112, z: 0 }, runTime: 5, speed: 110 });
  assert.ok(high.y <= GATE.flightMax, `ceiling clamp (y=${high.y})`);
  const low = createGate(mulberry32(5), { locomotion: 'fly', playerPos: { x: 0, y: 58, z: 0 }, runTime: 5, speed: 110 });
  assert.ok(low.y >= GATE.flightMin, `floor clamp (y=${low.y})`);
});

test('spawn lead scales with speed: slow swim gets a near gate, fast run keeps the horizon', () => {
  const slow = createGate(mulberry32(3), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 1, speed: GATE.spawnMin / GATE.leadSeconds - 1 });
  assert.equal(slow.z, GATE.spawnMin); // MinSpeed opener: ~5s away, not a 11s crawl
  const fast = createGate(mulberry32(3), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 1, speed: 200 });
  assert.equal(fast.z, GATE.spawnAhead); // capped at speed * leadSeconds
  const mid = createGate(mulberry32(3), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 1, speed: GATE.spawnAhead / GATE.leadSeconds });
  assert.equal(mid.z, GATE.spawnAhead);
});

test('crossingSample interpolates the crossing plane (no tunneling misses)', () => {
  const s = crossingSample({ x: 0.2, y: 1.0, z: 88 }, { x: 0.4, y: 1.0, z: 92 }, 90);
  assert.ok(Math.abs(s.x - 0.3) < 1e-9 && s.z === 90);
  assert.equal(crossingSample({ x: 0, y: 0, z: 88 }, { x: 0, y: 0, z: 89 }, 90), null);
});

test('mouthHit: inside / boundary / outside, on both axes', () => {
  assert.equal(mouthHit(gate(), { x: 0, y: 0, z: 100 }), 'inside');
  assert.equal(mouthHit(gate(), { x: 3.0, y: 0, z: 100 }), 'inside');   // = mouthRadius counts
  assert.equal(mouthHit(gate(), { x: 4.5, y: 0, z: 100 }), 'miss');
  assert.equal(mouthHit(gate(), { x: 0, y: -2.1, z: 100 }), 'inside'); // vertical axis too
});

test('config: QTE windows are 0.30 / 0.70 and perfectRadius is retired', () => {
  assert.equal(QTE.perfectWindow, 0.30);
  assert.equal(QTE.goodWindow, 0.70);
  assert.equal(GATE.mouthRadius, 3.0);
  assert.equal('perfectRadius' in GATE, false);
});

test('createQte: windows from config; assist widens both by windowScale', () => {
  const q = createQte(gate(), 10);
  assert.equal(q.perfectWindow, QTE.perfectWindow);
  assert.equal(q.goodWindow, QTE.goodWindow);
  assert.equal(q.startedAt, 10);
  assert.equal(q.resolved, false);
  const a = createQte(gate(), 10, { assist: true });
  assert.ok(Math.abs(a.perfectWindow - QTE.perfectWindow * ASSIST.windowScale) < 1e-9);
  assert.ok(Math.abs(a.goodWindow - QTE.goodWindow * ASSIST.windowScale) < 1e-9);
});

test('createQte stamps qteOpened: one QTE per gate', () => {
  const g = gate();
  createQte(g, 10);
  assert.equal(g.qteOpened, true);
});

test('evaluatePress: early perfect, mid good, late miss; idempotent', () => {
  assert.equal(evaluatePress(createQte(gate(), 10), 10.30), 'perfect');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.31), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.69), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.71), 'miss');
  assert.equal(evaluatePress(createQte(gate(), 10), 9.99), 'miss'); // press predates the window
  const q = createQte(gate(), 10);
  evaluatePress(q, 10.1);
  assert.equal(evaluatePress(q, 10.9), 'perfect'); // stored result wins
  assert.equal(q.resolved, true);
});

test('qteRemaining: exact before the deadline, 0 after', () => {
  const q = createQte(gate(), 10);
  assert.ok(Math.abs(qteRemaining(q, 10.25) - 0.45) < 1e-9);
  assert.equal(qteRemaining(q, 11), 0);
});

test('gateBehind + gateCadence', () => {
  assert.equal(gateBehind(gate({ z: 100 }), { z: 106 }), true);  // >= 6 m past the plane
  assert.equal(gateBehind(gate({ z: 100 }), { z: 105 }), false); // 5 m past: still resolving
  assert.equal(gateBehind(gate({ z: 100 }), { z: 95 }), false);
  assert.equal(gateCadence(gate({ resolved: false }), 0), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0.3), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0), true);
});

test('reseatSwimGate re-glues a swim gate to the live wave (grade = what is drawn)', () => {
  const g = { id: 1, x: 0, y: 99, z: 100, resolved: false, result: null };
  const runTime = 8.3;
  reseatSwimGate(g, runTime);
  const expected = surfaceHeight(0, 100, runTime) + GATE.swimLift;
  assert.ok(Math.abs(g.y - expected) < 1e-9, `gate re-seated to the wave (${g.y} vs ${expected})`);
  // drift from the stale height is real: up to ~2x wave amplitude (0.93)
  assert.ok(Math.abs(g.y - 99) > 0.5, 'stale spawn-time height actually moved');
});

// local fixture: a gate at a known place (the gateBehind/gateCadence tests pass
// overrides through it, so it stays a function with an `over` param)
function gate(over = {}) {
  return { id: 1, x: 0, y: 0, z: 100, resolved: false, result: null, ...over };
}

test('resolveGateOverlap: inside footprint pushes to nearest clear side', () => {
  const discs = [{ x: 2, z: 100, radius: 2.6 }];
  assert.ok(Math.abs(resolveGateOverlap(2, 100, discs) - (2 + 2.6 + 1.6)) < 1e-9, 'pushed +x');
  assert.equal(resolveGateOverlap(-3, 100, discs), -3);            // far: unchanged
  assert.equal(resolveGateOverlap(0, 200, discs), 0);              // far in z: unchanged
  assert.equal(resolveGateOverlap(13.5, 100, [{ x: 13, z: 100, radius: 2 }]), 14); // clamped
  const two = [{ x: 1, z: 100, radius: 2 }, { x: -1, z: 100, radius: 2 }];
  const out = resolveGateOverlap(0.2, 100, two);
  assert.ok(Number.isFinite(out) && Math.abs(out) <= 14, `finite in-bounds result (${out})`);
});
