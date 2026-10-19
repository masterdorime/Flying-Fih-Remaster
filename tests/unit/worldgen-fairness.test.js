// Stage 1 fairness corpus tests (2026-10-18 spec — see
// docs/superpowers/specs/2026-10-18-obstacle-fairness-design.md).
// RED-first: these encode the APPROVED budget (1.2 s rows / 1.35 s after
// walls / 22 m floor / add-only jitter / chain reachability / honest hull
// capsules) and fail against the 0.35 s sphere-era generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, validateChunkGaps, WORLD_HALF } from '../../js/worldgen.js';
import * as W from '../../js/worldgen.js';
import { WORLD, PATTERN } from '../../js/config.js';

const ROW_WINDOW = 1.2;         // approved budget
const WALL_WINDOW = 1.35;       // after wall-type rows
const REACTION = 0.25;          // human reaction allowance
const MARGIN = 0.15;            // chain-check margin
const EPS = 1e-6;
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 1337];
const DIFFS = [0.3, 0.6, 1.0];
const SPEEDS = [25, 35, 50, 70, 110];

// A corpus helper: 5 consecutive chunks as absolute z obstacles.
// Compose-only rules: composeChunk keeps the generateChunk signature pure via
// internal cursor replay, so generateChunk keeps exact per-chunk determinism
// even with cross-chunk cursor semantics.
function corpus(seed, d, speed, chunks = 5) {
  const seq = [];
  for (let i = 0; i < chunks; i++) {
    const c = generateChunk(i, d, seed, speed);
    for (const o of c.obstacles) seq.push({ ...o, absZ: o.z + i * WORLD.chunkLength, chunk: i });
  }
  return seq.sort((a, b) => a.absZ - b.absZ);
}

// Nominal row anchors: group by rowZ (each obstacle carries its row's anchor)
function rowAnchors(seq) {
  const byRow = new Map();
  for (const o of seq) {
    const key = `${o.chunk}:${o.rowZ}`;
    if (!byRow.has(key)) byRow.set(key, { chunk: o.chunk, rowZ: o.rowZ, obstacles: [], wall: false });
    const row = byRow.get(key);
    row.obstacles.push(o);
    if (o.pattern === 'wall') row.wall = true;
  }
  return [...byRow.values()].sort((a, b) => (a.rowZ + a.chunk * WORLD.chunkLength) - (b.rowZ + b.chunk * WORLD.chunkLength));
}

test('rows carry a nominal anchor (rowZ) matching their z', () => {
  const seq = corpus(1337, 0.6, 50);
  assert.ok(seq.length, 'corpus has obstacles');
  for (const o of seq) {
    assert.equal(typeof o.rowZ, 'number', `obstacle carries rowZ (kind=${o.kind})`);
    const absRowZ = o.rowZ + o.chunk * WORLD.chunkLength;
    assert.ok(Math.abs(absRowZ - o.absZ) <= 2.01, `inline members stay within ±2 of the nominal row (dz=${Math.abs(absRowZ - o.absZ).toFixed(2)})`);
  }
});

test('window corpus: ≥1.2 s between consecutive rows, ≥1.35 s after walls, every speed/difficulty/seed', () => {
  for (const speed of SPEEDS) {
    for (const seed of SEEDS) {
      for (const d of DIFFS) {
        const rows = rowAnchors(corpus(seed, d, speed));
        for (let n = 1; n < rows.length; n++) {
          const prev = rows[n - 1], row = rows[n];
          const dz = (row.rowZ + row.chunk * WORLD.chunkLength) - (prev.rowZ + prev.chunk * WORLD.chunkLength);
          const need = (prev.wall ? WALL_WINDOW : ROW_WINDOW) * speed;
          assert.ok(
            dz >= need - EPS,
            `seed ${seed} d=${d} speed=${speed} rows n=${n}: dz=${dz.toFixed(1)} < ${(need).toFixed(1)}`,
          );
        }
      }
    }
  }
});

