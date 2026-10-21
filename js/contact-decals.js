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
  // Mutable so the tuning seam can move them on a live frame (the frozen-vantage A/B needs it).
  let scale = decalScale;
  let alpha = opacity;

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
    uniforms: { uOpacity: { value: alpha } },
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
        // elliptical radial falloff: a soft contact darkening that is strongest under the hull
        // and gone before the sprite edge. Deliberately NOT flat-topped (it was: solid to 0.30
        // of the radius) — a flat top reads as a drawn dark oval rather than a shadow, which is
        // what made the decal+foam pair look like a fried egg (2026-10-21).
        vec2 d = vUv * 2.0 - 1.0;
        float a = (1.0 - smoothstep(0.05, 1.0, length(d))) * uOpacity;
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
        m.scale.set(h.rx * 2 * scale, h.rz * 2 * scale, 1);
      }
    },
    debugInfo() {
      return {
        pooled: pool.length,
        visible: pool.filter((m) => m.visible).length,
        scale: pool[0] ? [+pool[0].scale.x.toFixed(2), +pool[0].scale.y.toFixed(2)] : null,
        opacity: mat.uniforms.uOpacity.value,
      };
    },
    // Dev seam (see water.js setLook): the decal's strength is a look number that needs an eye
    // on a still frame, and it is the other half of the contact cue.
    setOpacity(v) {
      if (typeof v === 'number') { alpha = Math.min(1, Math.max(0, v)); mat.uniforms.uOpacity.value = alpha; }
      return alpha;
    },
    // The contact SHADOW's reach. It was shrunk to 0.95 so it would hide under the hull, which also
    // removed the one cue that grounds an object: measured on a buoy close-up, there was no dark
    // contact anywhere under the prop, only bright foam — and bright separates. Scaling it back past
    // the footprint (with the soft falloff) puts the shadow where it reads.
    setScale(v) {
      if (typeof v === 'number') scale = Math.max(0.1, v);
      return scale;
    },
  };
}
