import * as THREE from 'three';
import { ATMOSPHERE } from './config.js';
import { surfaceHeight } from './wave.js';

// Contact darkening under hulls (2026-10-19 spec §4.6).
//
// The foam collar (js/water.js) gives the sea a break at the waterline; this is the other half
// of the same cue — the water under and around a hull is darker than open sea. Real renderers
// would use a shadow map, but models.js deliberately disables cast/receive shadows for perf and
// a shadow pass would cost far more than it returns at this stylization (AGENTS §7.2 hygiene:
// reuse before new). A pooled decal is the cheap, honest version.
//
// It consumes the SAME list the foam collar does (world.js's nearHulls), so the two cues cannot
// disagree about which hulls are being grounded, and both are already budgeted to the nearest
// few by ATMOSPHERE.contact.count.
export function createContactDecals(scene) {
  const { count, opacity, decalScale, decalLift } = ATMOSPHERE.contact;

  // A plane, rotated as a MESH rather than baked into the geometry. That matters: baking
  // rotateX into the geometry moves the extent out of the local y axis, so scale.y would then
  // scale nothing and every decal would be a flat line. Rotating the mesh keeps scale.x/scale.y
  // meaning "world x extent / world z extent", which is what an elliptical footprint needs
  // (hulls are long in z — a circular decal spills past the beam, the same lesson the foam
  // collar's first version taught).
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: opacity } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // elliptical radial falloff: solid-ish at the hull, gone before the edge
        vec2 d = vUv * 2.0 - 1.0;
        float a = (1.0 - smoothstep(0.30, 1.0, length(d))) * uOpacity;
        gl_FragColor = vec4(0.0, 0.05, 0.11, a); // a cool water shadow, not a black blob
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const pool = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2; // mesh, not geometry — see the note above
    m.renderOrder = 1;           // after the water (0), before nothing else transparent
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    pool.push(m);
  }

  return {
    group: pool,
    update(t, hulls) {
      // unused slots off — a stale decal is worse than none
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        const h = hulls && hulls[i];
        if (!h) { m.visible = false; continue; }
        m.visible = true;
        m.position.set(h.x, surfaceHeight(h.x, h.z, t) + decalLift, h.z);
        m.scale.set(h.rx * 2 * decalScale, h.rz * 2 * decalScale, 1);
      }
    },
    debugInfo() {
      return {
        pooled: pool.length,
        visible: pool.filter((m) => m.visible).length,
        scale: pool[0] ? [+pool[0].scale.x.toFixed(2), +pool[0].scale.y.toFixed(2)] : null,
      };
    },
  };
}
