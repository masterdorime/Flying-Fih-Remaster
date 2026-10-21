// The far layer's placement contract (2026-10-21, horizon-depth plan H2/H3).
//
// Everything about WHERE distant things go lives here, in a pure module, so it is testable in
// node and — more importantly — reproducible: the frozen-vantage screenshot A/B and the live-read
// browser assertions both depend on the same seed producing the same layout twice. The pattern
// being reused, sky-world.js, draws from Math.random() at four sites, which is exactly the
// unreproducibility this module exists to avoid.
//
// Three properties are load-bearing and none of them is a style preference:
//   1. The floor. Nothing stands nearer than ATMOSPHERE.horizon.minDistance, so distant rock can
//      never be mistaken for a hazard in the playable band.
//   2. The lane. No stack may sit in the x-range the player swims through — a wall of rock in the
//      distance is fine, a wall of rock in the lane reads as something to dodge.
//   3. The slot. This layer draws from its OWN stream (slot >= 90); worldgen already uses 1-5
//      (worldgen.js:435,460,468,491,498), and sharing one would move every existing draw and
//      break the corpus pins that pin obstacle layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ATMOSPHERE, WORLD } from '../../js/config.js';
import { FAR_SLOT, stackSlots, driftSlots, hazeAt } from '../../js/farfield.js';

const H = ATMOSPHERE.horizon;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SEEDS = [1, 7, 1234, 0xc0ffee];
const ORDINALS = [0, 1, 2, 3];

test('FAR_SLOT stays clear of worldgen\'s own draw slots', () => {
  assert.ok(Number.isInteger(FAR_SLOT), 'FAR_SLOT must be an integer stream slot');
  assert.ok(FAR_SLOT >= 90,
    `FAR_SLOT must sit outside worldgen's 1-5, got ${FAR_SLOT} — sharing a slot would move every existing draw`);
});

test('placement is deterministic per (seed, ordinal), and fresh per ordinal and per seed', () => {
  const w = { zFrom: 0, zTo: H.zBand };
  assert.deepEqual(stackSlots(1234, { ...w, ordinal: 0 }), stackSlots(1234, { ...w, ordinal: 0 }),
    'the same (seed, ordinal) must produce the identical layout — the A/B and the live tests depend on it');
  assert.notDeepEqual(stackSlots(1234, { ...w, ordinal: 0 }), stackSlots(1234, { ...w, ordinal: 1 }),
    'a new ordinal (one recycle lap) must place a fresh window');
  assert.notDeepEqual(stackSlots(1234, { ...w, ordinal: 0 }), stackSlots(9999, { ...w, ordinal: 0 }),
    'a different run seed must produce a different layout');
});

test('every stack keeps the floor, the lane, the count, the scale and the separation', () => {
  for (const seed of SEEDS) {
    for (const ordinal of ORDINALS) {
      const slots = stackSlots(seed, { zFrom: 0, zTo: H.zBand, ordinal });
      assert.equal(slots.length, H.count, `seed ${seed} ordinal ${ordinal}: count must be the configured ${H.count}`);

      for (const s of slots) {
        assert.ok(s.z >= H.minDistance,
          `nothing may stand nearer than the ${H.minDistance} m floor: got z=${s.z.toFixed(1)} (seed ${seed}, ordinal ${ordinal})`);
        assert.ok(Math.abs(s.x) > WORLD.laneHalfWidth,
          `no stack may sit in the lane (|x| > ${WORLD.laneHalfWidth}): got x=${s.x.toFixed(1)}`);
        assert.ok(s.scale >= H.minScale && s.scale <= H.maxScale,
          `scale must stay in [${H.minScale}, ${H.maxScale}]: got ${s.scale}`);
        assert.ok(Number.isInteger(s.variant) && s.variant >= 0 && s.variant < H.rocks.length,
          `variant must index the configured roster of ${H.rocks.length} rocks: got ${s.variant}`);
        assert.ok(Number.isFinite(s.yaw), `yaw must be a finite angle: got ${s.yaw}`);
      }

      const zs = slots.map((s) => s.z).sort((a, b) => a - b);
      for (let i = 1; i < zs.length; i++) {
        assert.ok(zs[i] - zs[i - 1] >= H.minZSeparation,
          `stacks must stay ${H.minZSeparation} m apart in z or they read as a WALL: got ${(zs[i] - zs[i - 1]).toFixed(1)} m`);
      }
    }
  }
});

