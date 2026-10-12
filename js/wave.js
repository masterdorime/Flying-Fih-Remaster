// Wave field shared by the water shader and everything that rides on it.
// EXACT port of the vertex-shader math in js/water.js — if the shader changes,
// this file must change with it (tests/unit/wave.test.js locks the port).
// Pure: no three.js, unit-tested.

export const WATER_BASE_Y = -0.15; // water mesh position.y in js/water.js

// Vertical offset of the water surface at world (x, z) at time t.
export function waveOffset(x, z, t) {
  return Math.sin(z * 0.09 + t * 1.6) * 0.35
    + Math.sin(x * 0.22 + t * 2.4) * 0.18
    + Math.sin((x + z) * 0.045 - t * 1.1) * 0.4;
}

// Absolute world Y of the water surface.
export function surfaceHeight(x, z, t) {
  return WATER_BASE_Y + waveOffset(x, z, t);
}

// Analytic partial derivatives of the wave field (surface tilt).
export function waveSlopes(x, z, t) {
  const ddx = 0.22 * 0.18 * Math.cos(x * 0.22 + t * 2.4)
    + 0.045 * 0.4 * Math.cos((x + z) * 0.045 - t * 1.1);
  const ddz = 0.09 * 0.35 * Math.cos(z * 0.09 + t * 1.6)
    + 0.045 * 0.4 * Math.cos((x + z) * 0.045 - t * 1.1);
  return { ddx, ddz };
}
