import * as THREE from 'three';
import { profileFor } from './flight-state.js';

// Animated low-poly water + gradient sky. Purely environmental.

export function createWater(scene) {
  const geo = new THREE.PlaneGeometry(600, 1600, 90, 220);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x3aa7d9) },
      uDeep: { value: new THREE.Color(0x0b3a5c) },
      uFoam: { value: new THREE.Color(0xdff6ff) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying float vH;
      varying vec3 vPos;
      void main() {
        vec3 p = position;
        float w = sin(p.z * 0.09 + uTime * 1.6) * 0.35
                + sin(p.x * 0.22 + uTime * 2.4) * 0.18
                + sin((p.x + p.z) * 0.045 - uTime * 1.1) * 0.4;
        p.y += w;
        vH = w;
        vPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uShallow, uDeep, uFoam;
      uniform float uTime;
      varying float vH;
      varying vec3 vPos;
      void main() {
        float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uDeep, uShallow, t);
        float sparkle = smoothstep(0.55, 0.9, sin(vPos.x * 2.0 + uTime * 3.0) * sin(vPos.z * 1.7 - uTime * 2.2));
        col = mix(col, uFoam, sparkle * 0.25);
        float fade = 1.0 - smoothstep(200.0, 620.0, abs(vPos.z));
        gl_FragColor = vec4(col, fade);
      }`,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.15;
  scene.add(mesh);
  return { mesh, update(t) { mat.uniforms.uTime.value = t; } };
}

export function createSky(scene) {
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
  return mesh;
}
