import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, validateChunkGaps, difficultyAt, mulberry32, lerp, RADIUS_TABLE, findClearLane } from '../../js/worldgen.js';
import { WORLD, PATTERN } from '../../js/config.js';

test('difficulty ramps by distance and time, capped at 1', () => {
  assert.equal(difficultyAt(0, 0), 0);
  assert.equal(difficultyAt(99999, 99999), 1);
  assert.ok(difficultyAt(1000, 0) > difficultyAt(500, 0));
  assert.ok(difficultyAt(0, 45) > difficultyAt(0, 10));
});

test('chunks are deterministic for a seed and speed', () => {
  const a = generateChunk(3, 0.5, 42, 25);
  const b = generateChunk(3, 0.5, 42, 25);
  assert.deepEqual(a.obstacles, b.obstacles);
});

test('ocean obstacles are grounded: nothing floats below the clouds (2026-10-14)', () => {
  // the retired `elevated` branch spawned props at y 8-24 — floating clutter
  // below the cloud curtain. All ocean hazards must sit at the water line.
  const MAX_Y = 2.5;
  for (let d = 0; d <= 1.0001; d += 0.05) {
    for (let i = 0; i < 200; i++) {
      for (const o of generateChunk(i, d, 9, 25).obstacles) {
        assert.ok(o.y <= MAX_Y, `chunk ${i} d=${d} ${o.kind} floats at y=${o.y.toFixed(2)}`);
        assert.ok(o.y >= 0, `chunk ${i} d=${d} ${o.kind} spawns below the water (y=${o.y.toFixed(2)})`);
      }
    }
  }
});

test('validator: blocked row fails, gapped rows pass, exact boundary holds', () => {
  const at = (x, r) => ({ x, radius: r, z: 50, moving: false });
  assert.equal(validateChunkGaps({ obstacles: [
    at(-10.5, 3.5), at(-3.5, 3.5), at(3.5, 3.5), at(10.5, 3.5),
  ] }), false); // fully fenced: every gap is 0
  assert.equal(validateChunkGaps({ obstacles: [
    at(-11.5, 3), at(-5, 3), at(5, 3), at(11.5, 3),
  ] }), true); // 4 m center gap; neighbours clear each other's hulls by 0.5 m
  assert.equal(validateChunkGaps({ obstacles: [at(-8, 6), at(7, 6)] }), true); // max gap exactly 3.0
  assert.equal(validateChunkGaps({ obstacles: [at(-8, 6), at(6.9, 6)] }), false); // max gap 2.9
});

test('validator: movers are judged by their swept envelope', () => {
  const stat = (x, r) => ({ x, radius: r, z: 50, moving: false });
  const mov = (x, r, range) => ({ x, radius: r, z: 50, moving: true, range });
  assert.equal(validateChunkGaps({ obstacles: [stat(-12, 2), mov(0, 2, 4), stat(12, 2)] }), true);
  assert.equal(validateChunkGaps({ obstacles: [stat(-12, 2), mov(0, 2, 6), stat(12, 2)] }), false);
  // two out-of-phase movers: envelopes [-6.5,-1.5] and [1.5,6.5] hold 3 m gaps
  assert.equal(validateChunkGaps({ obstacles: [
    stat(-12, 2.5), mov(-4, 2, 0.5), mov(4, 2, 0.5), stat(12, 2.5),
  ] }), true);
  // …but widen the sweep and the envelope closes the row
  assert.equal(validateChunkGaps({ obstacles: [
    stat(-12, 2.5), mov(-4, 2, 2), mov(4, 2, 2), stat(12, 2.5),
  ] }), false);
});

test('every generated chunk is valid, at every difficulty and speed', () => {
  for (const speed of [8, 25, 110]) {
    for (let d = 0; d <= 1.0001; d += 0.1) {
      for (let i = 0; i < 40; i++) {
        const c = generateChunk(i, d, 7, speed);
        assert.ok(validateChunkGaps(c), `chunk ${i} d=${d.toFixed(1)} speed=${speed} invalid`);
      }
    }
  }
});

