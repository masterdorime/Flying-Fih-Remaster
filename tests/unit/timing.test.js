import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate, resolveGatePlacement, corridorGapAt } from '../../js/timing.js';
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

// clearance the way placement reads it (2026-10-18 capsule contract): edge gap
// over every disc whose z-band (rz — the honest hull half-length, not the
// anchor dot) touches the plane by the mouth radius. Mirrors the
// implementation's in-scope + edge math.
function mouthClearance(z, x, discs) {
  const near = discs.filter(d => Math.abs(d.z - z) <= (d.rz ?? d.radius) + GATE.mouthRadius);
  return near.length ? Math.min(...near.map(d => Math.abs(x - d.x) - (d.rx ?? d.radius))) : Infinity;
}

// Mirrors the 2026-10-22 corridor contract (spec stage A) independently of the implementation: clear
// water BEHIND and AHEAD of the plane inside the ring's own lane window. If this and the
// implementation drift, these tests stop meaning anything — which is the point of restating it here.
function corridorClearAt(x, z, discs) {
  const g = corridorGapAt(x, z, discs);
  return g.before >= GATE.corridorBefore - 1e-9 && g.after >= GATE.corridorAfter - 1e-9;
}

test('resolveGatePlacement: open water keeps the gate exactly put', () => {
  const discs = [{ x: 2, z: 100, radius: 1 }];
  assert.deepEqual(resolveGatePlacement(-3, 100, discs), { x: -3, z: 100 }); // clear: unchanged
  assert.deepEqual(resolveGatePlacement(0, 200, discs), { x: 0, z: 200 });   // far in z: unchanged
  assert.deepEqual(resolveGatePlacement(0, 100, []), { x: 0, z: 100 });      // no hazards: unchanged
});

test('resolveGatePlacement: gate-clearance ruling §1 — capsules reach the plane by rz', () => {
  // A ship-class hull (rx 3.6, rz 9.4) anchored 6.5 m OFF the plane: the old
  // radius-dot filter (3.6 + 1.2 = 4.8) never saw it and spawned the ring
  // inside the hull body. The band is rz + mouth, so the plane must dodge it.
  const hull = [{ x: 0, z: 106.5, radius: 3.6, rz: 9.4 }];
  const out = resolveGatePlacement(0, 100, hull);
  const inBand = Math.abs(out.z - 106.5) <= 9.4 + 3.0 + 1e-9;
  assert.ok(!inBand || Math.abs(out.x - 0) - 3.6 >= 3.8 - 1e-9,
    `ring inside the hull body: x=${out.x}, z=${out.z}`);
});

test('resolveGatePlacement: gate-clearance ruling §2 — accepted planes clear mouth+margin, never graze', () => {
  // hull in-band of the ideal plane, offset 7 m: the old bar accepted a 3.4 m
  // edge gap (ring 0.4 m off the hull edge — "really near"); the ruling raises
  // the acceptance bar to mouth + clearanceMargin = 3.8.
  const hull = [{ x: -7, z: 100.5, radius: 3.6, rz: 9.4 }];
  const out = resolveGatePlacement(0, 100, hull);
  const inBand = Math.abs(out.z - 100.5) <= 9.4 + 3.0 + 1e-9;
  const edge = Math.abs(out.x + 7) - 3.6;
  assert.ok(!inBand || edge >= 3.8 - 1e-9, `grazing plane: x=${out.x}, z=${out.z}, edge ${edge}`);
});

test('resolveGatePlacement: shift planes are capsule-checked — no landing inside a hull band', () => {
  // ideal plane blocked by a row hull; a FORWARD hull's BODY covers the ideal
  // plane's x on the lane edge the old clearestX would pick. The old
  // radius-dot filter never saw that hull (|dz| 8 > 3.4 + 1.2) and returned a
  // ring standing inside it.
  const blockers = [
    { x: 0, z: 100, radius: 2, rz: 4 },      // ideal-plane blocker
    { x: -13, z: 108, radius: 3.4, rz: 8 },  // body spans z 100..116, covers x -14
  ];
  const out = resolveGatePlacement(0, 100, blockers);
  for (const d of blockers) {
    const inBand = Math.abs(out.z - d.z) <= d.rz + 3.0 + 1e-9;
    assert.ok(!inBand || Math.abs(out.x - d.x) - (d.rx ?? d.radius) >= 3.8 - 1e-9,
      `landed plane violates hull ${d.z}: x=${out.x}, z=${out.z}`);
  }
});

