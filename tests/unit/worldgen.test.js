import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, validateChunkGaps, difficultyAt, mulberry32, lerp, RADIUS_TABLE } from '../../js/worldgen.js';
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
    at(-11, 3), at(-5, 3), at(5, 3), at(11, 3),
  ] }), true); // 4 m center gap
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
  // every wall row keeps a swimmable gap (a wallMax-truncated wall may show a
  // second gap — fairer, not a failure — so this asserts max gap, not exactly one)
  for (let i = 0; i < 60; i++) {
    const walls = generateChunk(i, 0.8, 21, 40).obstacles.filter(o => o.pattern === 'wall');
    const rows = [];
    for (const o of [...walls].sort((a, b) => a.z - b.z)) {
      const row = rows.find(r => Math.abs(r[0].z - o.z) <= 5);
      (row ?? rows[rows.push([]) - 1]).push(o);
    }
    for (const row of rows) {
      const iv = row.map(o => [o.x - o.radius, o.x + o.radius]).sort((a, b) => a[0] - b[0]);
      let maxGap = Math.max(0, iv[0][0] + 14);
      for (let k = 1; k < iv.length; k++) maxGap = Math.max(maxGap, iv[k][0] - iv[k - 1][1]);
      maxGap = Math.max(maxGap, 14 - iv[iv.length - 1][1]);
      assert.ok(maxGap >= 3.2, `wall row keeps a swimmable gap (${maxGap.toFixed(2)})`);
    }
  }
});

test('row budget scales with difficulty, capped by speed-spaced fit', () => {
  const rowsOf = (c) => {
    const zs = [...c.obstacles].sort((a, b) => a.z - b.z).map(o => o.z);
    let n = 0, last = -1e9;
    for (const z of zs) { if (z - last > 5) { n++; last = z; } }
    return n;
  };
  assert.equal(rowsOf(generateChunk(1, 0, 5, 25)), 2);   // min(round(lerp(2,7,0)), fit) = 2
  assert.equal(rowsOf(generateChunk(1, 1, 5, 25)), 6);   // 7 capped by fit at spacing 18
  assert.equal(rowsOf(generateChunk(1, 1, 5, 110)), 3);  // 1 + floor(95 / 38.5)
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

test('hitbox radii match the readable-hazard roster (2026-10-16)', () => {
  assert.equal(RADIUS_TABLE.rock, 4.0);      // huge rock visual: forgiving 8 m sphere
  assert.equal(RADIUS_TABLE.ship, 6.5);      // 18 m hull: forgiving 13 m sphere
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
