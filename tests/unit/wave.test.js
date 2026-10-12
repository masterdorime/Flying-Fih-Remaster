import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER_BASE_Y, waveOffset, surfaceHeight, waveSlopes } from '../../js/wave.js';

// js/wave.js must be an exact JS port of the vertex-shader wave field in
// js/water.js so gameplay props ride the same water the player sees.

// w(x,z,t) = sin(z*0.09 + t*1.6)*0.35 + sin(x*0.22 + t*2.4)*0.18 + sin((x+z)*0.045 - t*1.1)*0.4
function referenceOffset(x, z, t) {
  return Math.sin(z * 0.09 + t * 1.6) * 0.35
    + Math.sin(x * 0.22 + t * 2.4) * 0.18
    + Math.sin((x + z) * 0.045 - t * 1.1) * 0.4;
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

test('waves stay within the shader amplitude envelope', () => {
  for (let i = 0; i < 200; i++) {
    const o = waveOffset(Math.sin(i) * 14, i * 37.7, i * 0.53);
    assert.ok(Math.abs(o) <= 0.35 + 0.18 + 0.4 + 1e-9, `bounded (${o})`);
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
