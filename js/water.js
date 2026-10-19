import * as THREE from 'three';
import { profileFor } from './flight-state.js';
import { ATMOSPHERE } from './config.js';
import { sunVector } from './atmosphere.js';
import { WAVE_AMPLITUDE } from './wave.js';

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
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying float vH;
      varying vec3 vPos;
      varying float vFogDepth;
      void main() {
        vec3 p = position;
        // wave phase from WORLD position so the pattern stays world-locked
        // and the fish travels over waves instead of dragging them along.
        // Coefficients mirror WAVE_TERMS in js/wave.js — tests/unit/wave-port.test.js
        // reads this expression and fails if the two drift apart.
        vec4 world = modelMatrix * vec4(p, 1.0);
        float w = sin(world.z * 0.09 + uTime * 1.6) * 0.5
                + sin(world.x * 0.22 + uTime * 2.4) * 0.26
                + sin((world.x + world.z) * 0.045 + uTime * 1.1) * 0.55
                + sin(world.x * 0.31 + world.z * 0.22 + uTime * 3.4) * 0.22;
        p.y += w;
        vH = w;
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
      varying float vH;
      varying vec3 vPos;
      varying float vFogDepth;

      // Mirror of waveSlopes() in js/wave.js — the same four terms, differentiated, so
      // the surface the props ride and the surface the sun lights are ONE surface.
      void waveSlopesAt(vec3 P, out float ddx, out float ddz) {
        ddx = 0.0; ddz = 0.0;
        float c;
        c = cos(P.z * 0.09 + uTime * 1.6) * 0.5;
        ddz += 0.09 * c;
        c = cos(P.x * 0.22 + uTime * 2.4) * 0.26;
        ddx += 0.22 * c;
        c = cos((P.x + P.z) * 0.045 + uTime * 1.1) * 0.55;
        ddx += 0.045 * c; ddz += 0.045 * c;
        c = cos(P.x * 0.31 + P.z * 0.22 + uTime * 3.4) * 0.22;
        ddx += 0.31 * c; ddz += 0.22 * c;
      }

      void main() {
        // ---- layered deep-blue ocean, amplitude-relative ----
        // normalised by the field's own envelope so the bands and crest thresholds mean
        // the same thing at any amplitude (they used to hard-code the old 0.93 envelope)
        float t = clamp(vH / uAmplitude * 0.5 + 0.5, 0.0, 1.0);
        // quantized cartoon bands, BLENDED toward the continuous value: a hard floor()
        // steps the tone across the mesh's ~7.8 m cells and the facets read as polygons
        // (caught in the S2 screenshot). 55% quantized keeps the banded style without the
        // steps reading as geometry.
        float band = mix(t, floor(t * 5.0) / 5.0, 0.55);
        vec3 col = mix(uDeep, uOcean, 0.16 + 0.84 * band);
        col = mix(col, uAqua, 0.10 + band * 0.20);

        // broad horizontal swell layers: slow tone shifts in world Z, the
        // reference's layered horizon stripes
        float layer = sin(vPos.z * 0.045 - uTime * 0.8);
        col = mix(col, uAqua, smoothstep(0.5, 1.0, layer) * 0.28);
        // quantized medium stripes: hard-edged tone layers streaming past
        float stripe = floor(vPos.z * 0.11 - uTime * 1.2);
        float stripeTone = 0.5 + 0.5 * sin(stripe * 37.0);
        col = mix(col, uAqua, stripeTone * 0.12);

        // ---- the sun finally touches the sea ----
        if (uSpecular > 0.0) {
          float ddx, ddz;
          waveSlopesAt(vPos, ddx, ddz);
          vec3 n = normalize(vec3(-ddx, 1.0, -ddz));
          vec3 V = normalize(cameraPosition - vPos);  // cameraPosition is a three built-in
          vec3 L = normalize(uSunDir);
          vec3 H = normalize(V + L);
          float gloss = pow(max(dot(n, H), 0.0), 48.0);
          // shading-only glitter: a cheap interference hash so the highlight breaks into
          // sparkle rather than one broad patch. It costs no geometry, so it cannot alias
          // the mesh (the wave FIELD is held above the ~16 m Nyquist floor).
          float sparkle = 0.55 + 0.45 * sin(vPos.x * 7.3 + vPos.z * 5.1 + uTime * 2.0)
                                       * sin(vPos.x * 3.1 - vPos.z * 9.7 - uTime * 1.3);
          col += uFoam * gloss * sparkle * uSpecular;
        }

        // fine bright wave lines streaming past, saturating with height
        float fine = sin(vPos.z * 0.30 - uTime * 2.6);
        col = mix(col, uFoam, smoothstep(0.78, 1.0, fine) * 0.30 * (0.35 + 0.65 * band));

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
        float foamAmt = clamp(contact * 0.85 + streak * 0.5 * uWakeStrength, 0.0, 1.0);
        float bob = 0.85 + 0.15 * sin(uTime * 3.0);
        col = mix(col, uFoam, foamAmt * bob);

        // ---- ONE fog, the props' curve (spec §4.3/T7) ----
        // three applies smoothstep(fogNear, fogFar, viewDepth) to Standard/Phong
        // materials; this is that same formula on that same depth, toward the same colour
        // the sky dome paints at its horizon — so sea and sky meet by construction
        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fogFactor);

        // the plane is finite: dissolve its edge into a sky that is already that colour
        float fade = 1.0 - smoothstep(uFogFar, uFogFar * 2.2, vFogDepth);
        gl_FragColor = vec4(col, fade);
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
  return {
    mesh,
    update(t, playerPos, wake = null) {
      mat.uniforms.uTime.value = t;
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
