import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, hasSafeCorridor, difficultyAt, mulberry32, lerp } from '../../js/worldgen.js';
import { WORLD } from '../../js/config.js';

test('difficulty ramps by distance and time, capped at 1', () => {
  assert.equal(difficultyAt(0, 0), 0);
  assert.equal(difficultyAt(99999, 99999), 1);
  assert.ok(difficultyAt(1000, 0) > difficultyAt(500, 0));
  assert.ok(difficultyAt(0, 45) > difficultyAt(0, 10));
});

test('chunks are deterministic for a seed', () => {
  const a = generateChunk(3, 0.5, 42);
  const b = generateChunk(3, 0.5, 42);
  assert.deepEqual(a.obstacles, b.obstacles);
});

test('every chunk keeps a safe corridor (PRD §12.4)', () => {
  for (let d = 0; d <= 1.0001; d += 0.05) {
    for (let i = 0; i < 200; i++) {
      const chunk = generateChunk(i, d, 7);
      assert.ok(hasSafeCorridor(chunk), `chunk ${i} at difficulty ${d} blocks the corridor`);
    }
  }
});

test('obstacle count scales with difficulty', () => {
  const easy = generateChunk(1, 0, 5).obstacles.length;
  const hard = generateChunk(1, 1, 5).obstacles.length;
  assert.ok(hard > easy, `hard chunks have more obstacles (${easy} -> ${hard})`);
  assert.ok(easy >= 2 && hard <= 8);
});

test('obstacles stay within the lane bounds', () => {
  const chunk = generateChunk(9, 1, 3);
  for (const o of chunk.obstacles) {
    assert.ok(Math.abs(o.x) <= WORLD.laneHalfWidth, 'x within lane');
    assert.ok(o.z > 0 && o.z <= WORLD.chunkLength, 'z within chunk');
    assert.ok(o.kind in { rock: 1, buoy: 1, boat: 1, container: 1 }, 'known kind');
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
