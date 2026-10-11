import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// The player fish. Preferred: the rigged-look Skyfin FBX (no skeleton in the
// file, so the swim is a vertex-shader undulation driven by speed).
// Fallback: a fully procedural cartoony fish from primitives.

const SKYFIN_PATH = 'assets/models/fish/skyfin.fbx';

export async function loadSkyfinModel() {
  try {
    const loader = new FBXLoader();
    const model = await loader.loadAsync(SKYFIN_PATH);
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = false;
        o.frustumCulled = false;
        const mat = o.material;
        if (mat) {
          if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          // vertex-swim: undulation grows toward the tail with time*speed
          injectSwim(o, mat);
        }
      }
    });
    // normalize: orient nose to +Z (model's long axis) and scale to ~4.2 m
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    model.scale.setScalar(4.2 / longest);
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    const c = box2.getCenter(new THREE.Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= box2.min.y;
    injectTrailEmissive(model);
    return model;
  } catch (err) {
    console.warn('[fish] Skyfin model unavailable, using procedural fish:', err.message);
    return null;
  }
}

function swimState() {
  return { time: { value: 0 }, amp: { value: 0 }, speed: { value: 0 } };
}

function injectSwim(mesh, mat) {
  const u = swimState();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwimTime = u.time;
    shader.uniforms.uSwimAmp = u.amp;
    shader.uniforms.uSwimSpeed = u.speed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uSwimTime;
        uniform float uSwimAmp;
        uniform float uSwimSpeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // travel from head (z≈0) to tail (z≈-1): tail sways most
          float tail = smoothstep(-0.35, -0.95, position.z);
          float phase = position.z * 2.4 - uSwimTime * (5.0 + uSwimSpeed * 0.10);
          transformed.x += sin(phase) * uSwimAmp * tail;
          transformed.y *= 1.0 - 0.12 * abs(sin(phase)) * tail;
        }`);
  };
  mat.customProgramCacheKey = () => 'skyfin-swim';
  mesh.userData.swim = u;
}

function injectTrailEmissive(model) {
  model.traverse(o => {
    if (o.isMesh && o.material && 'emissive' in o.material) {
      o.material.emissive = new THREE.Color(0x000000);
      o.material.emissiveIntensity = 0;
      o.material.userData = o.material.userData || {};
    }
  });
}

// ---- procedural fallback fish ----
export function createProceduralFish() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff8c42, roughness: 0.55, metalness: 0.05 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xffe3c2, roughness: 0.6 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.5, emissive: 0x000000 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), bodyMat);
  body.scale.set(1.05, 0.85, 2.0);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.92, 20, 14), bellyMat);
  belly.scale.set(0.95, 0.62, 1.7);
  belly.position.y = -0.28;

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0, -1.9);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 4), finMat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.6;
  tail.scale.set(1, 1, 0.18);
  const tailTop = tail.clone(); tailTop.position.set(0, 0.35, -0.55); tailTop.rotation.z = -0.5;
  const tailBottom = tail.clone(); tailBottom.position.set(0, -0.35, -0.55); tailBottom.rotation.z = 0.5;
  tailPivot.add(tail, tailTop, tailBottom);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 4), finMat);
  dorsal.rotation.x = -Math.PI / 2;
  dorsal.scale.set(1, 1, 0.16);
  dorsal.position.set(0, 0.72, -0.2);

  const wingGeom = new THREE.ConeGeometry(0.5, 1.6, 4);
  const wingL = new THREE.Mesh(wingGeom, finMat);
  wingL.rotation.z = Math.PI / 2;
  wingL.scale.set(0.18, 1, 1);
  wingL.position.set(1.0, 0.05, 0.2);
  const wingR = wingL.clone();
  wingR.rotation.z = -Math.PI / 2;
  wingR.position.set(-1.0, 0.05, 0.2);

  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), eyeWhite);
    eye.position.set(side * 0.62, 0.32, 1.25);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), eyeBlack);
    pupil.position.set(side * 0.68, 0.34, 1.38);
    group.add(eye, pupil);
  }

  group.add(body, belly, tailPivot, dorsal, wingL, wingR);
  group.name = 'fish';

  return { group, procedural: true, refs: { tailPivot, dorsal, wingL, wingR, finMat } };
}

// One entry point for the player. skyfinModel = preloaded FBX (or null).
export function createFish(skyfinModel = null) {
  if (skyfinModel) {
    const group = new THREE.Group();
    group.name = 'fish';
    group.add(skyfinModel);
    return {
      group,
      procedural: false,
      refs: { swim: findSwim(skyfinModel), finMat: findFinMaterial(skyfinModel) },
    };
  }
  return createProceduralFish();
}

function findSwim(model) {
  let u = null;
  model.traverse(o => { if (o.userData?.swim) u = o.userData.swim; });
  return u;
}

function findFinMaterial(model) {
  let mat = null;
  model.traverse(o => { if (o.isMesh && o.material) mat = o.material; });
  return mat;
}

// Per-frame character animation (both fish kinds expose the same interface).
export function animateFish(fish, { time, speed, wingScale, stretch, banking }) {
  if (fish.procedural) {
    const { tailPivot, dorsal, wingL, wingR } = fish.refs;
    const wiggle = Math.sin(time * (6 + speed * 0.12)) * (0.25 + Math.min(speed, 60) * 0.004);
    tailPivot.rotation.y = wiggle;
    dorsal.rotation.z = wiggle * 0.3;
    wingL.rotation.x = Math.sin(time * 4) * 0.18;
    wingR.rotation.x = -wingL.rotation.x;
    const flap = Math.max(wingScale, 0.001);
    wingL.scale.set(flap, 1, 1);
    wingR.scale.set(flap, 1, 1);
    wingL.position.x = 1.0 * flap + 0.35;
    wingR.position.x = -wingL.position.x;
  } else if (fish.refs.swim) {
    // Skyfin: vertex-shader undulation; amplitude ramps with speed
    fish.refs.swim.time.value = time;
    fish.refs.swim.amp.value = 0.06 + Math.min(speed, 90) * 0.0012;
    fish.refs.swim.speed.value = Math.min(speed, 110);
  }
  fish.group.scale.set(1 - stretch * 0.5, 1 - stretch * 0.3, 1 + stretch);
  fish.group.rotation.z = banking * 0.6;
}

export function setTrailColor(fish, hex) {
  // Tier glow intentionally REMOVED from the model's body: the Skyfin has a
  // single material, so an emissive tint repainted the whole fish in the tier
  // color (e.g. green at Low flight). The model's authored colors stay pure.
  if (fish.procedural) {
    // procedural fallback keeps the subtle fin emissive it always had
    fish.refs.finMat?.emissive?.set(hex);
    fish.refs.finMat.emissiveIntensity = 0.85;
  }
}
