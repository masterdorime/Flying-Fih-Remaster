import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate, resolveGatePlacement, corridorGapAt, pickStyle, pickLead, dialAngles, gateRngFor } from '../../js/timing.js';
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

test('config: the QTE window is CENTRED on a tick-aligned target, and perfectRadius is retired', () => {
  assert.equal(QTE.tick, 0.16, 'the tick is the clock step and the target unit');
  assert.ok(QTE.tick >= 0.15, 'and it must stay above the aliasing floor at ~11 fps');
  assert.equal(QTE.targetTicks.min, 4);
  assert.equal(QTE.targetTicks.max, 6);
  assert.equal(QTE.targetTicks.min * QTE.tick, 0.64, 'the earliest moment is 4 ticks out');
  assert.equal(QTE.perfectHalf, 0.16, 'Perfect is exactly one tick');
  assert.equal(QTE.goodHalf, 0.38);
  assert.equal('targetLead' in QTE, false, 'the fixed lead is gone: the target moves per trigger');
  assert.equal('perfectWindow' in QTE, false, 'the old from-the-crossing window is gone');
  assert.equal('goodWindow' in QTE, false);
  assert.equal(GATE.mouthRadius, 3.0);
  assert.equal('perfectRadius' in GATE, false);
});

test('createQte: the centred window comes from config; assist widens the halves by windowScale', () => {
  const q = createQte(gate(), 10);
  assert.equal(q.targetAt, 10 + QTE.targetTicks.min * QTE.tick);
  assert.equal(q.perfectHalf, QTE.perfectHalf);
  assert.equal(q.goodHalf, QTE.goodHalf);
  assert.equal(q.deadline, q.targetAt + QTE.goodHalf);
  assert.equal(q.startedAt, 10);
  assert.equal(q.resolved, false);
  const a = createQte(gate(), 10, { assist: true });
  assert.ok(Math.abs(a.perfectHalf - QTE.perfectHalf * ASSIST.windowScale) < 1e-9);
  assert.ok(Math.abs(a.goodHalf - QTE.goodHalf * ASSIST.windowScale) < 1e-9);
  assert.equal(a.targetAt, 10 + QTE.targetTicks.min * QTE.tick, 'the moment does not move');
});

test('createQte stamps qteOpened: one QTE per gate', () => {
  const g = gate();
  createQte(g, 10);
  assert.equal(g.qteOpened, true);
});

test('evaluatePress: the moment is perfect, either side is good, beyond is a miss; idempotent', () => {
  const T = 10 + QTE.targetTicks.min * QTE.tick;
  assert.equal(evaluatePress(createQte(gate(), 10), T), 'perfect');
  assert.equal(evaluatePress(createQte(gate(), 10), T - QTE.perfectHalf - 0.01), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), T + QTE.perfectHalf + 0.01), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), T + QTE.goodHalf + 0.01), 'miss');
  assert.equal(evaluatePress(createQte(gate(), 10), T - QTE.goodHalf - 0.01), 'miss'); // far too early
  assert.equal(evaluatePress(createQte(gate(), 10), 10), 'miss', 'jumping the gun is a miss now');
  const q = createQte(gate(), 10);
  evaluatePress(q, T + 0.3); // a Good
  assert.equal(evaluatePress(q, T), 'good', 'the stored result wins: a later press cannot upgrade it');
  assert.equal(q.resolved, true);
});

