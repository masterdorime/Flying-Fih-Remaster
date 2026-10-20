// The water's TONE contract (2026-10-21).
//
// The sea's palette is driven by a normalised version of the wave field. There are two ways
// to get that normalisation wrong, and BOTH were live on the tip at once:
//
//   1. Normalising by the field's ENVELOPE (Σ|a| = 1.53 m) instead of its spread. Every term
//      peaks together only in principle, so the tone only ever spanned the middle of the
//      palette: measured q05–q95 span 0.621 of [0,1] against 0.833 for the corrected mapping,
//      and the crest band at `smoothstep(0.86, 1.0, t)` cleared on 2.29% of the surface
//      against 8.13% — rare enough that crest foam ramped barely past zero and read as
//      nothing. The near water was flat blue with no light/dark structure.
//   2. Quantizing that tone with a hard `floor()` step, which prints the crossing wave
//      systems' extrema lattice as a rhombus checkerboard (measured in the 2026-10-21 frame).
//      The lattice is a property of the FIELD, not of the angle between the terms: the
//      2026-10-19 pass changed the angles and only changed the cell from square to rhombus.
//
// So the tone is treated here as a contract with numbers rather than a look opinion: it must
// USE its range, and the crest band must be REACHABLE. Both are measured on a deterministic
// sample of the field — no RNG, no aliasing (see the sample grid below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAVE_TERMS, WAVE_AMPLITUDE, WAVE_SIGMA, TONE_GAIN, toneAt,
} from '../../js/wave.js';

// The crest band the fragment shader uses for foam caps (js/water.js).
const CREST_THRESHOLD = 0.86;

// Deterministic aperiodic sample grid. Each coordinate advances by an irrational fraction of
// its range (three-distance / Kronecker), so the sample can never march in step with one of
// the field's wavelengths the way a fixed step would — a fixed step would under- or
// over-report the field's spread depending on how it divides 47/33/81/17 m.
function fieldSamples(n, xzRange = 900, tRange = 24) {
  const STEP = [0.7548776662466927, 0.5698402909980532, 0.3183098861837907];
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = ((i * STEP[0]) % 1) * xzRange - xzRange / 2;
    const z = ((i * STEP[1]) % 1) * xzRange - xzRange / 2;
    const t = ((i * STEP[2]) % 1) * tRange;
    out.push([x, z, t]);
  }
  return out;
}

function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

const SAMPLES = fieldSamples(24000);
const TONES = SAMPLES.map(([x, z, t]) => toneAt(x, z, t)).sort((a, b) => a - b);
const CREST_SHARE = TONES.filter((v) => v >= CREST_THRESHOLD).length / TONES.length;

test('WAVE_SIGMA is the field\'s spread, not its envelope', () => {
  const expected = Math.sqrt(WAVE_TERMS.reduce((s, t) => s + t.a * t.a, 0) / 2);
  assert.ok(Math.abs(WAVE_SIGMA - expected) < 1e-12,
    `WAVE_SIGMA must be sqrt(Σa²/2) (independent terms add in quadrature): got ${WAVE_SIGMA}, expected ${expected}`);
  assert.ok(WAVE_SIGMA < WAVE_AMPLITUDE * 0.6,
    `the field's spread (${WAVE_SIGMA.toFixed(3)} m) must be well under its envelope `
    + `(${WAVE_AMPLITUDE.toFixed(3)} m) — the envelope is only reached when every term peaks together`);
});

test('the tone normalisation maps ±2σ onto the full 0..1 span', () => {
  // t = 1 exactly where the field reaches +2σ, t = 0 at -2σ.
  const atPlus2Sigma = toneAt(0, 0, 0, TONE_GAIN); // sanity: finite, in range
  assert.ok(atPlus2Sigma >= 0 && atPlus2Sigma <= 1, 'toneAt must stay inside [0, 1]');
  // Solving the mapping for the field value that lands on t = 1 gives the envelope/gain.
  const reach = WAVE_AMPLITUDE / TONE_GAIN;
  assert.ok(Math.abs(reach - 2 * WAVE_SIGMA) < 1e-9,
    `the gain must place t = 1 at +2σ: reaches ${reach.toFixed(3)} m, +2σ is ${(2 * WAVE_SIGMA).toFixed(3)} m`);
  // The defect this replaces normalised by the envelope, i.e. a gain of exactly 1.0.
  assert.ok(TONE_GAIN > 1.05,
    `TONE_GAIN ${TONE_GAIN.toFixed(3)} ≈ 1.0 means the tone is normalised by the ENVELOPE again — `
    + 'that is the flat-water defect (middle third of the palette, unreachable crest band)');
});

test('the tone uses its range — the sea has light/dark structure to show', () => {
  const span = quantile(TONES, 0.95) - quantile(TONES, 0.05);
  // Envelope-normalised (gain 1.0) measures ~0.38 here; a flat sea is the whole complaint.
  assert.ok(span >= 0.75,
    `the middle 90% of the tone must span at least 0.75 of [0, 1], got ${span.toFixed(3)} `
    + `(q05 ${quantile(TONES, 0.05).toFixed(3)}, q95 ${quantile(TONES, 0.95).toFixed(3)})`);
});

test('the crest band is reachable — crest foam is not dead code', () => {
  // Measured on this sample: the ENVELOPE-normalised mapping (gain 1.0) cleared the crest band
  // on 2.29% of the surface — rare enough that crest foam ramped barely past zero and read as
  // nothing, which is the "the sea is flat" half of the defect. The sigma-normalised mapping
  // measures 8.13%. The floor below is set between the two on purpose: it fails the old
  // mapping and passes the new one, and the band's job is "a feature of the surface, not a
  // rarity". (The span test above is the other half of the same defect.)
  assert.ok(CREST_SHARE >= 0.04,
    `at least 4% of the surface must clear the crest band ${CREST_THRESHOLD}, got ${(CREST_SHARE * 100).toFixed(2)}% `
    + '(the envelope-normalised mapping measured 2.29% — crest foam you cannot see)');
  assert.ok(CREST_SHARE <= 0.25,
    `at most 25% of the surface may clear the crest band ${CREST_THRESHOLD}, got ${(CREST_SHARE * 100).toFixed(2)}% `
    + '(more than that is not a crest, it is a whiteout)');
});

test('the tone clamps, and the gain is the only dial', () => {
  for (const [x, z, t] of SAMPLES.slice(0, 500)) {
    assert.ok(toneAt(x, z, t, 8) <= 1, 'a huge gain must still clamp at 1');
    assert.ok(toneAt(x, z, t, 0.0001) >= 0, 'a negligible gain must still clamp at 0');
  }
  const flat = toneAt(12.5, -83.25, 3.5, 0);
  assert.ok(Math.abs(flat - 0.5) < 1e-12, `gain 0 must collapse the tone to mid (0.5), got ${flat}`);
});
