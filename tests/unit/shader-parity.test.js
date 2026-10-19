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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
