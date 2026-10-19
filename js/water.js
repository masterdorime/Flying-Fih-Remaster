import * as THREE from 'three';
import { profileFor } from './flight-state.js';

// Animated low-poly water + gradient sky. Purely environmental.

export function createWater(scene) {
  const geo = new THREE.PlaneGeometry(700, 1800, 90, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x063a7a) },    // deep navy troughs
      uOcean: { value: new THREE.Color(0x0d5cb0) },   // ocean blue
      uAqua: { value: new THREE.Color(0x3ec3f0) },    // bright aqua highlights
      uFoam: { value: new THREE.Color(0xffffff) },    // pure white foam
      uPlayer: { value: new THREE.Vector3(0, 0, 0) },
      uWakeDir: { value: new THREE.Vector2(0, 1) }, // fish heading (xz)
      uWakeStrength: { value: 0 },                  // 0 = calm/hidden, 1 = full churn
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying float vH;
      varying vec3 vPos;
      void main() {
        vec3 p = position;
        // wave phase from WORLD position so the pattern stays world-locked
        // and the fish travels over waves instead of dragging them along
        vec4 world = modelMatrix * vec4(p, 1.0);
        float w = sin(world.z * 0.09 + uTime * 1.6) * 0.35
                + sin(world.x * 0.22 + uTime * 2.4) * 0.18
                + sin((world.x + world.z) * 0.045 - uTime * 1.1) * 0.4;
        p.y += w;
        vH = w;
        vPos = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uOcean, uAqua, uFoam;
      uniform float uTime;
      uniform vec3 uPlayer;
      uniform vec2 uWakeDir;
      uniform float uWakeStrength;
      varying float vH;
      varying vec3 vPos;
      void main() {
        // ---- layered deep-blue ocean ----
        // base: wave-height bands, navy troughs -> ocean blue crests, lifted
        // off pure navy so the sea reads bright, not night-dark
        float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        float band = floor(t * 5.0) / 5.0;                 // quantized cartoon bands
        vec3 col = mix(uDeep, uOcean, 0.15 + 0.85 * band);
        col = mix(col, uAqua, 0.06 + band * 0.14);         // always a hint of aqua

        // broad horizontal swell layers: slow tone shifts in world Z, the
        // reference's layered horizon stripes
        float layer = sin(vPos.z * 0.045 - uTime * 0.8);
        col = mix(col, uAqua, smoothstep(0.5, 1.0, layer) * 0.30);
        // quantized medium stripes: hard-edged tone layers streaming past,
        // each stripe carrying its own aqua weight (the layered ocean read)
        float stripe = floor(vPos.z * 0.11 - uTime * 1.2);
        float stripeTone = 0.5 + 0.5 * sin(stripe * 37.0);
        col = mix(col, uAqua, stripeTone * 0.12);

        // fine bright wave lines streaming past, saturating with height
        float fine = sin(vPos.z * 0.30 - uTime * 2.6);
        col = mix(col, uFoam, smoothstep(0.78, 1.0, fine) * 0.38 * (0.35 + 0.65 * band));

        // crests: aqua flash on the rise, white cap on the highest crests
        col = mix(col, uAqua, smoothstep(0.45, 0.85, vH) * 0.45);
        col = mix(col, uFoam, smoothstep(0.80, 0.98, vH) * 0.45);

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

        // ---- distance fade to the skybox ----
        float fade = 1.0 - smoothstep(240.0, 700.0, abs(vPos.z - uPlayer.z));
        gl_FragColor = vec4(col, fade);
        // parity (spec §4.3/T5): apply three's tone map exactly as the props' built-in
        // materials do, so the sea and the Standard/Phong props share ONE transfer
        // function instead of two. The renderer prefix already supplies TONE_MAPPING,
        // toneMapping() and toneMappingExposure, so only the APPLICATION chunk goes here.
        #include <tonemapping_fragment>
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
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { update() {} };
}
