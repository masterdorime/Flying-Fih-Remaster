import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate, resolveGatePlacement } from '../../js/timing.js';
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

// clearance the way placement reads it: min edge distance over discs whose
// reach touches the plane (same per-disc filter the implementation uses)
function mouthClearance(z, x, discs) {
  const near = discs.filter(d => Math.abs(d.z - z) <= d.radius + 1.2);
  return near.length ? Math.min(...near.map(d => Math.abs(x - d.x) - d.radius)) : Infinity;
}

test('resolveGatePlacement: open water keeps the gate exactly put', () => {
  const discs = [{ x: 2, z: 100, radius: 1 }];
  assert.deepEqual(resolveGatePlacement(-3, 100, discs), { x: -3, z: 100 }); // clear: unchanged
  assert.deepEqual(resolveGatePlacement(0, 200, discs), { x: 0, z: 200 });   // far in z: unchanged
  assert.deepEqual(resolveGatePlacement(0, 100, []), { x: 0, z: 100 });      // no hazards: unchanged
});

test('resolveGatePlacement: a wall row the mouth cannot fit shifts the ring forward', () => {
  // fenced row at z 100, single 3 m gap at (2, 5): a 6 m mouth cannot fit it
  const wall = [
    { x: -12, z: 100, radius: 2 }, { x: -8, z: 100, radius: 2 },
    { x: -4, z: 100, radius: 2 }, { x: 0, z: 100, radius: 2 },
    { x: 7.7, z: 100, radius: 2.7 }, { x: 12.3, z: 100, radius: 1.7 },
  ];
  assert.ok(mouthClearance(100, 3.5, wall) < 3, 'precondition: gap too tight for the mouth');
  const out = resolveGatePlacement(3.5, 100, wall);
  assert.ok(out.z > 100, `ring moves to the first plane the mouth clears (z=${out.z})`);
  assert.ok(out.z - 100 <= 20 + 1e-9, `shift bounded (dz=${out.z - 100})`);
  assert.ok(mouthClearance(out.z, out.x, wall) >= 3,
    `mouth clears at the landed plane (${mouthClearance(out.z, out.x, wall)})`);
});

test('resolveGatePlacement: hulls reach the plane from farther off than a fixed window', () => {
  // ship hull (radius 6.5) 7 m off the plane: outside the old fixed ±6 window,
  // inside its own reach — the mouth must not ignore it
  const ship = [{ x: 0, z: 107, radius: 6.5 }];
  const out = resolveGatePlacement(0, 100, ship);
  assert.ok(out.z > 100 || Math.abs(out.x) > 9.5, `gate clears the hull (x=${out.x}, z=${out.z})`);
});

test('resolveGatePlacement: mover sweeps are respected via envelope discs', () => {
  // two sweepers (hull 2 + range 6 -> the world reports radius 8) fence the
  // whole lane at z 100; the first mouth-clear plane is past their reach
  const movers = [
    { x: -9, z: 100, radius: 8, moving: true },
    { x: 9, z: 100, radius: 8, moving: true },
  ];
  const out = resolveGatePlacement(0, 100, movers);
  assert.ok(out.z > 108, `ring lands past the sweep reach (z=${out.z})`);
  assert.ok(mouthClearance(out.z, out.x, movers) >= 3,
    `mouth clears the sweeps (${mouthClearance(out.z, out.x, movers)})`);
});

test('resolveGatePlacement: best effort in hopeless water — hold the ideal plane', () => {
  const fat = [{ x: 0, z: 100, radius: 30 }];
  const out = resolveGatePlacement(0, 100, fat);
  assert.equal(out.z, 100); // nothing clears anywhere: no wandering
  assert.ok(Number.isFinite(out.x) && Math.abs(out.x) <= 14, `in-bounds fallback (${out.x})`);
});

test('resolveGatePlacement: fuzz — in bounds, bounded, deterministic', () => {
  let rngState = 12345;
  const frand = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 60; i++) {
    const discs = [];
    const n = Math.floor(frand() * 6);
    for (let k = 0; k < n; k++) {
      discs.push({ x: frand() * 28 - 14, z: 100 + (frand() * 2 - 1) * 9, radius: 1 + frand() * 5.5 });
    }
    const gx = frand() * 8 - 4;
    const r = resolveGatePlacement(gx, 100, discs);
    assert.ok(Number.isFinite(r.x) && Math.abs(r.x) <= 14, `x in bounds (${r.x})`);
    assert.ok(r.z >= 100 && r.z <= 120 + 1e-9, `z within [ideal, ideal+20] (${r.z})`);
    if (mouthClearance(100, gx, discs) >= 3) {
      assert.deepEqual(r, { x: gx, z: 100 }, 'a spawn the mouth already clears never moves');
    }
    assert.deepEqual(resolveGatePlacement(gx, 100, discs), r, 'deterministic');
  }
});
