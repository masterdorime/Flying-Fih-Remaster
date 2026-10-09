import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Loads the player's asset packs and normalizes each model to a known size,
// so authored scale differences (FBX vs GLB packs) don't affect gameplay.
// Returns normalized template Groups keyed by obstacle kind.

const TARGET_SIZE = {
  'rock-small': 4.5, 'rock-medium': 6, 'rock-large': 8,
  buoy: 2.6, 'buoy-flag': 3.2,
  'boat-speed': 9, 'boat-sail': 8, 'boat-tug': 7, ship: 12,
  container: 4.6,
};

const MODELS = [
  ['rock-small', 'assets/models/rocks/small-rocks.fbx', TARGET_SIZE['rock-small']],
  ['rock-medium', 'assets/models/rocks/medium-rocks.fbx', TARGET_SIZE['rock-medium']],
  ['rock-large', 'assets/models/rocks/large-rocks.fbx', TARGET_SIZE['rock-large']],
  ['buoy', 'assets/models/watercraft/buoy.glb', TARGET_SIZE.buoy],
  ['buoy-flag', 'assets/models/watercraft/buoy-flag.glb', TARGET_SIZE['buoy-flag']],
  ['boat-speed', 'assets/models/watercraft/boat-speed-a.glb', TARGET_SIZE['boat-speed']],
  ['boat-sail', 'assets/models/watercraft/boat-sail-a.glb', TARGET_SIZE['boat-sail']],
  ['boat-tug', 'assets/models/watercraft/boat-tug-a.glb', TARGET_SIZE['boat-tug']],
  ['ship', 'assets/models/watercraft/ship-small.glb', TARGET_SIZE.ship],
  ['container', 'assets/models/watercraft/cargo-container-a.glb', TARGET_SIZE.container],
];

const KIND_ALIASES = { rock: ['rock-small', 'rock-medium', 'rock-large'], buoy: ['buoy', 'buoy-flag'], boat: ['boat-speed', 'boat-sail', 'boat-tug'], container: ['container'] };

export async function loadModels() {
  const gltfLoader = new GLTFLoader();
  const fbxLoader = new FBXLoader();
  const templates = {};
  const failures = [];

  await Promise.all(MODELS.map(async ([key, url, target]) => {
    try {
      const isFbx = url.endsWith('.fbx');
      const loaded = isFbx ? await fbxLoader.loadAsync(url) : (await gltfLoader.loadAsync(url)).scene;
      templates[key] = normalize(loaded, target);
    } catch (err) {
      failures.push(`${key}: ${err.message}`);
      templates[key] = fallbackBox(target, key.includes('rock') ? 0x8a8f98 : 0xd8623a);
    }
  }));

  return { templates, failures };
}

function normalize(model, target) {
  const group = new THREE.Group();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = target / maxDim;
  model.scale.setScalar(scale);
  // re-measure and sit the model on y=0, centered on x/z
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const c = box2.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box2.min.y;
  group.add(model);
  group.traverse(o => {
    if (o.isMesh) {
      o.castShadow = false; o.receiveShadow = false; // perf: shadows off
      if (o.material && o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
  return group;
}

function fallbackBox(size, color) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.8, size * 0.8, size * 0.8),
    new THREE.MeshStandardMaterial({ color }));
  mesh.position.y = size * 0.4;
  g.add(mesh);
  return g;
}

export function templateFor(templates, kind) {
  const options = KIND_ALIASES[kind] || [kind];
  const key = options.find(k => templates[k]) || options[0];
  return templates[key];
}