test('no bunching: the 22 m floor holds and rows never jam at a chunk tail', () => {
  for (const speed of SPEEDS) {
    for (const seed of SEEDS) {
      for (const d of DIFFS) {
        const rows = rowAnchors(corpus(seed, d, speed));
        for (let n = 1; n < rows.length; n++) {
          const prev = rows[n - 1], row = rows[n];
          const dz = (row.rowZ + row.chunk * WORLD.chunkLength) - (prev.rowZ + prev.chunk * WORLD.chunkLength);
          assert.ok(dz >= PATTERN.spacingMin - EPS, `seed ${seed} d=${d} speed=${speed} n=${n}: dz=${dz.toFixed(1)} < ${PATTERN.spacingMin}`);
        }
      }
    }
  }
});

test('rows belong to their chunk span and chunks stay valid', () => {
  for (const speed of SPEEDS) {
    for (const seed of SEEDS.slice(0, 4)) {
      for (const d of DIFFS) {
        for (let i = 0; i < 5; i++) {
          const c = generateChunk(i, d, seed, speed);
          for (const o of c.obstacles) {
            assert.ok(o.z > 0 && o.z <= WORLD.chunkLength, `chunk ${i} obstacle z=${o.z.toFixed(1)} leaves its span`);
          }
          assert.ok(validateChunkGaps(c), `chunk ${i} d=${d} speed=${speed} invalid`);
        }
      }
    }
  }
});

