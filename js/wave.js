// Wave field shared by the water shader and everything that rides on it.
//
// WAVE_TERMS is the ONE data source. The vertex shader in js/water.js writes the same
// coefficients, and tests/unit/wave-port.test.js reads the shader SOURCE and asserts
// every coefficient appears in it — so wave.js and the shader cannot drift apart
// (before this, the only guard was a hand-copied restatement inside wave.test.js).
// Pure: no three.js, unit-tested.
//
// A term is  sin(kx·x + kz·z + w·t) · a,  so wavelength = 2π/hypot(kx,kz).
//
// NYQUIST: the plane is 700×1800 m at 90×220 segments ≈ 7.8×8.2 m cells, so it cannot
// resolve a wavelength below ~16 m — a shorter term would alias into noise rather than
// read as chop. The chop octave below is therefore ~20–29 m: the shortest scale the
// mesh can actually carry. (A shading-only high-frequency glitter term is used in the
// fragment shader instead, where it costs no geometry and cannot alias the silhouette.)
export const WAVE_TERMS = [
  { kx: 0.000, kz: 0.130, w: 1.7, a: 0.50 }, // primary swell, ~48 m
  { kx: 0.300, kz: 0.000, w: 2.6, a: 0.26 }, // cross swell, ~21 m
  { kx: 0.055, kz: 0.055, w: 1.1, a: 0.52 }, // long diagonal, ~81 m
  { kx: 0.300, kz: 0.210, w: 3.4, a: 0.25 }, // chop octave, ~17 m (the Nyquist floor)
];

// Sum of |a|: the wave field's envelope. The spec contracts this to the 1.2-1.6 m band.
export const WAVE_AMPLITUDE = WAVE_TERMS.reduce((s, t) => s + Math.abs(t.a), 0);

export const WATER_BASE_Y = -0.15; // water mesh position.y in js/water.js

// Vertical offset of the water surface at world (x, z) at time t.
export function waveOffset(x, z, t) {
  let sum = 0;
  for (const { kx, kz, w, a } of WAVE_TERMS) sum += Math.sin(kx * x + kz * z + w * t) * a;
  return sum;
}

// Absolute world Y of the water surface.
export function surfaceHeight(x, z, t) {
  return WATER_BASE_Y + waveOffset(x, z, t);
}

// Analytic partial derivatives of the wave field (surface tilt). The fragment shader
// mirrors this for its specular normal, so both agree on which way the water faces.
export function waveSlopes(x, z, t) {
  let ddx = 0;
  let ddz = 0;
  for (const { kx, kz, w, a } of WAVE_TERMS) {
    const c = Math.cos(kx * x + kz * z + w * t) * a;
    ddx += kx * c;
    ddz += kz * c;
  }
  return { ddx, ddz };
}
