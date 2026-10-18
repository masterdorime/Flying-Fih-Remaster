import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { KIND_VARIANTS } from './config.js';

// Loads the player's asset packs and normalizes each model to a known size,
// so authored scale differences (FBX vs GLB packs) don't affect gameplay.
// Returns normalized template Groups keyed by obstacle kind.

const TARGET_SIZE = {
  // the rock class kept its gameplay numbers (worldgen radius 4.0); its slots
  // render as ship hulls since 2026-10-17 — the rock FBX packs are unloaded
  'ship-liner': 16, 'ship-cargo-b': 9, 'ship-cargo-c': 13,
  buoy: 2.6, 'buoy-flag': 3.2,
  'boat-speed': 9, 'boat-speed-b': 9, 'boat-speed-c': 9,
  'boat-sail': 8, 'boat-sail-b': 8,
  'boat-tug': 7, 'boat-tug-b': 7, 'boat-fishing': 7,
  ship: 18,
  container: 4.6,
};
const MODELS = [
  ['ship-liner', 'assets/models/watercraft/ship-ocean-liner.glb', TARGET_SIZE['ship-liner']],
  ['ship-cargo-b', 'assets/models/watercraft/ship-cargo-b.glb', TARGET_SIZE['ship-cargo-b']],
  ['ship-cargo-c', 'assets/models/watercraft/ship-cargo-c.glb', TARGET_SIZE['ship-cargo-c']],
  ['buoy', 'assets/models/watercraft/buoy.glb', TARGET_SIZE.buoy],
  ['buoy-flag', 'assets/models/watercraft/buoy-flag.glb', TARGET_SIZE['buoy-flag']],
  ['boat-speed', 'assets/models/watercraft/boat-speed-a.glb', TARGET_SIZE['boat-speed']],
  ['boat-speed-b', 'assets/models/watercraft/boat-speed-b.glb', TARGET_SIZE['boat-speed-b']],
  ['boat-speed-c', 'assets/models/watercraft/boat-speed-c.glb', TARGET_SIZE['boat-speed-c']],
  ['boat-sail', 'assets/models/watercraft/boat-sail-a.glb', TARGET_SIZE['boat-sail']],
  ['boat-sail-b', 'assets/models/watercraft/boat-sail-b.glb', TARGET_SIZE['boat-sail-b']],
  ['boat-tug', 'assets/models/watercraft/boat-tug-a.glb', TARGET_SIZE['boat-tug']],
  ['boat-tug-b', 'assets/models/watercraft/boat-tug-b.glb', TARGET_SIZE['boat-tug-b']],
  ['boat-fishing', 'assets/models/watercraft/boat-fishing-small.glb', TARGET_SIZE['boat-fishing']],
  ['ship', 'assets/models/watercraft/ship-large.glb', TARGET_SIZE.ship],
  ['container', 'assets/models/watercraft/cargo-container-a.glb', TARGET_SIZE.container],
];

// kind -> visual variants. The rock GAMEPLAY class (radius 4.0, every
// difficulty tier) renders as ship hulls now: liners at huge size, bulk
// carriers at medium/large. `ship` stays the exclusive giant-ship endgame kind.
// The roster itself lives in config.KIND_VARIANTS (single source of truth —
// worldgen binds a deterministic variant per spawn so the collision capsule
// and the rendered silhouette are provably the same object).
const KIND_ALIASES = KIND_VARIANTS;

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
      templates[key] = fallbackBox(target, 0xd8623a);
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

export function templateFor(templates, kind, variant = null) {
  // deterministic variant binding (2026-10-18): worldgen picks the variant per
  // spawn; collision dims (config.HULLS) describe that same object. A null
  // variant keeps the legacy random rendering pick (fallbacks/probes).
  const options = KIND_VARIANTS[kind] || [kind];
  if (variant && templates[variant]) return templates[variant];
  const loaded = options.filter(k => templates[k]);
  if (!loaded.length) return templates[options[0]];
  // random variant per spawn: identical silhouettes teach nothing about
  // hitboxes. Rendering-only (Math.random) — gameplay radii live in worldgen.
  return templates[loaded[Math.floor(Math.random() * loaded.length)]];
}
