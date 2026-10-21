import { ATMOSPHERE, WORLD } from './config.js';
import { mulberry32, streamKey } from './worldgen.js';
import { fogFactorAt } from './atmosphere.js';

// Where distant things go (2026-10-21, horizon-depth plan H2/H3 — spec §4.1).
//
// PURE: no THREE, so the placement is unit-testable in node and — the point of it — REPRODUCIBLE.
// The recycler in js/horizon.js re-places a stack by calling back into here with the next ordinal,
// so a given (run seed, ordinal) always yields the same window. That is what makes the frozen-vantage
// screenshot A/B and the live-read browser assertions repeatable; the pattern being reused,
// sky-world.js, draws from Math.random() at four sites and can therefore do neither.
//
// The layer's stream is its OWN. worldgen already uses slots 1-5 (worldgen.js:435,460,468,491,498);
// sharing one would move every existing draw and break the corpus pins that pin obstacle layouts.
// `streamKey` is imported rather than re-implemented so there is exactly one key hash in the project.
export const FAR_SLOT = 90;

// One independent stream per attribute, so a change to (say) the scale draw cannot shift the x
// draws — the house RNG discipline: a new decision gets its own stream id.
function subStream(runSeed, ordinal, which) {
  return mulberry32(streamKey(runSeed, ordinal, FAR_SLOT, which));
}

// `count` positions inside [from, to], each at least `minSep` after the previous one.
// The slack is dealt out as random weights, so the cadence is irregular: an even ladder of distant
// rock reads as a fence, which is the thing minZSeparation exists to prevent.
function spaced(from, to, count, minSep, rng) {
  const usable = (to - from) - minSep * (count - 1);
  if (usable < 0) {
    throw new Error(`farfield: a ${(to - from).toFixed(0)} m window cannot hold ${count} slots ${minSep} m apart`);
  }
  const weights = Array.from({ length: count }, () => 0.15 + rng());
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = from;
  const out = [];
  for (let i = 0; i < count; i++) {
    cursor += (weights[i] / total) * usable;
    out.push(cursor + i * minSep);
  }
  return out;
}

// Distant rock: beyond the floor, off the lane axis, separated in z.
// `zFrom` is the fish's z; `zTo` defaults to the configured band's end.
export function stackSlots(runSeed, { zFrom = 0, zTo = null, ordinal = 0 } = {}) {
  const H = ATMOSPHERE.horizon;
  const bandEnd = zTo ?? zFrom + H.zBand;
  const zs = spaced(zFrom + H.minDistance, bandEnd, H.count, H.minZSeparation, subStream(runSeed, ordinal, 0));
  const rngX = subStream(runSeed, ordinal, 1);
  const rngVariant = subStream(runSeed, ordinal, 2);
  const rngBody = subStream(runSeed, ordinal, 3);
  return zs.map((z) => {
    const side = rngX() < 0.5 ? -1 : 1;
    // at least 4 m of air beyond the lane edge, then out to `spread`
    const x = side * (WORLD.laneHalfWidth + 4 + rngX() * H.spread);
    const variant = Math.min(H.rocks.length - 1, Math.floor(rngVariant() * H.rocks.length));
    const scale = H.minScale + rngBody() * (H.maxScale - H.minScale);
    const yaw = rngBody() * Math.PI * 2;
    return { x, z, variant, scale, yaw };
  });
}

// Mid-ground drift: fills the otherwise empty band between the props and the horizon. Smaller,
// denser, and deliberately ALLOWED across the lane — it has no hitbox, and the band it fills is
// the one straight ahead.
export function driftSlots(runSeed, { zFrom = 0, ordinal = 0 } = {}) {
  const H = ATMOSPHERE.horizon;
  const rng = subStream(runSeed, ordinal, 4);
  const out = [];
  for (let i = 0; i < H.driftCount; i++) {
    out.push({
      x: (rng() * 2 - 1) * H.driftSpread,
      z: zFrom + H.driftNear + rng() * (H.driftFar - H.driftNear),
      variant: Math.min(H.rocks.length - 1, Math.floor(rng() * H.rocks.length)),
      scale: H.driftScale * (0.5 + rng()),
      yaw: rng() * Math.PI * 2,
    });
  }
  return out;
}

// The layer's haze IS the world's fade curve — one number, not a second opinion that could drift
// from the air every other layer is dissolved in.
export function hazeAt(distance) {
  return fogFactorAt(distance);
}
