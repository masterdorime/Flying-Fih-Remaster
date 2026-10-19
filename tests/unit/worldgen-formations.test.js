// Formation library corpus (2026-10-18 spec §9): weighted difficulty-gated
// roster — breather/wideGate/offsetTurn/fork/chicane/riskLane — with a
// no-immediate-repeat guard and a speed tilt toward wide paths. Fairness
// floors (1.2 s / 1.35 s windows, 22 m spacing, chain reachability, 3 m gaps)
// are owned by worldgen-fairness.test.js and stay untouched; this file owns
// the formation-level contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeChunk, generateChunk } from '../../js/worldgen.js';
import { FORMATIONS } from '../../js/config.js';

// Walk N chunks the way world.js does: thread the compose state (including
// formation state) across chunk boundaries.
//
// `forms` is per OBSTACLE and `rows` is per ROW — the difference matters: a wall
// row carries many obstacles, so consecutive `forms` entries frequently share an
// id without any formation repeat. `breathers` is the walk total (formOut
// accumulates it, so only the final chunk's value is the total).
function walk(i0, n, d, seed, speed) {
  let state = null;
  const forms = [];
  const rows = [];
  let formOut = null;
  for (let i = i0; i < i0 + n; i++) {
    const out = composeChunk(i, d, seed, speed, state);
    state = {
      cursor: out.cursorOut,
      prevRow: out.prevRowState,
      prevSlalomSign: out.prevSlalomSign,
      form: out.formOut || state && state.form && { ...state.form, seq: [], id: null },
    };
    formOut = out.formOut || formOut;
    for (const o of out.obstacles) forms.push(o.form);
    // rows are pushed contiguously, so grouping by rowZ recovers them exactly
    const byRow = new Map();
    for (const o of out.obstacles) {
      const k = (o.rowZ ?? 0).toFixed(3);
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(o);
    }
    for (const [, row] of byRow) rows.push({ id: row[0].form ?? null, n: row.length, pick: row[0].formPick ?? null });
  }
  return { forms, rows, breathers: formOut ? (formOut.breathers || 0) : 0, state };
}

const GATED = ['wideGate', 'offsetTurn', 'fork', 'chicane', 'riskLane'];
const SEEDS = [1, 7, 13, 42, 99, 777, 1337, 2024, 4242, 1987, 65535, 314159];

test('roster config exists with the approved gating values', () => {
  for (const id of [...GATED, 'slalom', 'wall', 'center', 'cluster', 'breather']) {
    const f = FORMATIONS.roster[id];
    assert.ok(f && typeof f.weight === 'number' && typeof f.minD === 'number', `roster entry ${id}`);
  }
  assert.equal(FORMATIONS.roster.cluster.minD, 0.25);
  assert.equal(FORMATIONS.roster.wideGate.minD, 0.35);
  assert.equal(FORMATIONS.roster.fork.minD, 0.55);
  assert.equal(FORMATIONS.roster.riskLane.minD, 0.7);
});

test('every gated formation appears and no formation repeats back-to-back (d 1.0)', () => {
  for (const seed of SEEDS) {
    const { rows } = walk(0, 30, 1.0, seed, 60);
    // Adjacency is measured in PICKS, not rows: a breather (or a failed window)
    // consumes a pick and leaves no obstacle, so rows either side of it are not
    // consecutive picks. A multi-window formation's rows share one pick number.
    let prev = null, run = 0;
    for (const r of rows) {
      if (!r.id) continue;
      const entry = FORMATIONS.roster[r.id];
      assert.ok(entry, `unknown form tag ${r.id}`);
      const continuation = prev && r.pick === prev.pick;      // the same formation's next window
      const adjacentPick = prev && r.pick === prev.pick + 1;  // the very next pick
      if (adjacentPick) {
        assert.notEqual(r.id, prev.id, `${r.id} repeats immediately into itself (seed ${seed})`);
      }
      if (continuation) {
        assert.equal(r.id, prev.id, `pick ${r.pick} changed formation mid-window (seed ${seed})`);
        run++;
        assert.ok(run <= entry.windows,
          `${r.id} runs ${run} windows but declares ${entry.windows} window(s) (seed ${seed})`);
      } else {
        run = 1;
      }
      prev = r;
    }
  }
  // coverage across the sweep: each gated formation unlocked somewhere at d 1.0
  const seen = new Set();
  for (const seed of SEEDS) for (const r of walk(0, 24, 1.0, seed, 60).rows) if (r.id) seen.add(r.id);
  for (const g of GATED) assert.ok(seen.has(g), `gated formation ${g} never appears at d 1.0`);
});

test('gating: nothing but basics below the unlock difficulty (d 0.2)', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    for (const r of walk(0, 30, 0.2, seed, 40).rows) if (r.id) seen.add(r.id);
  }
  for (const g of GATED) assert.ok(!seen.has(g), `${g} appears at d 0.2 (minD > 0.2)`);
  for (const b of ['slalom', 'wall', 'center']) {
    assert.ok(seen.has(b), `basic ${b} never appears at d 0.2`);
  }
});

test('speed tilt: wide paths and intentional breathers rise with compose speed (d 0.9)', () => {
  // Measured per ROW, never per chunk: at 110 u/s one window (132 m) exceeds the
  // 120 m chunk, so most chunks hold a single row and a per-chunk share measures
  // row DENSITY, not the tilt. Absolute breather counts are confounded the same
  // way (fewer windows at speed, not fewer breathers per pick) — hence rates.
  const WIDE = new Set(['wideGate', 'fork']);
  const rate = (speed) => {
    let rows = 0, wide = 0, breathers = 0;
    for (const seed of SEEDS) {
      const w = walk(0, 16, 0.9, seed, speed);
      rows += w.rows.length;
      wide += w.rows.filter(r => WIDE.has(r.id)).length;
      breathers += w.breathers;
    }
    return { rows, wideShare: wide / rows, breatherRate: breathers / rows };
  };

  const slow = rate(25);
  const fast = rate(110);
  assert.ok(fast.wideShare > slow.wideShare,
    `wide share must rise with speed: ${fast.wideShare.toFixed(3)} <= ${slow.wideShare.toFixed(3)}`);
  assert.ok(fast.breatherRate > slow.breatherRate,
    `intentional breather rate must rise with speed: ${fast.breatherRate.toFixed(3)} <= ${slow.breatherRate.toFixed(3)}`);
});

test('formation stream is deterministic per seed and varies across seeds', () => {
  const a = walk(0, 20, 0.8, 1234, 70);
  const b = walk(0, 20, 0.8, 1234, 70);
  assert.deepEqual(a, b, 'same seed ⇒ identical formation stream');
  const c = walk(0, 20, 0.8, 4321, 70);
  assert.notDeepEqual(a, c, 'different seed ⇒ different formation stream');
});

test('per-chunk replay stays coherent: generateChunk matches the streamed walk bodies', () => {
  // the replay path must thread formation state identically to world.js
  // (chunk 6's composition must not depend on whether the caller streamed).
  for (const seed of [42, 1337, 9876]) {
    const streamed = composeChunk(6, 0.7, seed, 55, walk(0, 6, 0.7, seed, 55).state);
    const replayed = generateChunk(6, 0.7, seed, 55);
    assert.deepEqual(streamed, replayed, `seed ${seed} chunk-6 divergence`);
  }
});
