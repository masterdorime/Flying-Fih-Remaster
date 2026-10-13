import * as THREE from 'three';
import { profileFor } from './flight-state.js';

// Animated low-poly water + gradient sky. Purely environmental.

export function createWater(scene) {
  const geo = new THREE.PlaneGeometry(700, 1800, 90, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x3fe0c8) },  // tropical shallow
      uDeep: { value: new THREE.Color(0x075f86) },     // deep teal
      uFoam: { value: new THREE.Color(0xf2ffff) },
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
      uniform vec3 uShallow, uDeep, uFoam;
      uniform float uTime;
      uniform vec3 uPlayer;
      uniform vec2 uWakeDir;
      uniform float uWakeStrength;
      varying float vH;
      varying vec3 vPos;
      void main() {
        // ---- toon depth bands ----
        float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        float band = floor(t * 5.0) / 5.0;                 // quantized cartoon bands
        vec3 col = mix(uDeep, uShallow, band);

        // ---- foam on wave crests ----
        float crest = smoothstep(0.55, 0.9, vH);
        col = mix(col, uFoam, crest * 0.85);

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
    scene.fog = new THREE.Fog(0xcfe8f5, 120, 480);
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
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { update() {} };
}
