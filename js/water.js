import * as THREE from 'three';
import { profileFor } from './flight-state.js';
import { ATMOSPHERE } from './config.js';
import { sunVector } from './atmosphere.js';
import { WAVE_AMPLITUDE, WATER_BASE_Y } from './wave.js';

// Animated low-poly water + gradient sky. Purely environmental.

export function createWater(scene) {
  const geo = new THREE.PlaneGeometry(700, 1800, 90, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      // palette from config (AGENTS §3: the numbers' one home used to be right here)
      uDeep: { value: new THREE.Color(ATMOSPHERE.water.deep) },    // deep troughs
      uOcean: { value: new THREE.Color(ATMOSPHERE.water.ocean) },  // ocean blue
      uAqua: { value: new THREE.Color(ATMOSPHERE.water.aqua) },    // bright aqua highlights
      uFoam: { value: new THREE.Color(ATMOSPHERE.water.foam) },    // pure white foam
      // the ONE air (spec §4.1): the same fog curve and colour every other layer uses
      uFogColor: { value: new THREE.Color(ATMOSPHERE.fog.color) },
      uFogNear: { value: ATMOSPHERE.fog.near },
      uFogFar: { value: ATMOSPHERE.fog.far },
      uSunDir: { value: new THREE.Vector3(sunVector().x, sunVector().y, sunVector().z) },
      uSpecular: { value: ATMOSPHERE.water.specular },
      uCrestFoam: { value: ATMOSPHERE.water.crestFoam },
      uAmplitude: { value: WAVE_AMPLITUDE },  // crest thresholds are amplitude-relative
      uPlayer: { value: new THREE.Vector3(0, 0, 0) },
      uWakeDir: { value: new THREE.Vector2(0, 1) }, // fish heading (xz)
      uWakeStrength: { value: 0 },                  // 0 = calm/hidden, 1 = full churn
      // contact foam around the nearest hulls (T11): xz = hull position, z = footprint
      // radius, w = 1 when the slot is live. Size comes from config via the HULL_MAX define
      // below, so the array and the shader's loop can never disagree.
      uHulls: { value: Array.from({ length: ATMOSPHERE.contact.count }, () => new THREE.Vector4()) },
      uHullCount: { value: 0 },
      uCollarWidth: { value: ATMOSPHERE.contact.collarWidth },
    },
    defines: { HULL_MAX: ATMOSPHERE.contact.count },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vPos;
      varying float vFogDepth;
      void main() {
        vec3 p = position;
        // wave phase from WORLD position so the pattern stays world-locked
        // and the fish travels over waves instead of dragging them along.
        // Coefficients mirror WAVE_TERMS in js/wave.js — tests/unit/wave-port.test.js
        // reads this expression and fails if the two drift apart.
        vec4 world = modelMatrix * vec4(p, 1.0);
        float w = sin(world.x * 0.045 + world.z * 0.125 + uTime * 1.7) * 0.5
                + sin(world.x * 0.185 + world.z * 0.045 + uTime * 2.6) * 0.26
                + sin((world.x + world.z) * 0.055 + uTime * 1.1) * 0.52
                + sin(world.x * 0.3 + world.z * 0.205 + uTime * 3.4) * 0.25;
        p.y += w;
        vPos = (modelMatrix * vec4(p, 1.0)).xyz;
        // exactly three's fog depth, so the sea dissolves on the props' curve
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uOcean, uAqua, uFoam;
      uniform vec3 uFogColor;
      uniform float uFogNear, uFogFar;
      uniform vec3 uSunDir;
      uniform float uSpecular;
      uniform float uCrestFoam;
      uniform float uAmplitude;
      uniform float uTime;
      uniform vec3 uPlayer;
      uniform vec2 uWakeDir;
      uniform float uWakeStrength;
      uniform vec4 uHulls[HULL_MAX];
      uniform float uHullCount;
      uniform float uCollarWidth;
      varying vec3 vPos;
      varying float vFogDepth;

      // (the slope is computed inline in main, from the same phases as the height)

      void main() {
        // ---- the wave field, evaluated PER PIXEL from the same terms the mesh uses ----
        // NOT the interpolated varying: a quad is two triangles, so an interpolated height
        // creases along the quad diagonals, and any tone band keyed to it turns those creases
        // into a visible checkered grid across the whole sea. Evaluating the field here is
        // exact, and reusing each phase for its sine AND cosine means the height and the
        // slope together cost no more than the slope alone did.
        // Coefficients mirror WAVE_TERMS in js/wave.js (guarded by wave-port.test.js).
        float ph1 = vPos.x * 0.045 + vPos.z * 0.125 + uTime * 1.7;
        float ph2 = vPos.x * 0.185 + vPos.z * 0.045 + uTime * 2.6;
        float ph3 = (vPos.x + vPos.z) * 0.055 + uTime * 1.1;
        float ph4 = vPos.x * 0.3 + vPos.z * 0.205 + uTime * 3.4;
        float s1 = sin(ph1), s2 = sin(ph2), s3 = sin(ph3), s4 = sin(ph4);
        float c1 = cos(ph1), c2 = cos(ph2), c3 = cos(ph3), c4 = cos(ph4);
        float hField = s1 * 0.5 + s2 * 0.26 + s3 * 0.52 + s4 * 0.25;
        float ddx = 0.045 * 0.5 * c1 + 0.185 * 0.26 * c2 + 0.055 * 0.52 * c3 + 0.3 * 0.25 * c4;
        float ddz = 0.125 * 0.5 * c1 + 0.045 * 0.26 * c2 + 0.055 * 0.52 * c3 + 0.205 * 0.25 * c4;

        // ---- layered deep-blue ocean, amplitude-relative ----
        // normalised by the field's own envelope so the bands and crest thresholds mean
        // the same thing at any amplitude (they used to hard-code the old 0.93 envelope)
        float t = clamp(hField / uAmplitude * 0.5 + 0.5, 0.0, 1.0);
        // quantized cartoon bands, BLENDED toward the continuous value: a hard floor()
        // steps the tone across the mesh's ~7.8 m cells and the facets read as polygons
        // (caught in the S2 screenshot). 55% quantized keeps the banded style without the
        // steps reading as geometry.
        // Mostly SMOOTH (0.25 quantized, was 0.6): hard floor() bands etch the field's own
        // interference contours, which is what turned the crossing wave systems into a
        // visible checkerboard. A little quantization keeps the banded style.
        float band = mix(t, floor(t * 5.0) / 5.0, 0.25);
        vec3 col = mix(uDeep, uOcean, 0.14 + 0.86 * band);
        col = mix(col, uAqua, 0.12 + band * 0.24);

        // ---- large-scale tonal masses, DE-LATTICED ----
        // Sums of NON-PARALLEL, mutually incommensurate travelling waves. A product such as
        // sin(x)·cos(z) tiles into a regular 2-D lattice and reads as a checkerboard, and
        // axis-aligned z-only terms cross the height bands at right angles — the previous
        // pass had both. Diagonals at odd ratios never settle into a visible repeat.
        float swell = sin((vPos.x * 0.9 + vPos.z * 1.3) * 0.014 + uTime * 0.21)
                    + sin((vPos.x * 1.7 - vPos.z * 0.8) * 0.011 - uTime * 0.17)
                    + 0.6 * sin((vPos.x * 0.6 + vPos.z * 2.1) * 0.009 + uTime * 0.26);
        col = mix(col, uAqua, smoothstep(0.15, 1.5, swell) * 0.30);
        col = mix(col, uDeep, (1.0 - smoothstep(-1.5, -0.15, swell)) * 0.24);

        // ---- band-limit the fine detail (anti-Moiré) ----
        // Once a pattern's wavelength spans fewer than ~2 pixels it cannot be resolved and
        // instead beats against the pixel grid as a fine weave — visible in the mid-field,
        // finer than any term in the shader, which is the giveaway. fwidth() gives metres per
        // pixel, so each fine term fades out exactly when it stops being resolvable. The far
        // field is meant to be smooth anyway.
        float px = max(fwidth(vPos.x), fwidth(vPos.z));
        float fineFade = 1.0 - smoothstep(0.18, 0.85, px * 14.4);
        float stripeFade = 1.0 - smoothstep(0.18, 0.85, px * 10.5);

        // broad swell layers — diagonal, so they no longer cross the bands at right angles
        float layer = sin((vPos.x * 0.7 + vPos.z * 1.0) * 0.045 - uTime * 0.8);
        col = mix(col, uAqua, smoothstep(0.5, 1.0, layer) * 0.28);
        // medium stripes — a SMOOTH travelling wave now, not a floor()-quantized one. Hard
        // integer steps are straight edges in world space and, crossed with the height bands,
        // they were the last of the visible lattice. ~10 m scale, soft edges.
        float stripe = sin((vPos.x * 0.5 + vPos.z * 1.0) * 0.085 - uTime * 1.5);
        col = mix(col, uAqua, smoothstep(0.5, 1.0, stripe) * 0.16 * stripeFade);

        // ---- the sun finally touches the sea ----
        if (uSpecular > 0.0) {
          vec3 n = normalize(vec3(-ddx, 1.0, -ddz)); // slopes already computed above
          vec3 V = normalize(cameraPosition - vPos);  // cameraPosition is a three built-in
          vec3 L = normalize(uSunDir);
          vec3 H = normalize(V + L);
          // Grazing-angle sky sheen: water reflects the sky hardest at shallow angles, which
          // is exactly the chase camera's view. This is the single biggest anti-flatness fix
          // — it is view-dependent, so it works across the whole mid-field, not only where
          // the sun path happens to fall.
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          // Broad sun glitter (22, not 48: a wide highlight path reads from a chase camera,
          // a tight one is invisible unless the eye happens to line up with the sun).
          float gloss = pow(max(dot(n, H), 0.0), 22.0);
          // Screen-space band limit for the WHOLE specular response. At grazing angles the
          // half-vector swings fast per pixel, so an unbounded response beats against the
          // pixel grid as a fine regular weave — measured: the weave vanishes entirely with
          // uSpecular 0 and survives every colour/field change, so it lives here. fwidth() on
          // the response itself is the honest test of whether it can be resolved at all.
          float specFade = 1.0 - smoothstep(0.20, 0.75, max(fwidth(gloss), fwidth(fres)));
          col = mix(col, uAqua * 1.2 + uFoam * 0.15, fres * uSpecular * 0.25 * specFade);
          // Glitter breakup: an APERIODIC hash, NOT a product of two sines. The previous
          // version multiplied sin(x*7.3..) by sin(x*3.1..) — ~0.9 m and ~2 m wavelengths,
          // and a sine *product* is a 2-D lattice: it printed a fine checkered weave wherever
          // the gloss was non-zero (which is why the artifact was a bounded region, and why
          // it vanished with uSpecular 0). fract(sin(dot(...))*large) has no period at all.
          vec2 gcell = floor(vPos.xz * 3.0 + uTime * 1.5);
          float sparkle = mix(0.55, 1.0, fract(sin(dot(gcell, vec2(12.9898, 78.233))) * 43758.5453));
          col += uFoam * gloss * sparkle * uSpecular * 1.2 * specFade;
        }

        // fine bright wave lines streaming past — diagonal too, so the two line families do
        // not cross the swell at right angles and re-introduce a grid by hand
        float fine = sin((vPos.x * 0.55 + vPos.z * 1.35) * 0.30 - uTime * 2.6);
        col = mix(col, uFoam, smoothstep(0.78, 1.0, fine) * 0.30 * (0.35 + 0.65 * band) * fineFade);

        // crests: aqua flash on the rise, foam caps on the highest crests
        col = mix(col, uAqua, smoothstep(0.35, 0.88, t) * 0.50);
        col = mix(col, uFoam, smoothstep(0.86, 1.0, t) * uCrestFoam);

        // aerial lift: distant water rises toward brighter blue before the fade
        float dist = abs(vPos.z - uPlayer.z);
        col = mix(col, uOcean, smoothstep(80.0, 300.0, dist) * 0.35);

        // ---- contact foam: irregular band hugging the hull ----
        // (replaces the old isolated halo ring: disturbance must touch the body)
        vec2 rel0 = vPos.xz - uPlayer.xz;
        float d = length(rel0);
        float wob = sin(atan(rel0.y, rel0.x) * 5.0 + uTime * 4.0) * 0.35
                  + sin((vPos.x + vPos.z) * 1.7 - uTime * 5.0) * 0.25;
        float contact = smoothstep(2.4 + wob, 0.6, d);
        // ---- churn streak astern: foam along -heading, V-tapering behind ----
        float back = dot(rel0, -uWakeDir);
        float side = abs(dot(rel0, vec2(-uWakeDir.y, uWakeDir.x)));
        float streakLen = mix(4.0, 16.0, uWakeStrength);
        float streak = smoothstep(streakLen, 0.0, back)
                     * smoothstep(0.5 + max(back, 0.0) * 0.18, 0.0, side);
        // ---- contact foam around nearby hulls (T11, cohesion) ----
        // The strongest "it sits IN the water" cue there is: the sea BREAKS around a hull where
        // it meets the surface, instead of the hull just intersecting a flat plane. Drawn by
        // the water itself, so it automatically rides the same swell, in the same air, on the
        // same curve — no per-prop mesh and no decal to keep in sync with the field.
        // The footprint is an ELLIPSE (hulls are long in z): a circle of max(rx, rz) spills far
        // past the beam and reads as a white puddle next to the hull, not foam around it
        // (caught in a screenshot). Branch-free: dead slots have zero radii but collarWidth
        // keeps the divisor non-zero, and the live multiplier zeroes them.
        float hullFoam = 0.0;
        for (int i = 0; i < HULL_MAX; i++) {
          vec4 hu = uHulls[i];
          float live = float(i) < uHullCount ? 1.0 : 0.0;
          vec2 rel = vec2(
            (vPos.x - hu.x) / (hu.z + uCollarWidth),
            (vPos.z - hu.y) / (hu.w + uCollarWidth)
          );
          float dh = length(rel);
          // irregular edge, so the collar does not read as a drawn ring
          float wobble = sin(dh * 6.0 + uTime * 2.2 + float(i) * 2.1) * 0.12;
          hullFoam = max(hullFoam, live * smoothstep(1.35 + wobble, 0.90, dh));
        }
        float foamAmt = clamp(contact * 0.85 + streak * 0.5 * uWakeStrength + hullFoam * 0.6, 0.0, 1.0);
        float bob = 0.85 + 0.15 * sin(uTime * 3.0);
        col = mix(col, uFoam, foamAmt * bob);

        // ---- ONE fog, the props' curve (spec §4.3/T7) ----
        // three applies smoothstep(fogNear, fogFar, viewDepth) to Standard/Phong
        // materials; this is that same formula on that same depth, toward the same colour
        // the sky dome paints at its horizon — so sea and sky meet by construction
        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fogFactor);

        // OPAQUE. This used to fade the alpha out with distance, which let the equirect
        // day skybox show through — and that skybox is a photograph with its OWN painted sea,
        // so its fine texture bled through the translucent band as a regular weave. It is the
        // skybox, not the water shader: no water-side change could remove it. The colour fog
        // above already blends the sea into the horizon colour, which is what actually does
        // the joining; alpha was doing nothing but revealing the wrong layer.
        // (The plane's far edge still meets the photo sky as a line — that is T9's job: the
        // crafted sky dome whose horizon IS the fog colour.)
        gl_FragColor = vec4(col, 1.0);
        // parity (spec §4.3/T5): apply three's tone map exactly as the props' built-in
        // materials do, so the sea and the Standard/Phong props share ONE transfer
        // function instead of two. The renderer prefix already supplies TONE_MAPPING,
        // toneMapping() and toneMappingExposure, so only the APPLICATION chunk goes here.
        #include <tonemapping_fragment>
        // and the output-transfer parity (spec §4.3/T7): without this the sea writes
        // LINEAR values while every built-in material is converted to output space, so the
        // water read far darker than the props standing in it. Caught in the S2 screenshot.
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.15;
  scene.add(mesh);

  // Far-field "skirt" (2026-10-19). The near plane is finite — 700 m wide — so past its
  // lateral and forward edges the equirect day skybox showed through, and that skybox is a
  // PHOTOGRAPH with its own painted sea: its fine wave texture read as a regular weave over
  // the water (caught in the S2 screenshots, and immune to every water-side change because
  // it was never the water shader). Beyond the fog distance the sea is one flat colour
  // anyway, so the skirt is a low-poly plane painted exactly that colour — 128 quads instead
  // of widening the detailed plane, which would have coarsened its cells past the Nyquist
  // floor the chop needs. It sits BELOW the deepest trough so the near plane's waves never
  // intersect it. fog:false keeps it the exact fog colour (a built-in material, so it is
  // tone-mapped and colour-converted like every other prop).
  const skirtGeo = new THREE.PlaneGeometry(6000, 6000, 8, 8);
  skirtGeo.rotateX(-Math.PI / 2);
  const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshBasicMaterial({ color: ATMOSPHERE.fog.color, fog: false }));
  skirt.position.y = WATER_BASE_Y - WAVE_AMPLITUDE - 0.5;
  scene.add(skirt);
  return {
    mesh,
    update(t, playerPos, wake = null, hulls = null) {
      mat.uniforms.uTime.value = t;
      // contact foam targets: the nearest hulls world.js collected during its own walk
      if (hulls) {
        const slots = mat.uniforms.uHulls.value;
        const n = Math.min(hulls.length, slots.length);
        for (let i = 0; i < n; i++) slots[i].set(hulls[i].x, hulls[i].z, hulls[i].rx, hulls[i].rz);
        for (let i = n; i < slots.length; i++) slots[i].set(0, 0, 0, 0); // slot off
        mat.uniforms.uHullCount.value = n;
      }
      // wake churn: heading + strength while swimming, zeroed when airborne
      // (a null wake hides all contact foam — nothing disturbs water in flight)
      if (wake) {
        mat.uniforms.uWakeDir.value.set(wake.dirX, wake.dirZ);
        mat.uniforms.uWakeStrength.value = wake.strength;
      } else {
        mat.uniforms.uWakeStrength.value = 0;
      }
      if (playerPos) {
        mat.uniforms.uPlayer.value.set(playerPos.x, playerPos.y, playerPos.z);
        // keep the strip centered on the fish so water never runs out ahead
        mesh.position.x = playerPos.x;
        mesh.position.z = playerPos.z;
        // the far skirt rides along too, or its edge would eventually enter view
        skirt.position.x = playerPos.x;
        skirt.position.z = playerPos.z;
      }
    },
  };
}

