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

        // ---- foam ring trailing the fish ----
        float d = distance(vPos.xz, uPlayer.xz);
        float ring = smoothstep(0.0, 1.0, 1.0 - abs(d - 3.2) / 1.6) * 0.32;
        float bob = 0.85 + 0.15 * sin(uTime * 3.0);
        col = mix(col, uFoam, clamp(ring * bob, 0.0, 1.0));

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
    update(t, playerPos) {
      mat.uniforms.uTime.value = t;
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
