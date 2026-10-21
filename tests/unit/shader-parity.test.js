// Ocean cohesion (2026-10-18 spec §4.3/T5): a custom ShaderMaterial must apply the
// SAME tone map the Standard/Phong props get, or water and props respond to light
// under two different transfer functions — the "two physics for light" root cause.
//
// Verified against the vendored r170 (vendor/three/three.module.min.js, 2026-10-19):
//   - `Material.toneMapped` defaults true, inherited by ShaderMaterial;
//   - the fragment prefix injects `0!==toneMapping ? "#define TONE_MAPPING" : ""`,
//     the `tonemapping_pars_fragment` chunk and the `toneMapping()` function.
// So a ShaderMaterial needs ONLY the APPLICATION chunk. Including the pars chunk too
// would re-declare `uniform float toneMappingExposure` (the prefix already supplies
// it) and the shader would fail to compile, so this test pins both directions.
//
// Source-level guard on purpose: the failure mode is a silently untone-mapped layer
// (or a shader that fails to compile, which surfaces only as a browser console
// error), neither of which a pure numeric test can see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ATMOSPHERE } from '../../js/config.js';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'js');

function customShaderFiles() {
  return readdirSync(jsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, src: readFileSync(join(jsDir, f), 'utf8') }))
    .filter(({ src }) => src.includes('fragmentShader:'));
}

test('every custom fragment shader applies the shared tone map', () => {
  const files = customShaderFiles();
  // non-vacuous: if the scan ever stops finding the shaders, this fails rather than
  // passing on an empty list
  assert.ok(files.length > 0, 'expected at least one custom fragment shader (js/water.js)');
  for (const { f, src } of files) {
    assert.ok(src.includes('#include <tonemapping_fragment>'),
      `${f} must apply the tone map: add "#include <tonemapping_fragment>" right after writing gl_FragColor`);
  }
});

test('every custom fragment shader also applies the shared OUTPUT transfer', () => {
  // A custom shader that writes linear values straight to the framebuffer reads far darker
  // than the built-in materials around it — the same "two physics" split as the tone map.
  for (const { f, src } of customShaderFiles()) {
    assert.ok(src.includes('#include <colorspace_fragment>'),
      `${f} must apply the output transfer: add "#include <colorspace_fragment>" after tonemapping`);
  }
});

test('no custom shader re-declares the tone-map pars the renderer prefix injects', () => {
  for (const { f, src } of customShaderFiles()) {
    assert.ok(!src.includes('#include <tonemapping_pars_fragment>'),
      `${f} must NOT include the tonemapping PARS chunk: the prefix already injects it, so a second include re-declares uniform toneMappingExposure and the shader fails to compile`);
  }
});

test('the sky dome\'s band numbers have ONE home in ATMOSPHERE.sky', () => {
  // sky-dome.js hardcoded the cloud band's strength (0.80 at :64) and the horizon haze band's
  // elevation and strength (0.12 / 0.55 at :68). Those are LOOK numbers on a shared horizon — the
  // ledger already records the cloud band as reading too subtle, i.e. they are numbers someone will
  // tune, and a number someone will tune belongs where it can be tuned (AGENTS §3). The band's
  // SHAPE (the puff frequencies) deliberately stays in the shader: that is style, not a dial.
  for (const key of ['cloudBand', 'hazeBand']) {
    const v = ATMOSPHERE.sky[key];
    assert.ok(v && typeof v === 'object', `ATMOSPHERE.sky.${key} must exist — one home for the dome's ${key} numbers`);
    for (const [k, n] of Object.entries(v)) {
      assert.equal(typeof n, 'number', `ATMOSPHERE.sky.${key}.${k} must be a number, got ${typeof n}`);
    }
  }
  assert.ok(ATMOSPHERE.sky.hazeBand.strength > 0 && ATMOSPHERE.sky.hazeBand.strength <= 1,
    `haze strength must be a fraction in (0, 1], got ${ATMOSPHERE.sky.hazeBand.strength}`);
  assert.ok(ATMOSPHERE.sky.cloudBand.strength > 0 && ATMOSPHERE.sky.cloudBand.strength <= 1,
    `cloud band strength must be a fraction in (0, 1], got ${ATMOSPHERE.sky.cloudBand.strength}`);

  // and the dome must READ them rather than restate them
  const dome = readFileSync(join(jsDir, 'sky-dome.js'), 'utf8');
  assert.ok(/ATMOSPHERE\.sky\.cloudBand/.test(dome), 'sky-dome.js must read ATMOSPHERE.sky.cloudBand');
  assert.ok(/ATMOSPHERE\.sky\.hazeBand/.test(dome), 'sky-dome.js must read ATMOSPHERE.sky.hazeBand');
});

test('every custom shader file still PARSES as JavaScript', () => {
  // 2026-10-21, caught by a browser boot: a new comment inside js/water.js's fragmentShader
  // template literal used a backtick to quote a function name. A backtick TERMINATES the
  // literal, so the module became a syntax error ("Unexpected identifier 'fract'"), main.js
  // threw on its first frame, and the page hung at the loading overlay — while the entire unit
  // suite stayed GREEN, because every other test here reads the file as TEXT. Text cannot see
  // a broken literal; a parse can, and it costs one `node --check` per shader file.
  const files = customShaderFiles();
  assert.ok(files.length > 0, 'expected at least one custom fragment shader (js/water.js)');
  for (const { f } of files) {
    try {
      execFileSync(process.execPath, ['--check', join(jsDir, f)], { stdio: 'pipe' });
    } catch (e) {
      assert.fail(`${f} does not parse as JavaScript — a shader string or one of its comments has broken the module:\n${e.stderr ?? e.message}`);
    }
  }
});