test('resolveGatePlacement: wall row the mouth cannot fit shifts the ring forward at the ruling bar', () => {
  // fenced row at z 100, single 3 m gap at (2, 5): a 6 m mouth cannot fit it
  const wall = [
    { x: -12, z: 100, radius: 2 }, { x: -8, z: 100, radius: 2 },
    { x: -4, z: 100, radius: 2 }, { x: 0, z: 100, radius: 2 },
    { x: 7.7, z: 100, radius: 2.7 }, { x: 12.3, z: 100, radius: 1.7 },
  ];
  assert.ok(mouthClearance(100, 3.5, wall) < 3, 'precondition: gap too tight for the mouth');
  // window stated explicitly (2026-10-22): the search now runs the whole spawn lead band, not the old
  // ±20, because the clear water a ring needs is usually further away than that
  const out = resolveGatePlacement(3.5, 100, wall, { minZ: 100, maxZ: 220 });
  assert.ok(out.z > 100, `ring moves to a plane the mouth clears (z=${out.z})`);
  assert.ok(out.z - 100 <= 120 + 1e-9, `shift stays inside the lead band (dz=${out.z - 100})`);
  assert.ok(mouthClearance(out.z, out.x, wall) >= 3.8,
    `mouth clears at the landed plane (${mouthClearance(out.z, out.x, wall)})`);
  assert.ok(corridorClearAt(out.x, out.z, wall), 'and the corridor is clear there too');
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
  const out = resolveGatePlacement(0, 100, movers, { minZ: 100, maxZ: 220 });
  assert.ok(out.z > 108, `ring lands past the sweep reach (z=${out.z})`);
  assert.ok(mouthClearance(out.z, out.x, movers) >= 3.8,
    `mouth clears the sweeps (${mouthClearance(out.z, out.x, movers)})`);
});

test('resolveGatePlacement: best effort in hopeless water — hold the ideal plane', () => {
  const fat = [{ x: 0, z: 100, radius: 30 }];
  const out = resolveGatePlacement(0, 100, fat);
  assert.equal(out.z, 100); // nothing clears anywhere: no wandering
  assert.ok(Number.isFinite(out.x) && Math.abs(out.x) <= 14, `in-bounds fallback (${out.x})`);
});

test('config: gate clearance margin is 0.8 (accepted planes clear mouth+margin)', () => {
  assert.equal(GATE.clearanceMargin, 0.8);
});

// ---- ring corridor (2026-10-22 spec, stage A) ----------------------------------------------
// Measured live: the "inside a hull" case is gone (0/25), but 28% of rings left under 18 m of clear
// water BEHIND them in their own lane window — worst case 2.7 m — because the ruling bar only ever
// looked at ONE plane, never at the water the player has to line up in. These fixtures are drawn from
// the live shapes: a plane the old bar calls perfectly clear, with a hull squarely in its corridor.
// Non-vacuity: two of these demand a move and one demands no move, so the set cannot pass by
// returning the ideal plane every time.

test('ring corridor: a hull in the lane BEHIND the ring moves it forward', () => {
  const discs = [{ x: 0.5, z: 92, radius: 1.5, rz: 2 }];
  // the OLD bar sees nothing at all: the hull's z-band is 8 m from the plane
  assert.equal(mouthClearance(100, 0, discs), Infinity, 'the ruling bar alone sees nothing wrong here');
  const out = resolveGatePlacement(0, 100, discs, { minZ: 40, maxZ: 120 });
  assert.notDeepEqual(out, { x: 0, z: 100 }, 'a ring with 4.9 m of water behind it must not stay put');
  const gap = corridorGapAt(out.x, out.z, discs);
  assert.ok(gap.before >= GATE.corridorBefore - 1e-9,
    `ring opens only ${gap.before.toFixed(1)} m of water behind it, needs ${GATE.corridorBefore} (x=${out.x}, z=${out.z})`);
});