test('qteRemaining: counts down to the deadline, 0 after', () => {
  const q = createQte(gate(), 10);
  const toDeadline = q.deadline - 10.25;
  assert.ok(Math.abs(qteRemaining(q, 10.25) - toDeadline) < 1e-9);
  assert.equal(qteRemaining(q, 12), 0);
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

// ---- centred QTE timing, two styles (2026-10-22, user-directed) ------------------------------
// The grade VOCABULARY is unchanged — perfect / good / miss, and everything downstream of applyResult
// (+8/+4, chain, cuts, scoring) is untouched. What changed is WHEN a press counts: the window is
// CENTRED on the moment the cue resolves, so pressing the instant you cross is now a Miss. The two
// styles (closing / clock) share the window: the style is presentation, not difficulty.

test('style roster: deterministic per rng, difficulty-gated, and never the same twice in a row', () => {
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

  for (const seed of [1, 7, 1234]) {
    const a = []; const b = [];
    for (let i = 0; i < 12; i++) a.push(pickStyle(mulberry32(seed * 31 + i), 1, a[i - 1] ?? null));
    for (let i = 0; i < 12; i++) b.push(pickStyle(mulberry32(seed * 31 + i), 1, b[i - 1] ?? null));
    assert.deepEqual(a, b, 'the same seed must give the same style sequence');
  }

  let last = null;
  for (let i = 0; i < 40; i++) {
    const s = pickStyle(seq([0.99, 0.5, 0.1]), 1, last);
    assert.notEqual(s, last, `style repeated twice in a row (${s})`);
    last = s;
  }

  // BOTH styles are available from the first ring (2026-10-22): holding one back made the opening fifth
  // of every run the same style, which is the opposite of varied where it is felt. The difficulty GATE
  // mechanism is still exercised below through the roster's own shape.
  const atZero = new Set();
  for (let i = 0; i < 40; i++) atZero.add(pickStyle(mulberry32(i * 7919), 0, null));
  assert.deepEqual([...atZero].sort(), ['clock', 'closing'], 'both styles reachable from the first ring');
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pickStyle(mulberry32(i * 7919), 1, null));
  assert.deepEqual([...seen].sort(), ['clock', 'closing'], 'both styles must be reachable at full difficulty');
});

// ---- the tick model (2026-10-22, "cannot tell when to press") --------------------------------
// The fix for an unreadable moment is a STATIC target plus a beat, and the variation the user asked for
// ("the perfect, good, miss placement should be different every trigger") is delivered by moving the
// TARGET while the window keeps a constant width. Moving the window itself would randomly change the
// difficulty of each ring, which is variation in difficulty, not in timing.

test('the target is a whole number of ticks inside the drawn range', () => {
  assert.ok(QTE.tick >= 0.15, `the tick must stay above the aliasing floor at ~11 fps (${QTE.tick})`);
  assert.ok(QTE.targetTicks.min >= 2 && QTE.targetTicks.max > QTE.targetTicks.min,
    'the target range must be a real range');
  const leads = new Set();
  for (let i = 0; i < 200; i++) {
    const lead = pickLead(mulberry32(i * 2654435761));
    const ticks = lead / QTE.tick;
    assert.ok(Math.abs(ticks - Math.round(ticks)) < 1e-9,
      `the target must land ON a tick, so "press within one tick of the notch" is literally true (${lead})`);
    assert.ok(Math.round(ticks) >= QTE.targetTicks.min && Math.round(ticks) <= QTE.targetTicks.max,
      `the tick count must stay inside the range (${Math.round(ticks)})`);
    leads.add(Math.round(ticks));
  }
  assert.deepEqual([...leads].sort((a, b) => a - b),
    [QTE.targetTicks.min, QTE.targetTicks.min + 1, QTE.targetTicks.max],
    'every tick count in the range must actually be drawn, or the variation is not real');
});

test('the OPPORTUNITY is identical wherever the target lands — only the timing moves', () => {
  const atMin = createQte({ id: 1, style: 'clock', qteLead: QTE.targetTicks.min * QTE.tick }, 0, {});
  const atMax = createQte({ id: 2, style: 'clock', qteLead: QTE.targetTicks.max * QTE.tick }, 0, {});
  const width = (q) => (q.targetAt + q.goodHalf) - (q.targetAt - q.goodHalf);
  assert.equal(atMin.perfectHalf, atMax.perfectHalf, 'the bands do not resize');
  assert.equal(atMin.goodHalf, atMax.goodHalf);
  assert.ok(Math.abs(width(atMin) - width(atMax)) < 1e-9,
    'every ring must offer the same seconds to press in, however far out the moment is');
  assert.notEqual(atMin.targetAt, atMax.targetAt, 'but the moment itself must move');
  assert.ok(atMax.targetAt > atMin.targetAt);
});

test('no drawn target can let a fresh press be a Good — jumping the gun stays a Miss for every ring', () => {
  for (let i = 0; i < 120; i++) {
    const lead = pickLead(mulberry32(i * 40503 + 7));
    const q = createQte({ id: 3, style: 'closing', qteLead: lead }, 0, {});
    assert.equal(evaluatePress(q, 0.05), 'miss',
      `an early-target ring would teach the wrong input if 0.05 s could score (lead ${lead.toFixed(2)})`);
  }
});

test('createQte: the window is CENTRED on the moment, and the deadline closes the good half', () => {
  const q = createQte({ id: 1, style: 'closing' }, 10, {});
  assert.equal(q.style, 'closing');
  assert.equal(q.targetAt, 10 + QTE.targetTicks.min * QTE.tick, 'the cue resolves one lead after the crossing');
  assert.equal(q.perfectHalf, QTE.perfectHalf);
  assert.equal(q.goodHalf, QTE.goodHalf);
  assert.equal(q.deadline, q.targetAt + QTE.goodHalf, 'the deadline is target + the good half, not target + lead');
  assert.ok(Math.abs(qteRemaining(q, q.targetAt) - QTE.goodHalf) < 1e-9, 'the clock counts down to the deadline');

  // a per-gate lead is used when the gate carries one, and EVERY drawn lead is a whole tick count in range
  const jittered = createQte({ id: 2, style: 'closing', qteLead: 5 * QTE.tick }, 10, {});
  assert.equal(jittered.targetAt, 10 + 5 * QTE.tick, 'the gate provides the moment, so it varies per ring');
  // the clock's counters must exist at birth, or the tick and the beat never edge-trigger (game.js reads
  // them before writing them, and `0 > undefined` is false: the cue would be silent)
  assert.equal(jittered.ticks, 0, 'the tick counter starts at zero');
  assert.equal(jittered.beat, false, 'the beat starts unfired');
  assert.equal(jittered.tick, QTE.tick,
    'the window carries its own tick unit, so the cue, the sounds and the tests never re-read config');
  for (let i = 0; i < 200; i++) {
    const lead = pickLead(mulberry32(i * 104729));
    const ticks = Math.round(lead / QTE.tick);
    assert.ok(Math.abs(lead - ticks * QTE.tick) < 1e-9 && ticks >= QTE.targetTicks.min && ticks <= QTE.targetTicks.max,
      `every drawn lead is a whole tick count inside the range (${lead})`);
  }

  // assist widens the two HALVES — timing, never geometry, and never the moment itself
  const a = createQte({ id: 3, style: 'clock' }, 10, { assist: true });
  assert.ok(Math.abs(a.perfectHalf - QTE.perfectHalf * 1.6) < 1e-9, 'assist widens the perfect half');
  assert.ok(Math.abs(a.goodHalf - QTE.goodHalf * 1.6) < 1e-9, 'assist widens the good half');
  assert.equal(a.targetAt, 10 + QTE.targetTicks.min * QTE.tick, 'assist does not move the moment');
});

test('grading is centred: Perfect on the moment, Good either side, Miss beyond — and a Miss if you jump the gun', () => {
  const mk = (style = 'closing') => createQte({ id: 4, style }, 0, {});
  assert.equal(evaluatePress(mk(), 0), 'miss', 'pressing the instant you cross is now a MISS — the skill is inverted');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick), 'perfect', 'the moment itself is Perfect');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick - QTE.perfectHalf), 'perfect', 'the perfect half is inclusive early');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick + QTE.perfectHalf), 'perfect', '... and inclusive late');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick - QTE.perfectHalf - 0.01), 'good', 'just outside it is still a Good');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick + QTE.perfectHalf + 0.01), 'good');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick + QTE.goodHalf + 0.01), 'miss', 'past the good half is a Miss');
  assert.equal(evaluatePress(mk(), QTE.targetTicks.min * QTE.tick - QTE.goodHalf - 0.01), 'miss', 'and so is far too early');
  assert.equal(evaluatePress(mk('clock'), QTE.targetTicks.min * QTE.tick), 'perfect', 'both styles grade identically');
});

