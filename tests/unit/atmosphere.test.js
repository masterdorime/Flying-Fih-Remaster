// Ocean cohesion (2026-10-18 spec §4.2): the atmosphere module is the single owner
// of the air — sun, sky gradient, fog curve, horizon colour. Everything visual
// reads from it, so the curve it exposes must MATCH three's linear fog exactly:
// that parity is what makes the sea and the props dissolve on the same curve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATMOSPHERE } from '../../js/config.js';
import { sunVector, skyColorAt, fogFactorAt, horizonColor } from '../../js/atmosphere.js';

// GLSL smoothstep, exactly as three's fog_fragment uses it:
//   fogFactor = smoothstep(fogNear, fogFar, vFogDepth)
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const EPS = 1e-9;

test('ATMOSPHERE carries every key the atmosphere module reads', () => {
  for (const [path, check] of [
    ['sun.dir', v => Array.isArray(v) && v.length === 3],
    ['sun.color', v => typeof v === 'number'],
    ['sun.intensity', v => typeof v === 'number'],
    ['sky.zenith', v => typeof v === 'number'],
    ['sky.horizon', v => typeof v === 'number'],
    ['fog.color', v => typeof v === 'number'],
    ['fog.near', v => typeof v === 'number'],
    ['fog.far', v => typeof v === 'number'],
  ]) {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ATMOSPHERE);
    assert.ok(value !== undefined, `ATMOSPHERE.${path} must exist`);
    assert.ok(check(value), `ATMOSPHERE.${path} has the wrong shape: ${JSON.stringify(value)}`);
  }
  assert.ok(ATMOSPHERE.fog.far > ATMOSPHERE.fog.near, 'fog.far must exceed fog.near');
  assert.ok(ATMOSPHERE.sky.zenith !== ATMOSPHERE.sky.horizon, 'zenith and horizon must differ');
});

test('sunVector is a unit vector pointing along ATMOSPHERE.sun.dir', () => {
  const v = sunVector();
  const len = Math.hypot(v.x, v.y, v.z);
  assert.ok(Math.abs(len - 1) < 1e-9, `sunVector must be unit length, got ${len}`);
  const [dx, dy, dz] = ATMOSPHERE.sun.dir;
  const dlen = Math.hypot(dx, dy, dz);
  assert.ok(Math.abs(v.x - dx / dlen) < 1e-12, 'x matches the configured direction');
  assert.ok(Math.abs(v.y - dy / dlen) < 1e-12, 'y matches the configured direction');
  assert.ok(Math.abs(v.z - dz / dlen) < 1e-12, 'z matches the configured direction');
});

test('skyColorAt spans horizon→zenith and clamps below the horizon', () => {
  const hex = (n) => ({ r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 });
  const horizon = hex(ATMOSPHERE.sky.horizon);
  const zenith = hex(ATMOSPHERE.sky.zenith);

  const at0 = skyColorAt(0);
  assert.ok(Math.abs(at0.r - horizon.r) < EPS && Math.abs(at0.g - horizon.g) < EPS && Math.abs(at0.b - horizon.b) < EPS,
    'elevation 0 is the horizon colour');
  const at1 = skyColorAt(1);
  assert.ok(Math.abs(at1.r - zenith.r) < EPS && Math.abs(at1.g - zenith.g) < EPS && Math.abs(at1.b - zenith.b) < EPS,
    'elevation 1 is the zenith colour');

  // below the horizon there is no sky to interpolate: it stays the horizon colour
  for (const e of [-0.5, -1]) {
    const c = skyColorAt(e);
    assert.ok(Math.abs(c.r - horizon.r) < EPS && Math.abs(c.g - horizon.g) < EPS && Math.abs(c.b - horizon.b) < EPS,
      `elevation ${e} clamps to the horizon colour`);
  }
});

test('skyColorAt is monotone per channel across the gradient', () => {
  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push(skyColorAt(i / 20));
  for (const ch of ['r', 'g', 'b']) {
    const first = samples[0][ch], last = samples[samples.length - 1][ch];
    const dir = Math.sign(last - first);
    for (let i = 1; i < samples.length; i++) {
      const d = Math.sign(samples[i][ch] - samples[i - 1][ch]);
      assert.ok(d === 0 || d === dir,
        `channel ${ch} must move monotonically (${first} → ${last}); step ${i} reversed`);
    }
  }
});

test('fogFactorAt matches three linear fog exactly (parity with scene.fog)', () => {
  const { near, far } = ATMOSPHERE.fog;
  for (let i = 0; i <= 40; i++) {
    const d = (far * 2) * (i / 40); // spans well past `far`
    const expected = smoothstep(near, far, d);
    assert.ok(Math.abs(fogFactorAt(d) - expected) < 1e-12,
      `fogFactorAt(${d}) = ${fogFactorAt(d)} but scene.fog's curve gives ${expected}`);
  }
});

test('fogFactorAt endpoints: 0 at or before near, 1 at or after far', () => {
  const { near, far } = ATMOSPHERE.fog;
  for (const d of [0, near / 2, near]) {
    assert.equal(fogFactorAt(d), 0, `no fog at ${d}`);
  }
  for (const d of [far, far * 2, far * 100]) {
    assert.equal(fogFactorAt(d), 1, `fully fogged at ${d}`);
  }
  assert.ok(fogFactorAt((near + far) / 2) > 0 && fogFactorAt((near + far) / 2) < 1, 'partially fogged midway');
});

test('horizonColor equals the configured fog colour and is stable', () => {
  const hex = (n) => ({ r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 });
  const expected = hex(ATMOSPHERE.fog.color);
  const first = horizonColor();
  for (let i = 0; i < 100; i++) {
    const c = horizonColor();
    assert.ok(Math.abs(c.r - expected.r) < EPS && Math.abs(c.g - expected.g) < EPS && Math.abs(c.b - expected.b) < EPS,
      'horizonColor is the fog colour');
    assert.ok(c.r === first.r && c.g === first.g && c.b === first.b, 'horizonColor is stable across calls');
  }
});
