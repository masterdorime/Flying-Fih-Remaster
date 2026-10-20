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
  // Angles are deliberately NOT axis-aligned and not orthogonal: two crossing systems at
  // 90° interfere into a regular diamond lattice, and with quantized tone bands that reads
  // as a checkerboard across the sea. These sit at roughly 70°, 14°, 45° and 34°, at
  // incommensurate wavelengths, so the interference never settles into a visible grid.
  { kx: 0.045, kz: 0.125, w: 1.7, a: 0.50 }, // primary swell, ~47 m
  { kx: 0.185, kz: 0.045, w: 2.6, a: 0.26 }, // cross swell, ~33 m — kept far from the chop
                                             // octave: two near-EQUAL short wavelengths beat
                                             // into a regular weave once the fresnel/glitter
                                             // amplify their slope interference (measured)
  { kx: 0.055, kz: 0.055, w: 1.1, a: 0.52 }, // long diagonal, ~81 m
  { kx: 0.300, kz: 0.205, w: 3.4, a: 0.25 }, // chop octave, ~17 m (the Nyquist floor)
];

// Sum of |a|: the wave field's envelope. The spec contracts this to the 1.2-1.6 m band.
export const WAVE_AMPLITUDE = WAVE_TERMS.reduce((s, t) => s + Math.abs(t.a), 0);

// The field's SPREAD. Terms whose phases are effectively independent add in quadrature, so
// the variance of the sum over a uniform phase is Σa²/2 and this is its standard deviation.
// It is NOT the envelope: every term peaks together only in principle, so the field spends
// almost all its life inside ±1–2σ. Measured: σ ≈ 0.57 m against an envelope of 1.53 m.
export const WAVE_SIGMA = Math.sqrt(WAVE_TERMS.reduce((s, t) => s + t.a * t.a, 0) / 2);

// Tone gain: the divisor that maps ±2σ of the field onto the FULL 0..1 tone span.
//
// Why it exists (2026-10-21 fix). The water's palette and its crest thresholds are keyed to a
// normalised field value. Normalising by WAVE_AMPLITUDE — the envelope, i.e. a gain of exactly
// 1.0 — compressed the tone and starved the crests: measured on a uniform sample, the tone's
// q05–q95 span was 0.621 of [0,1] and the crest band `smoothstep(0.86, 1.0, t)` cleared on
// 2.29% of the surface, against 0.833 and 8.13% here. Crest foam ramped barely past zero and
// the near water read as flat blue. 2σ is the honest full-scale point for a field of this
// shape. tests/unit/wave-tone.test.js measures both consequences.
export const TONE_GAIN = WAVE_AMPLITUDE / (2 * WAVE_SIGMA);

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

// Normalised tone of the field at world (x, z, t): 0 = deepest trough, 1 = highest crest,
// 0.5 = mid. The fragment shader in js/water.js mirrors this expression (the gain reaches it
// as the uToneGain uniform rather than as a copied literal, so the two cannot drift).
//
// NOTE for anyone tempted to band this with floor(): the field is a SUM of crossing wave
// systems, so its contours are a lattice of alternating extrema. A hard step keyed to that
// lattice prints it as a rhombus checkerboard across the sea — measured 2026-10-21. Changing
// the terms' angles only changes the cell from square to rhombus; the step is the mechanism.
export function toneAt(x, z, t, gain = TONE_GAIN) {
  const h = waveOffset(x, z, t);
  return Math.min(1, Math.max(0, (h / WAVE_AMPLITUDE) * gain * 0.5 + 0.5));
}
