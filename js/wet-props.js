import * as THREE from 'three';
import { ATMOSPHERE } from './config.js';

// Wet waterline on props (2026-10-21, cohesion — beyond spec §4.6 the decals cover).
//
// A hull in water is not a dry matte object: below the waterline it is darker and glossier, and
// that darker band is what makes it look like it is IN the sea rather than resting on it. The
// foam collar and the contact decal handle the water's side of the junction; this handles the
// hull's side.
//
// WHY A MATERIAL CLONE, and this is the whole design constraint: `templateFor` hands out ONE
// shared material for every clone of a variant, so every hull of that variant would share a
// `uWaterlineY` uniform and the band would snap to whichever hull updated it last. Each prop
// therefore gets its own material instance. That costs a draw-state object per prop, not a
// program — three keys programs by shader source, so all these clones share one compiled program
// and differ only in uniform values.
//
// The waterline is passed IN as a uniform (world.js already computes the surface height per prop
// for the wave-riding in T10) rather than re-deriving the wave field in the shader. That keeps
// ONE copy of the wave field in the project — js/water.js, guarded by wave-port.test.js — instead
// of a second hand-written one here that could silently drift from the sea the props ride.
// every wet material created, so the debug toggle can reach all of them at once
const created = [];

export function wetMaterial(material) {  const m = material.clone();
  m.userData.wetUniform = null;
  m.userData.wetDarkenUniform = null;
  created.push(m);
  const band = ATMOSPHERE.contact.wetBand;
  const darken = ATMOSPHERE.contact.wetDarken;
  const wetColor = new THREE.Color(ATMOSPHERE.contact.wetColor);

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterlineY = { value: 0 };
    shader.uniforms.uWetBand = { value: band };
    shader.uniforms.uWetDarken = { value: darken };
    shader.uniforms.uWetColor = { value: wetColor };
    // captured so world.js can drive it per frame; onBeforeCompile runs once, before the program
    // is built, and this object is the live uniform set afterwards
    m.userData.wetUniform = shader.uniforms.uWaterlineY;
    m.userData.wetDarkenUniform = shader.uniforms.uWetDarken;

    // world position of the fragment: built-in materials have no world-space varying of their own
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWetPos;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    // injected BEFORE the output transfer, so the darkening happens in linear space like every
    // other lit contribution. If either anchor is missing for some material the replacement is a
    // silent no-op — a material simply does not get the band, and nothing breaks.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWetPos;\nuniform float uWaterlineY;\nuniform float uWetBand;\nuniform float uWetDarken;\nuniform vec3 uWetColor;',
      )
      .replace(
        '#include <colorspace_fragment>',
        'float wetDist = abs(vWetPos.y - uWaterlineY);\n'
        + 'float wet = (1.0 - smoothstep(0.0, uWetBand, wetDist)) * uWetDarken;\n'
        + 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uWetColor, wet);\n'
        + '#include <colorspace_fragment>',
      );
  };
  m.needsUpdate = true;
  return m;
}

// Swap every mesh material in a cloned prop group for a wet one, returning the handles whose
// waterline world.js must drive. Clone-scoped: the shared template material is never mutated.
export function applyWetMaterials(group) {
  const uniforms = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const wet = mats.map((mat) => wetMaterial(mat));
    o.material = wasArray ? wet : wet[0];
    for (const w of wet) {
      if (w.userData.wetUniform) uniforms.push(w.userData.wetUniform);
      // the uniform is created inside onBeforeCompile, so also queue the material itself: the
      // first update pass picks the uniform up once it exists
      uniforms.push(w);
    }
  });
  return uniforms;
}

// Drive the waterline for one prop. Accepts the handles from applyWetMaterials; entries that are
// still materials (uniform not built yet) simply resolve their uniform on the first frame that
// has one.
export function setWetWaterline(handles, y) {
  for (const h of handles) {
    if (h && h.value !== undefined) { h.value = y; continue; }
    const u = h && h.userData && h.userData.wetUniform;
    if (u) u.value = y;
  }
}

// Debug/verification toggle: 0 removes the band entirely, which is how its actual effect gets
// attributed (a dark band near the water proves nothing on a hull that already has dark livery).
export function setWetDarken(v) {
  let n = 0;
  for (const m of created) {
    const u = m.userData && m.userData.wetDarkenUniform;
    if (u) { u.value = v; n++; }
  }
  return n;
}