// Kenney equirectangular skybox (skybox-day.png) used as the scene background.
// An equirect background wraps the camera at any altitude, so the sky never
// clips or turns black when the fish climbs. Falls back to the gradient dome.
export async function createSky(scene) {
  const loader = new THREE.TextureLoader();
  try {
    const tex = await loader.loadAsync('assets/models/skyboxes/skybox-day.png');
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    // NOTE (2026-10-19, spec §4.1/T4): this used to set a second, identical
    // `scene.fog` here. It was a silent last-writer-wins duplicate of main.js's fog
    // — harmless only while the two literals agreed, and because createSky runs AFTER
    // the scene is built it was the assignment that actually won. The fog now has ONE
    // owner (config.ATMOSPHERE, applied in main.js), so the sky must not set it.
    return { update() {} };
  } catch {
    return createFallbackDome(scene);
  }
}

function createFallbackDome(scene) {
  const geo = new THREE.SphereGeometry(900, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x2f8fc4) },
      uBottom: { value: new THREE.Color(0xdff3ff) },
    },
    vertexShader: /* glsl */`
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uBottom;
      varying float vY;
      void main() {
        gl_FragColor = vec4(mix(uBottom, uTop, clamp(vY * 1.4 + 0.25, 0.0, 1.0)), 1.0);
        #include <tonemapping_fragment> // §4.3/T5: same transfer function as everything else
        #include <colorspace_fragment>  // §4.3/T7: and the same output transfer
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { update() {} };
}