test('ring corridor: a hull in the lane AHEAD of the ring moves it BACK, into the water it has', () => {
  // A fence across the whole lane, just past the plane: no lateral escape exists, so the only legal
  // move is z — and the water is BEHIND. (A small hull would let the ring dodge sideways instead,
  // which is why this fixture fences the lane: it pins the backward move, not the dodge.)
  const discs = [{ x: 0, z: 108, radius: 20, rz: 2 }]; // 4.9 m of water after the plane
  const out = resolveGatePlacement(0, 100, discs, { minZ: 40, maxZ: 120 });
  const gap = corridorGapAt(out.x, out.z, discs);
  assert.ok(gap.after >= GATE.corridorAfter - 1e-9,
    `ring leaves only ${gap.after.toFixed(1)} m of water ahead, needs ${GATE.corridorAfter} (x=${out.x}, z=${out.z})`);
  assert.ok(out.z < 100, `the water is behind it, so the ring must move back — got z=${out.z}`);
});

test('ring corridor: a ring never slides behind the player', () => {
  const discs = [{ x: 0.5, z: 108, radius: 1.5, rz: 2 }];
  // the only legal plane for this fixture is ~92; minZ forbids it
  const out = resolveGatePlacement(0, 100, discs, { minZ: 95, maxZ: 120 });
  assert.ok(out.z >= 95 - 1e-9, `the ring must never land behind the player: z=${out.z}`);
});

test('ring corridor: a plane whose corridor is already clear does not move at all', () => {
  const discs = [{ x: 0.5, z: 300, radius: 1.5, rz: 2 }];
  assert.deepEqual(resolveGatePlacement(0, 100, discs, { minZ: 40, maxZ: 120 }), { x: 0, z: 100 });
});

test('ring corridor: a hull that clears the circle but stands in the lane is still in the way', () => {
  // lateral edge 2.4 m from the ring centre: inside the mouth's own span, and NOT flagged by the
  // plane bar because it never touches the plane's z-band
  const discs = [{ x: 2.9, z: 86, radius: 0.5, rz: 1 }];
  const out = resolveGatePlacement(0, 100, discs, { minZ: 40, maxZ: 120 });
  const gap = corridorGapAt(out.x, out.z, discs);
  assert.ok(gap.before >= GATE.corridorBefore - 1e-9,
    `a hull 2.4 m off the mouth line still blocks the approach: before=${gap.before.toFixed(1)} (x=${out.x}, z=${out.z})`);
});

test('resolveGatePlacement: fuzz — capsules, in bounds, shifts land only on legal planes', () => {
  let rngState = 12345;
  const frand = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 60; i++) {
    const discs = [];
    const n = Math.floor(frand() * 6);
    for (let k = 0; k < n; k++) {
      const radius = 1 + frand() * 5.5;
      const disc = { x: frand() * 28 - 14, z: 100 + (frand() * 2 - 1) * 9, radius };
      if (frand() < 0.5) { disc.rx = radius; disc.rz = radius * (1 + frand() * 1.5); }
      discs.push(disc);
    }
    const gx = frand() * 8 - 4;
    const r = resolveGatePlacement(gx, 100, discs, { minZ: 100, maxZ: 120 });
    assert.ok(Number.isFinite(r.x) && Math.abs(r.x) <= 14, `x in bounds (${r.x})`);
    assert.ok(r.z >= 100 && r.z <= 120 + 1e-9, `z within [ideal, ideal+20] (${r.z})`);
    if (corridorClearAt(gx, 100, discs)) {
      assert.deepEqual(r, { x: gx, z: 100 }, 'a spawn with clear water AND a clear corridor never moves');
    }
    if (r.z > 100 + 1e-9) {
      // the ruling's core: a chosen shift plane is capsule-legal, never an
      // overlap or graze the old radius-dot check would have blessed
      const edge = mouthClearance(r.z, r.x, discs);
      assert.ok(edge >= 3.8 - 1e-9, `shift landed at a near/overlapping plane (edge ${edge})`);
    }
    if (r.z !== 100) {
      // a z move only ever happens on ACCEPTANCE, so the corridor must hold there. (An x-only change
      // cannot be asserted this way: the clearest-x fallback also moves x, and it is best-effort.)
      assert.ok(corridorClearAt(r.x, r.z, discs),
        `a moved plane must have a clear corridor: b=${corridorGapAt(r.x, r.z, discs).before.toFixed(1)} a=${corridorGapAt(r.x, r.z, discs).after.toFixed(1)}`);
    }
    assert.deepEqual(resolveGatePlacement(gx, 100, discs, { minZ: 100, maxZ: 120 }), r, 'deterministic');
  }
});
