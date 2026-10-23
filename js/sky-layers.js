// The cloud sea above the curtain (2026-10-23, phase 4) — PURE DATA and geometry, no THREE.
//
// The user's requirement, verbatim: *"The sky should be a vast sea of cloud with no hollow on it."* The old
// sea was ONE plane carrying a soft-alpha texture, so its gaps were see-through: look down and the sky came
// through the cloud. That is the hollow their screenshot shows.
//
// This module makes "no hollow" a property of the DATA rather than of a texture:
//
//   * bands are CONTIGUOUS in y with deliberate overlap — a vertical gap is a hole;
//   * the deepest band is OPAQUE and its puffs OVERLAP in x/z, so the floor is closed whatever the fractal
//     texture does;
//   * the whole sea sits far below the flight lane, so it can never occlude a ring or a coin;
//   * the recycled field reaches past the haze, so its far edge is never the thing you see.
//
// Rendering lives in js/sky-world.js; the numbers that a designer would tune (the skybox, the haze) live in
// config.ATMOSPHERE.flight. Everything here is unit-tested — see tests/unit/sky-layers.test.js.

// One budget, four shares of it. Keeping the COUNT derived from a single budget is what stops a later tweak
// from quietly doubling the fill cost.
export const SEA_PUFF_BUDGET = 470;

// The field each band is scattered over, in metres, centred on the player and recycled in z. It has to be
// deeper than twice the haze's far plane (asserted in the tests) or the sea's rim becomes visible.
export const SEA_AREA = { x: 900, z: 1300 };

// yTop/yBottom overlap deliberately; `size` is the puff's world width range; `opacity` is per band, and
// exactly one band (the deepest) is opaque.
export const SEA_BANDS = [
  { id: 'surface', yTop: 50, yBottom: 42, size: [30, 80], opacity: 0.85, share: 0.32 },
  { id: 'upper', yTop: 46, yBottom: 31, size: [22, 58], opacity: 0.72, share: 0.26 },
  { id: 'mid', yTop: 34, yBottom: 12, size: [34, 76], opacity: 0.62, share: 0.23 },
  { id: 'deep', yTop: 16, yBottom: -30, size: [130, 220], opacity: 1.0, share: 0.19 },
];

// Mean spacing between puffs in a band, from the area it is scattered over.
export function bandSpacing(band, area = SEA_AREA) {
  return Math.sqrt((area.x * area.z) / bandCount(band));
}
export function bandCount(band, budget = SEA_PUFF_BUDGET) {
  return Math.max(1, Math.round(budget * band.share));
}

// Does this band's smallest puff reach its neighbour? Below 1 the sea has holes between puffs; the floor
// band in particular must close.
export function bandCoversXZ(band, area = SEA_AREA, budget = SEA_PUFF_BUDGET) {
  return band.size[0] >= bandSpacing(band, area) * 1.02;
}

export function skyBands(budget = SEA_PUFF_BUDGET) {
  return SEA_BANDS.map((b) => ({
    ...b,
    count: bandCount(b, budget),
    spacing: bandSpacing(b, SEA_AREA),
    coversXZ: bandCoversXZ(b, SEA_AREA, budget),
  }));
}

export function skyPuffCount(budget = SEA_PUFF_BUDGET) {
  return SEA_BANDS.reduce((n, b) => n + bandCount(b, budget), 0);
}

export function seaTopY() {
  return Math.max(...SEA_BANDS.map((b) => b.yTop));
}

export function seaFloorY() {
  return Math.min(...SEA_BANDS.map((b) => b.yBottom));
}

// Every y between the top and the floor that NO band covers. An empty list is the no-hollow guarantee; a
// returned range is a slot you could look straight through. Sampled finely rather than solved analytically,
// because the bands are hand-written ranges and a half-metre gap is as fatal as a metre one.
export function skyCoverageGaps(bands = SEA_BANDS, step = 0.5) {
  const gaps = [];
  let open = null;
  for (let y = seaTopY(); y >= seaFloorY(); y -= step) {
    const covered = bands.some((b) => y <= b.yTop && y >= b.yBottom);
    if (!covered && open === null) open = y;
    else if (covered && open !== null) { gaps.push([open, y + step]); open = null; }
  }
  if (open !== null) gaps.push([open, seaFloorY()]);
  return gaps;
}
