// The wave field is an EXACT-PORT contract: js/wave.js (pure, unit-tested) and the
// vertex shader in js/water.js must agree, or every prop rides a different sea from
// the one on screen. AGENTS §7.2 names "no duplicated rules between pure modules and
// views" as hygiene — and the wave field IS such a duplication.
//
// Until now the only guard was a hand-copied `referenceOffset` inside wave.test.js,
// which restates the numbers a third time and cannot catch the SHADER drifting.
// So wave.js exports WAVE_TERMS — the one data source — and this test reads the
// shader SOURCE and asserts every term's coefficients appear in its wave expression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WAVE_TERMS } from '../../js/wave.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const waterSrc = readFileSync(join(root, 'js', 'water.js'), 'utf8');

// Shader guards must read CODE, not prose. Without this, a comment explaining a removed
// construct trips the very check that its explanation exists to serve — which would push
// future authors towards vaguer comments. Both comment forms in the shader strings are stripped.
const waterCode = waterSrc
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

// The vertex shader's wave block: `float w = <expression>;`
function vertexWaveExpression(src) {
  const m = src.match(/float\s+w\s*=\s*([\s\S]*?);/);
  return m ? m[1] : null;
}

test('WAVE_TERMS is the wave field as data', () => {
  assert.ok(Array.isArray(WAVE_TERMS) && WAVE_TERMS.length >= 3,
    'WAVE_TERMS must be a non-empty array of wave terms (the three original terms minimum)');
  for (const [i, t] of WAVE_TERMS.entries()) {
    for (const key of ['kx', 'kz', 'w', 'a']) {
      assert.equal(typeof t[key], 'number', `WAVE_TERMS[${i}].${key} must be a number`);
    }
    assert.ok(Number.isFinite(t.a) && t.a !== 0, `WAVE_TERMS[${i}] needs a non-zero amplitude`);
  }
});

test('the water vertex shader carries every WAVE_TERMS coefficient', () => {
  const expr = vertexWaveExpression(waterSrc);
  assert.ok(expr, 'the water vertex shader must compute the wave offset into `float w`');
  for (const [i, t] of WAVE_TERMS.entries()) {
    for (const key of ['kx', 'kz', 'w', 'a']) {
      const v = t[key];
      if (v === 0) continue; // an axis-oriented term simply has no term for that axis
      assert.ok(expr.includes(String(v)),
        `WAVE_TERMS[${i}].${key} = ${v} is missing from water.js's wave expression — wave.js and the shader have drifted apart:\n${expr}`);
    }
  }
});

// The TONE mapping is the second half of the same port. Its VALUE cannot drift the way a
// coefficient can — the shader reads the gain as the uToneGain uniform, so it comes from
// wave.js TONE_GAIN by construction and there is no copied literal to check. What can drift is
// the FORM (someone re-arranging the expression) and the arrival of quantization:
//
//   * a hard floor() step keyed to this field prints the crossing systems' EXTREMA LATTICE as
//     a rhombus checkerboard across the sea. It is not a matter of the angle between the
//     terms — the 2026-10-19 pass changed the angles and only changed the cell's shape. This
//     artefact has now appeared in the water three times (the glitter weave, the skybox
//     showing through, and this), so it gets a guard rather than a comment.
test('the water fragment shader mirrors the tone mapping, and never quantizes it', () => {
  // field / amplitude × gain × 0.5 + 0.5, clamped — the same shape as wave.js toneAt()
  const TONE = /float\s+t\s*=\s*clamp\(\s*hField\s*\/\s*uAmplitude\s*\*\s*uToneGain\s*\*\s*0\.5\s*\+\s*0\.5\s*,\s*0\.0\s*,\s*1\.0\s*\)/;
  assert.ok(TONE.test(waterCode),
    'the water fragment shader must derive its tone as clamp(hField / uAmplitude * uToneGain * 0.5 + 0.5, 0.0, 1.0), '
    + 'mirroring toneAt() in js/wave.js');
  assert.ok(/import\s*\{[^}]*TONE_GAIN[^}]*\}\s*from\s*'\.\/wave\.js'/.test(waterCode),
    "js/water.js must import TONE_GAIN from './wave.js' — the gain's one home (AGENTS §3)");
  // No CELL GRID built from position. `floor(vPos.xz * k)` is a regular world-space lattice,
  // and every quantity it modulates inherits that lattice no matter how aperiodic the value
  // put in each cell is. That is exactly how the 2026-10-19 glitter hash got in: the comment
  // reasoned (correctly!) that `fract(sin(dot(...)))` has no period — and missed that the
  // cells it sampled did. It printed a rhombus checkerboard across the lit sea, found by
  // bisection on 2026-10-21 (the same family as the sine-product weave before it).
  assert.ok(!/floor\s*\(\s*vPos/.test(waterCode),
    'the water fragment shader must not build a cell grid from position (floor(vPos.xz * k)): '
    + 'an aperiodic VALUE on a periodic CELL LAYOUT still reads as a lattice');
  // The tone stays continuous too: it is a sum of crossing waves, so its contours are closed
  // curves around a lattice of extrema, and a 5-level step now (with the corrected range,
  // which spans far more of [0,1]) would print five nested bands across the sea.
  assert.ok(!/floor\s*\(\s*(hField|t)\s*[*)]/.test(waterCode),
    'the water tone must not be quantized with floor() — its contours are the crossing field\'s '
    + 'extrema lattice, and the corrected range only makes those bands tighter');
});