test('transitTime matches the closed-form first-order settle', () => {
  const transit = W.transitTime ?? null;
  if (!transit) assert.fail('worldgen.transitTime not implemented');
  // analytic: x(t) = cap * (t - (1 - e^(-6t)) / 6) from rest
  const analytic = (dx, cap) => {
    const f = t => cap * (t - (1 - Math.exp(-6 * t)) / 6) - dx;
    let lo = 0, hi = 30;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  for (const [dx, cap] of [[14.28, 39.6], [8, 79.2], [22.6, 110], [2, 39.6], [40, 110]]) {
    const t = transit(dx, cap);
    const tA = analytic(dx, cap);
    assert.ok(Math.abs(t - tA) <= 2.5 / 60, `transit(${dx}, ${cap}) = ${t.toFixed(4)} vs analytic ${tA.toFixed(4)}`);
  }
  assert.equal(transit(0, 39.6), 0);
});

test('steerCap buckets match TIER_PROFILE steering', () => {
  const steerCap = W.steerCap ?? null;
  if (!steerCap) assert.fail('worldgen.steerCap not implemented');
  assert.equal(steerCap(25), 120 * 0.6 * 0.55);
  assert.equal(steerCap(50), 160 * 0.9 * 0.55);
  assert.equal(steerCap(110), 200 * 1.0 * 0.55);
});

test('chainReachable: true for a generous pair, false for the unreachable corpus case', () => {
  const chainReachable = W.chainReachable ?? null;
  if (!chainReachable) assert.fail('worldgen.chainReachable not implemented');
  const at = (x, r) => ({ x, radius: r, z: 50, moving: false });
  // generous: 8 m lateral, big corridor past the hull edges at 25 u/s
  assert.equal(chainReachable([at(-10, 2)], [at(2, 2)], 150, 25), true);
  // unreachable: 16 m lateral, 10 m at 25 u/s minus reaction+margin < 0
  assert.equal(chainReachable([at(-10, 2)], [at(6, 2)], 10, 25), false);
  // blocked-next-row counts: the gap must be STEERABLE-TO in its window
  // (hull edges eat 2 m of the 20 m dz: corridor 16 → 0.24 s after allowances;
  // 4 m lateral at 39.6 u/s settles in ~0.13 s ✓)
  assert.equal(chainReachable([at(-10, 2)], [at(-11, 2), at(11, 2)], 20, 25), true);
  // tighter dz leaves no corridor time → false
  assert.equal(chainReachable([at(-10, 2)], [at(-11, 2), at(11, 2)], 12, 25), false);
});

test('fairness corpus: zero unreachable chains across every speed/difficulty/seed', () => {
  const chainReachable = W.chainReachable ?? null;
  if (!chainReachable) assert.fail('worldgen.chainReachable not implemented');
  let pairs = 0;
  for (const speed of SPEEDS) {
    for (const seed of SEEDS) {
      for (const d of DIFFS) {
        const rows = rowAnchors(corpus(seed, d, speed));
        for (let n = 1; n < rows.length; n++) {
          const prev = rows[n - 1], row = rows[n];
          const dz = (row.rowZ + row.chunk * WORLD.chunkLength) - (prev.rowZ + prev.chunk * WORLD.chunkLength);
          pairs++;
          assert.ok(
            chainReachable(prev.obstacles, row.obstacles, dz, speed),
            `seed ${seed} d=${d} speed=${speed} pair n=${n} unreachable (dz=${dz.toFixed(1)})`,
          );
        }
      }
    }
  }
  assert.ok(pairs > 200, `corpus exercised (${pairs} pairs)`);
});

test('honest hull capsules: specs carry rx/rz/variant from measured bounds', () => {
  for (const o of corpus(1337, 1.0, 50, 3)) {
    assert.equal(typeof o.rx, 'number', `${o.kind} carries rx`);
    assert.equal(typeof o.rz, 'number', `${o.kind} carries rz`);
    assert.ok(o.variant, `${o.kind} binds a visual variant`);
    // measured Stage 0 bounds: widest variant half-beam + 0.3 grace
    // honest per-variant rx: measured half-beam + 0.3 (boat variants span
    // 1.8 sail .. 2.84 speed-c; test the kind's honest range)
    if (o.kind === 'ship') assert.ok(o.rx <= 3.6 + EPS && o.rx >= 3.0, `ship rx=${o.rx}`);
    if (o.kind === 'boat') assert.ok(o.rx <= 2.84 + EPS && o.rx >= 1.7, `boat rx=${o.rx}`);
    if (o.kind === 'buoy') assert.ok(o.rx <= 1.0 + EPS && o.rx >= 0.7, `buoy rx=${o.rx}`);
  }
});

test('variant + capsule dims are deterministic per seed', () => {
  const a = generateChunk(4, 0.7, 91, 50);
  const b = generateChunk(4, 0.7, 91, 50);
  assert.deepEqual(a.obstacles.map(o => [o.kind, o.variant, o.rx, o.rz]), b.obstacles.map(o => [o.kind, o.variant, o.rx, o.rz]));
});

test('capsule hit math: honest side miss, honest tip hit', () => {
  const capsuleHit = W.capsuleHit ?? null;
  if (!capsuleHit) assert.fail('worldgen.capsuleHit not implemented');
  // liner-class hull: half-beam 1.79 + 0.3 grace, half-length 8 + 0.4 slack
  const liner = { kind: 'rock', x: 0, z: 0, rx: 2.09, rz: 8.4, radius: 4.0 };
  // side pass just outside the capsule + fish radius → MISS (was: sphere hit)
  assert.equal(capsuleHit(2.09 + 0.3 + 1.1 + 0.01, 0, liner, 1.1), false, 'side pass outside capsule misses');
  assert.equal(capsuleHit(2.09, 0, liner, 1.1), true, 'side overlap hits');
  // head-on into the bow inside tip slack → HIT
  assert.equal(capsuleHit(0, 8.4 + 1.1 - 0.05, liner, 1.1), true, 'bow contact hits');
  assert.equal(capsuleHit(0, 8.4 + 1.1 + 0.5, liner, 1.1), false, 'tip beyond slack misses');
});

// 2026-10-18 stage B (spec §9): the floors above are asserted over `corpus`,
// which now composes through the formation roster. Proving every gated shape
// appears in that same corpus is what turns "the floors hold" into "the floors
// hold FOR EACH gated formation" rather than only for whichever shapes happened
// to be sampled.
test('formation coverage: every gated formation is exercised by the legality corpus', () => {
  const GATED = ['wideGate', 'offsetTurn', 'fork', 'chicane', 'riskLane'];
  const seen = new Set();
  for (const speed of SPEEDS) {
    for (const seed of SEEDS) {
      for (const d of DIFFS) {
        for (const o of corpus(seed, d, speed)) if (o.form) seen.add(o.form);
      }
    }
  }
  for (const g of GATED) {
    assert.ok(seen.has(g), `gated formation ${g} never appears in the legality corpus`);
  }
});