test('patterns: walls hold a swimmable gap, slaloms alternate, center gets occupied', () => {
  const seen = new Set();
  let totalSlalom = 0, centerSeen = false;
  for (let i = 0; i < 30; i++) {
    const signs = [];
    for (const o of generateChunk(i, 0.5, 1337, 25).obstacles) {
      seen.add(o.pattern);
      if (o.pattern === 'slalom') signs.push(Math.sign(o.x));
      if (Math.abs(o.x) + o.radius < 5) centerSeen = true;
    }
    assert.ok(signs.every((s, k) => k === 0 || s !== signs[k - 1]), `slalom rows alternate in chunk ${i}`);
    totalSlalom += signs.length;
  }
  assert.ok(seen.size >= 2, `at least two pattern shapes appear (${[...seen]})`);
  assert.ok(totalSlalom >= 2, 'slalom rows occurred');
  assert.ok(centerSeen, 'the old corridor gets occupied');
  // every wall row keeps a swimmable gap — measured with the honest capsule
  // beams (rx ?? radius), the same clearance the fish actually crosses (a
  // wallMax-truncated wall may show a second gap — fairer, not a failure —
  // so this asserts max gap, not exactly one)
  for (let i = 0; i < 60; i++) {
    const walls = generateChunk(i, 0.8, 21, 40).obstacles.filter(o => o.pattern === 'wall');
    const rows = [];
    for (const o of [...walls].sort((a, b) => a.z - b.z)) {
      const row = rows.find(r => Math.abs(r[0].z - o.z) <= 5);
      (row ?? rows[rows.push([]) - 1]).push(o);
    }
    for (const row of rows) {
      const iv = row.map(o => { const r = o.rx ?? o.radius; return [o.x - r, o.x + r]; }).sort((a, b) => a[0] - b[0]);
      let maxGap = Math.max(0, iv[0][0] + 14);
      for (let k = 1; k < iv.length; k++) maxGap = Math.max(maxGap, iv[k][0] - iv[k - 1][1]);
      maxGap = Math.max(maxGap, 14 - iv[iv.length - 1][1]);
      assert.ok(maxGap >= 3.2, `wall row keeps a swimmable gap (${maxGap.toFixed(2)})`);
    }
  }
});

test('rows obey the fairness window, capped by the chunk fit (2026-10-18)', () => {
  const rowsOf = (c) => {
    const zs = [...c.obstacles].sort((a, b) => a.z - b.z).map(o => o.z);
    let n = 0, last = -1e9;
    for (const z of zs) { if (z - last > 5) { n++; last = z; } }
    return n;
  };
  // row windows: speed × 1.2 s with the 22 m floor — chunk-local and cursor
  // threaded, so counts follow the window, not a difficulty-driven quota
  const windowAt = (speed) => Math.max(speed * PATTERN.rowWindowSeconds, PATTERN.spacingMin);
  for (const speed of [25, 50, 110]) {
    const w = windowAt(speed);
    for (const d of [0, 0.5, 1]) {
      const c = generateChunk(1, d, 5, speed);
      const fits = 1 + Math.floor((WORLD.chunkLength - PATTERN.rowZ0) / w);
      assert.ok(rowsOf(c) <= fits, `chunk rows stay within the window fit (speed ${speed} d ${d}: ${rowsOf(c)} ≤ ${fits})`);
    }
  }
  assert.ok(rowsOf(generateChunk(1, 1, 5, 25)) >= 2, 'dense swimming keeps patterned rows');
  const slow = generateChunk(2, 0.5, 9, 8).obstacles.map(o => o.z.toFixed(2)).join();
  const fast = generateChunk(2, 0.5, 9, 110).obstacles.map(o => o.z.toFixed(2)).join();
  assert.notEqual(slow, fast); // spacing follows speed at fixed seed
});

test('obstacles stay within the lane bounds', () => {
  // single-seed spot check (historical shape of this test)
  const chunk = generateChunk(9, 1, 3, 25);
  for (const o of chunk.obstacles) {
    assert.ok(Math.abs(o.x) <= WORLD.laneHalfWidth, 'x within lane');
    assert.ok(o.z > 0 && o.z <= WORLD.chunkLength, 'z within chunk');
    assert.ok(o.kind in { rock: 1, buoy: 1, boat: 1, container: 1, ship: 1 }, 'known kind');
  }
  // sweep: wall pieces must never land outside the lane (the fill cursor runs
  // past ±14 while centers may not)
  for (const speed of [8, 25, 110]) {
    for (let d = 0; d <= 1.0001; d += 0.1) {
      for (let i = 0; i < 40; i++) {
        for (const o of generateChunk(i, d, 11, speed).obstacles) {
          assert.ok(Math.abs(o.x) <= WORLD.laneHalfWidth, `chunk ${i} ${o.pattern} at x=${o.x.toFixed(2)} escapes the lane`);
        }
      }
    }
  }
});

test('mulberry32 produces stable 0..1 values', () => {
  const r = mulberry32(99);
  const v = r();
  assert.ok(v >= 0 && v < 1);
  assert.equal(mulberry32(99)(), v);
});

test('lerp helper', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
});

test('PATTERN config carries the fairness numbers', () => {
  assert.equal(PATTERN.minGap, 3.0);
  assert.equal(PATTERN.rowBand, 5);
});

test('legacy sphere roster retained; honest HULLS capsule table governs collision (2026-10-18)', () => {
  assert.equal(RADIUS_TABLE.rock, 4.0); // legacy/debug surface (spec.radius fallback)
  assert.equal(RADIUS_TABLE.ship, 6.5);
  assert.equal(RADIUS_TABLE.boat, 3.4);
  assert.equal(RADIUS_TABLE.buoy, 1.1);
  assert.equal(RADIUS_TABLE.container, 2.2);
});