test('a press is final — mashing cannot upgrade a centred window, and it cannot double-grade', () => {
  const q = createQte({ id: 6, style: 'closing' }, 0, {});
  assert.equal(evaluatePress(q, QTE.targetTicks.min * QTE.tick + QTE.perfectHalf + 0.05), 'good');
  assert.equal(evaluatePress(q, QTE.targetTicks.min * QTE.tick), 'good', 'a later, better-timed press must not upgrade the grade');
  const q2 = createQte({ id: 7, style: 'clock' }, 0, {});
  assert.equal(evaluatePress(q2, 0.05), 'miss', 'an early mash is a Miss...');
  assert.equal(evaluatePress(q2, QTE.targetTicks.min * QTE.tick), 'miss', '... and it stays a Miss');
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

// ---- the painted dial + the per-run gate stream (2026-10-22, user-directed) -------------------------
// The user, on the clock cue: "the perfect, good, miss is not randomize they also need to have red
// area(perfect, small) yellow area(good, medium) white area(miss, large) so everytime player pass through
// that ring the game called random seed".
//
// Two things were wrong, and both are contracts here:
//   1. The cue PINNED its bands at 12 o'clock and varied only the needle's speed, so every ring looked
//      identical — the drawn variation was invisible, and the same 0.32 s Perfect window was painted at a
//      different angular size per ring (dishonest).
//   2. The gate stream was seeded from the fixed literal 0x9a7e, so every RUN played identical gates.
//
// The chosen contract (user-approved): the zones keep their true SIZES and the moment MOVES. Sizes are
// the fairness contract — randomising them would randomise difficulty, which was explicitly not chosen.

test('the dial paints the windows at a constant degrees-per-second', () => {
  assert.ok(QTE.dialSeconds > 0, 'the dial needs a scale');
  const a = createQte({ id: 1, style: 'clock', qteLead: 4 * QTE.tick }, 0, {});
  const b = createQte({ id: 2, style: 'clock', qteLead: 6 * QTE.tick }, 0, {});
  const da = dialAngles(a, 0.1), db = dialAngles(b, 0.1);
  assert.equal(da.degPerSec, db.degPerSec,
    'a constant needle speed is what makes the moment POSITION the variable');
  assert.ok(Math.abs(da.degPerSec - 360 / QTE.dialSeconds) < 1e-9);
  // red IS the Perfect window and yellow IS the Good window, in degrees, at every ring
  assert.ok(Math.abs(da.perfectHalfDeg - QTE.perfectHalf * da.degPerSec) < 1e-9);
  assert.ok(Math.abs(da.goodHalfDeg - QTE.goodHalf * da.degPerSec) < 1e-9);
  // the user's read of the three zones: red small, yellow medium, white large
  const red = 2 * da.perfectHalfDeg;
  const yellow = 2 * da.goodHalfDeg;
  const white = 360 - yellow;
  assert.ok(red < yellow, `red (${red.toFixed(0)}°) must read smaller than yellow (${yellow.toFixed(0)}°)`);
  assert.ok(yellow < white, `yellow (${yellow.toFixed(0)}°) must read smaller than the miss field (${white.toFixed(0)}°)`);
});

test('the moment moves every trigger while the zones keep their size', () => {
  const centres = new Set();
  const sizes = new Set();
  for (let i = 0; i < 120; i++) {
    const q = createQte({ id: 3, style: 'clock', qteLead: pickLead(mulberry32(i * 7919 + 11)) }, 0, {});
    const d = dialAngles(q, 0);
    centres.add(d.centre.toFixed(3));
    sizes.add(d.perfectHalfDeg.toFixed(3));
  }
  assert.ok(centres.size >= 3, `the band must sit somewhere different each trigger (${centres.size} positions)`);
  assert.equal(sizes.size, 1, '...and the zone SIZES must never change: that is the fairness contract');
});

test('the needle is inside the red zone exactly when that press would grade Perfect', () => {
  // The drawn geometry and the grader express the same boundary two ways — (target - half) * degPerSec
  // versus target * degPerSec - half * degPerSec — which differ by ~1e-15 in IEEE-754. evaluatePress
  // carries a 1e-9 slack for the same reason, so the contract is stated with THAT slack rather than an
  // exact comparison: the zone edge is where the grader's window edge is, to within the grader's own
  // tolerance.
  const SLACK = 1e-9;
  const inside = (deg, centre, half) => deg >= centre - half - SLACK && deg <= centre + half + SLACK;
  for (let i = 0; i < 60; i++) {
    const q = createQte({ id: 4, style: 'clock', qteLead: pickLead(mulberry32(i * 104729 + 3)) }, 100, {});
    const target = q.targetAt - q.startedAt;
    for (const off of [-0.9, -0.38, -0.16, -0.01, 0, 0.01, 0.16, 0.38, 0.9]) {
      const d = dialAngles(q, target + off);
      const graded = evaluatePress({ ...q, resolved: false, result: null }, q.startedAt + target + off);
      assert.equal(inside(d.needle, d.centre, d.perfectHalfDeg), graded === 'perfect',
        `the red zone must BE Perfect (off ${off}s graded ${graded})`);
      assert.equal(inside(d.needle, d.centre, d.goodHalfDeg), graded !== 'miss',
        `the yellow zone must BE pressable (off ${off}s graded ${graded})`);
    }
  }
});

test('assist widens the painted zones and never the moment', () => {
  const plain = createQte({ id: 5, style: 'clock', qteLead: 5 * QTE.tick }, 0, {});
  const assisted = createQte({ id: 6, style: 'clock', qteLead: 5 * QTE.tick }, 0, { assist: true });
  const a = dialAngles(plain, 0), b = dialAngles(assisted, 0);
  assert.equal(a.centre, b.centre, 'the moment itself never moves for assist');
  assert.ok(b.perfectHalfDeg > a.perfectHalfDeg && b.goodHalfDeg > a.goodHalfDeg,
    'but the zones it rides in are wider, so the cue shows assist honestly');
});

test('the gate stream is seeded from the RUN seed: a fresh run differs, a pinned seed reproduces', () => {
  const leads = (seed) => {
    const rng = gateRngFor(seed);
    return Array.from({ length: 5 }, () => pickLead(rng));
  };
  assert.deepEqual(leads(1337), leads(1337), 'a pinned seed must reproduce its gates exactly');
  const differing = [1337, 4242, 99, 7].map((s) => leads(s).join(','));
  assert.ok(new Set(differing).size >= 3,
    `different runs must not play identical gates (${differing.join(' | ')})`);
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


