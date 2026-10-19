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