test('ships sail at high difficulty', () => {
  let seen = false;
  for (let i = 0; i < 60 && !seen; i++) {
    for (const o of generateChunk(i, 1, 31, 40).obstacles) {
      if (o.kind === 'ship') { seen = true; break; }
    }
  }
  assert.ok(seen, 'a ship appears within 60 high-difficulty chunks');
  let early = false;
  for (let i = 0; i < 60 && !early; i++) {
    for (const o of generateChunk(i, 0.2, 31, 25).obstacles) {
      if (o.kind === 'ship') { early = true; break; }
    }
  }
  assert.ok(!early, 'no ships below difficulty 0.6');
});

test('findClearLane: the coin trail starts on the clearest line through its span', () => {
  assert.deepEqual(findClearLane([], 100, 124), { x: 0, clearance: Infinity });

  // a fenced row mid-span with a 4 m gap centered at x 4
  const wall = [
    { x: -10, z: 110, radius: 2 }, { x: -6, z: 110, radius: 2 },
    { x: 0, z: 110, radius: 2 }, { x: 8, z: 110, radius: 2 }, { x: 13, z: 110, radius: 1.5 },
  ];
  const lane = findClearLane(wall, 100, 124);
  assert.ok(Math.abs(lane.x - 4) <= 0.5, `gap center wins (x=${lane.x})`);
  assert.ok(lane.clearance >= 2 - 1e-9, `gap clearance reported (${lane.clearance})`);

  // sweep envelope: a fat disc fences its whole range — the lane clears it
  const sweep = [{ x: 0, z: 110, radius: 10 }];
  const l2 = findClearLane(sweep, 100, 124);
  assert.ok(l2.clearance >= 4, `lane clears the full sweep (${l2.clearance})`);
  assert.ok(Math.abs(l2.x) >= 13, `pushed to the lane edge (x=${l2.x})`);
});

// ---------------------------------------------------------------------------
// 2026-10-17 — no-tangle rule: swept envelopes must never interpenetrate.
// Ships are 9-18 m hulls on 4 m hitboxes; random yaw made them lie across the
// lane and fuse into neighbours. The validator now rejects fused rows, and the
// generators must place discs that can actually separate.
// ---------------------------------------------------------------------------

test('validator: interpenetrating envelopes fail even when a gap exists elsewhere', () => {
  const at = (x, r, z = 50) => ({ x, radius: r, z, moving: false });
  const mov = (x, r, range, z = 50) => ({ x, radius: r, z, moving: true, range });
  // two fused hulls at the left, 10 m of open water to the right — the gap
  // rule alone passes this; the no-tangle rule must reject it
  assert.equal(validateChunkGaps({ obstacles: [at(-6, 4), at(0, 4), at(13, 1)] }), false);
  // a mover's sweep plows into a static neighbour mid-sweep
  assert.equal(validateChunkGaps({ obstacles: [mov(1, 2, 5), at(8, 2), at(-13, 1)] }), false);
  // exact 2D separation: z distance can legitimately rescue a narrow x gap
  assert.equal(validateChunkGaps({ obstacles: [at(-3.5, 4, 47.5), at(3.5, 4, 52.5), at(-13, 1)] }), true);
});

test('no generated row ever interpenetrates (pairwise honest-hull clearance)', () => {
  const sweepOf = (o) => (o.moving ? o.range : 0);
  // capsule-aware separation (2026-10-18): lateral needs rx; z clearance may
  // absorb the hull half-lengths; radius-only fixtures degrade to spheres
  const minPairDist = (a, b) => {
    const dx = Math.max(0, Math.abs(a.x - b.x) - sweepOf(a) - sweepOf(b));
    const rzA = a.rz ?? a.radius, rzB = b.rz ?? b.radius;
    const dz = Math.max(0, Math.abs(a.z - b.z) - rzA - rzB);
    return Math.hypot(dx, dz);
  };
  for (const speed of [18, 30]) {
    for (let d = 0; d <= 1.0001; d += 0.25) {
      for (let i = 0; i < 60; i++) {
        const chunk = generateChunk(i, d, i * 7 + 3, speed);
        assert.ok(validateChunkGaps(chunk), `chunk ${i} d=${d.toFixed(2)} speed=${speed} must validate`);
        const sorted = [...chunk.obstacles].sort((a, b) => a.z - b.z);
        let row = [], prevZ = -1e9;
        const checkRow = () => {
          for (let a = 0; a < row.length; a++) {
            for (let b = a + 1; b < row.length; b++) {
              const rxA = row[a].rx ?? row[a].radius, rxB = row[b].rx ?? row[b].radius;
              const need = rxA + rxB;
              const dist = minPairDist(row[a], row[b]);
              assert.ok(dist >= need - 1e-9,
                `chunk ${i} d=${d.toFixed(2)}: ${row[a].kind}@(${row[a].x.toFixed(1)},${row[a].z.toFixed(1)}) fuses ${row[b].kind}@(${row[b].x.toFixed(1)},${row[b].z.toFixed(1)}) dist=${dist.toFixed(2)} need=${need.toFixed(2)}`);
            }
          }
        };
        for (const o of sorted) {
          if (o.z - prevZ > PATTERN.rowBand) { checkRow(); row = []; }
          row.push(o); prevZ = o.z;
        }
        checkRow();
      }
    }
  }
});