test('the stack window is the window it was given', () => {
  const slots = stackSlots(42, { zFrom: 500, zTo: 500 + H.zBand, ordinal: 0 });
  for (const s of slots) {
    assert.ok(s.z >= 500 + H.minDistance && s.z <= 500 + H.zBand,
      `a slot must land inside [zFrom + minDistance, zTo]: got z=${s.z.toFixed(1)}`);
  }
});

test('drift fills its own nearer band, deterministically, and may cross the lane', () => {
  const slots = driftSlots(1234, { zFrom: 0, ordinal: 0 });
  assert.equal(slots.length, H.driftCount, `drift count must be the configured ${H.driftCount}`);
  assert.deepEqual(slots, driftSlots(1234, { zFrom: 0, ordinal: 0 }), 'drift must be deterministic');

  for (const s of slots) {
    assert.ok(s.z >= H.driftNear && s.z <= H.driftFar,
      `drift must sit inside its band [${H.driftNear}, ${H.driftFar}]: got z=${s.z.toFixed(1)}`);
    assert.ok(s.scale > 0, `drift scale must be positive: got ${s.scale}`);
    assert.ok(Number.isInteger(s.variant) && s.variant >= 0 && s.variant < H.rocks.length,
      `drift variant must index the configured roster: got ${s.variant}`);
  }

  // Drift is deliberately ALLOWED in the lane: it has no hitbox, and the empty band it exists to
  // fill is the one straight ahead. Asserted across many layouts rather than one, because a single
  // window legitimately might not happen to place anything in the lane — that would be a flaky
  // assertion, not a finding.
  let inLane = 0;
  for (const seed of SEEDS) {
    for (const ordinal of ORDINALS) {
      for (const s of driftSlots(seed, { zFrom: 0, ordinal })) {
        if (Math.abs(s.x) <= WORLD.laneHalfWidth) inLane++;
      }
    }
  }
  assert.ok(inLane > 0,
    `drift must be able to fill the lane ahead (it cannot fill the mid-ground otherwise); saw ${inLane} in-lane slots across ${SEEDS.length * ORDINALS.length} layouts`);
});

test('hazeAt IS the world\'s own fade curve, not a second opinion', () => {
  assert.equal(hazeAt(0), 0, 'nothing fades at the camera');
  assert.equal(hazeAt(10000), 1, 'everything is fog past the far plane');
  const mid = hazeAt(400);
  assert.ok(mid > 0 && mid < 1, `a mid-field distance must be partly faded: got ${mid}`);
  assert.ok(hazeAt(200) <= hazeAt(400), 'haze must be monotone with distance');
});

test('the far layer imports the RNG primitives and NOTHING of worldgen\'s draw order', () => {
  // The draw-order rule cannot be tested behaviourally: a shared stream would still produce
  // valid-looking layouts and surface only as a diff in the corpus pins, long after the cause.
  // So the import list is allowlisted — the two generic primitives are reusable, every chunk
  // builder is not, and a future "just import the generator, it is easier" fails here.
  const ALLOWED = new Set(['mulberry32', 'streamKey']);
  const files = ['farfield.js'];
  assert.ok(files.length > 0, 'the guard must name the files it scans, or it passes vacuously');
  for (const f of files) {
    const src = readFileSync(join(root, 'js', f), 'utf8');
    const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/worldgen\.js'/);
    if (!m) continue; // no worldgen import at all is also fine
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    for (const n of names) {
      assert.ok(ALLOWED.has(n),
        `${f} imports '${n}' from worldgen.js — only the RNG primitives (${[...ALLOWED].join(', ')}) may be reused; `
        + 'anything else couples this layer to the generator whose draw order it must never disturb');
    }
  }
});
