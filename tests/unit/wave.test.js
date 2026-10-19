import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER_BASE_Y, waveOffset, surfaceHeight, waveSlopes, WAVE_TERMS } from '../../js/wave.js';

// js/wave.js must be an exact JS port of the vertex-shader wave field in
// js/water.js so gameplay props ride the same water the player sees.

// w(x,z,t) = sin(x*0.045 + z*0.125 + t*1.7)*0.5 + sin(x*0.29 + z*0.07 + t*2.6)*0.26
//          + sin((x+z)*0.055 + t*1.1)*0.52 + sin(x*0.3 + z*0.205 + t*3.4)*0.25
// An INDEPENDENT closed form on purpose: it must not derive from WAVE_TERMS, or it would
// agree with the implementation by construction and prove nothing. The term-by-term
// agreement with the shader is the port-sync test's job (wave-port.test.js).
function referenceOffset(x, z, t) {
  return Math.sin(x * 0.045 + z * 0.125 + t * 1.7) * 0.5
    + Math.sin(x * 0.185 + z * 0.045 + t * 2.6) * 0.26
    + Math.sin((x + z) * 0.055 + t * 1.1) * 0.52
    + Math.sin(x * 0.3 + z * 0.205 + t * 3.4) * 0.25;
}

test('waveOffset matches the water shader at several points', () => {
  const pts = [
    [0, 0, 0], [3, 40, 1.7], [-9, 200, 12.3], [14, 1500, 90], [1.5, 33, 0.016],
  ];
  for (const [x, z, t] of pts) {
    assert.ok(Math.abs(waveOffset(x, z, t) - referenceOffset(x, z, t)) < 1e-12,
      `offset(${x},${z},${t})`);
  }
});

test('surfaceHeight = mesh base + offset (mesh sits at y=-0.15)', () => {
  assert.equal(WATER_BASE_Y, -0.15);
  assert.ok(Math.abs(surfaceHeight(3, 40, 1.7) - (WATER_BASE_Y + referenceOffset(3, 40, 1.7))) < 1e-12);
});

test('wave amplitude lands in the contracted band (spec §3: 1.2–1.6 m)', () => {
  const total = WAVE_TERMS.reduce((s, t) => s + Math.abs(t.a), 0);
  assert.ok(total >= 1.2 && total <= 1.6, `amplitude sum ${total} must be in the contracted [1.2, 1.6] band`);
  for (let i = 0; i < 200; i++) {
    const o = waveOffset(Math.sin(i) * 14, i * 37.7, i * 0.53);
    assert.ok(Math.abs(o) <= total + 1e-9, `bounded by the term sum (${o})`);
  }
});

test('waveSlopes are the analytic partial derivatives, normal faces up', () => {
  const x = 4, z = 120, t = 7.7;
  const h = 1e-4;
  const { ddx, ddz } = waveSlopes(x, z, t);
  const numDx = (referenceOffset(x + h, z, t) - referenceOffset(x - h, z, t)) / (2 * h);
  const numDz = (referenceOffset(x, z + h, t) - referenceOffset(x, z - h, t)) / (2 * h);
  assert.ok(Math.abs(ddx - numDx) < 1e-6, `ddx ${ddx} vs ${numDx}`);
  assert.ok(Math.abs(ddz - numDz) < 1e-6, `ddz ${ddz} vs ${numDz}`);
});
