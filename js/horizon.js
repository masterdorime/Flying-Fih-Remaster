import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ATMOSPHERE } from './config.js';
import { surfaceHeight } from './wave.js';
import { applyWetMaterials, setWetWaterline } from './wet-props.js';
import { stackSlots, driftSlots } from './farfield.js';
import { slabTexture } from './clouds.js';

// The horizon layer (2026-10-21, horizon-depth plan H5/H6 — spec §4.2).
//
// Distant rock standing IN the swell, plus mid-ground drift, recycled around the fish so travel
// has something to pass. It follows the recycler shape sky-world.js already established (pooled
// clones, a dz window that wraps, reset on a run start, a debugInfo read) with one deliberate
// difference: its placement comes from the pure js/farfield.js, not Math.random(), so a layout is
// reproducible and the live-read tests and frozen-vantage A/B can actually be written.
//
// It is NOT collidable and it never registers with game.nearHulls(). That is a decision, not an
// omission: nearHulls feeds the water shader's foam collar and the contact decals, is capped at
// ATMOSPHERE.contact.count (6) slots and budgeted to contact.hullRange (70 m). Pushing 240 m rock
// through it would either silently drop them or evict the near hulls that need the cue. At 240 m+
// a collar is a few pixels; the wave-riding intersection and the wet band are what read.
//
// Ocean only: main.js hides the group whenever the flight world is showing.
export function createHorizon(scene, runSeed = 0) {
  const H = ATMOSPHERE.horizon;
  const group = new THREE.Group();
  scene.add(group);

  const state = {
    seed: runSeed,
    lap: 0,
    ready: false,
    stacks: [],   // { mesh, wet, x, z, variant, scale, yaw }
    drift: [],
  };

  // ---- lazy rock load: models.js and loadModels' boot path stay untouched ----
  const loader = new FBXLoader();
  const templates = [];   // { obj, unitScale } — unitScale is what makes `scale` read in metres
  let pending = H.rocks.length;

  function normaliseTemplate(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    // The normalisation must NOT live in the template's own scale: the clone's scale is set from
    // the slot every frame (that is how a 6-22 m stack is expressed), and it would overwrite it —
    // which is exactly how the first version drew house-sized slabs across the sky. So the TEMPLATE
    // keeps no scale, the clone is scaled by unitScale x the slot, and the base offset below rides
    // along inside the clone's transform.
    obj.position.y = -box.min.y;      // base at the clone origin, so the swell cuts the base
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;           // models.js disables shadows for perf; match it
      o.receiveShadow = false;
      o.frustumCulled = false;        // the pool recycles meshes, so culling would lie
    });
    return { obj, unitScale: 1 / (size.y || 1) };
  }

  const finishLoad = () => {
    if (!templates.length) {
      // Degrade, never throw: no rock means no stacks, but the drift and the haze band are
      // independent of the templates and keep rendering (spec §7).
      state.ready = false;
      console.warn('[horizon] no rock template loaded — the layer degrades to drift and haze only');
      return;
    }
    state.ready = true;
    buildStackPool();
  };

  for (const file of H.rocks) {
    loader.loadAsync(`assets/models/rocks/${file}`)
      .then((obj) => templates.push(normaliseTemplate(obj)))
      .catch((e) => console.warn('[horizon] rock failed to load:', file, e?.message ?? e))
      .finally(() => { if (--pending === 0) finishLoad(); });
  }

  const templateFor = (variant) => templates[Math.min(variant, templates.length - 1)];
  // `units` is the wanted height in metres; the template carries the rest.
  const cloneOf = (variant, units) => {
    const t = templateFor(variant);
    const c = t.obj.clone(true);
    c.userData.baseScale = t.unitScale * units;   // remembered so the floor fade can scale it
    c.scale.setScalar(c.userData.baseScale);
    c.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return c;
  };

  function buildStackPool() {
    const slots = stackSlots(state.seed, { zFrom: 0, ordinal: 0 });
    for (const slot of slots) {
      const mesh = cloneOf(slot.variant, slot.scale);
      const wet = applyWetMaterials(mesh);
      mesh.rotation.y = slot.yaw;
      group.add(mesh);
      state.stacks.push({ mesh, wet, ...slot });
    }
  }

  function buildDriftPool() {
    for (const slot of driftSlots(state.seed, { zFrom: 0, ordinal: 0 })) {
      const mesh = new THREE.Mesh(driftGeo, driftMat);
      mesh.rotation.y = slot.yaw;
      mesh.renderOrder = 1;          // with the contact decals: above the water
      group.add(mesh);
      state.drift.push({ mesh, ...slot });
    }
  }

  // Drift is FOAM, not debris: flat bright slabs lying on the water. Read as a broken sea surface
  // at 120-300 m, which is what the empty band needed — and unmistakably not an object, unlike a
  // small rock, which at that range would be 10 px and could be mistaken for a distant stack.
  // It needs no rock template, so it survives a failed load (spec §7).
  const driftGeo = new THREE.PlaneGeometry(1, 1);
  driftGeo.rotateX(-Math.PI / 2);
  const driftMat = new THREE.MeshBasicMaterial({
    map: slabTexture(), transparent: true, opacity: 0.75, depthWrite: false, fog: true,
  });
  buildDriftPool();

  // A recycled slot is re-placed from the pure function's NEXT window, anchored ahead of the
  // furthest thing alive. Reusing stackSlots (rather than a bespoke one-slot generator) keeps ONE
  // placement implementation, and anchoring at maxZ + minZSeparation preserves the separation
  // invariant by construction.
  function recycleStack(s, fishZ) {
    const maxZ = state.stacks.reduce((m, o) => Math.max(m, o.z), fishZ);
    state.lap++;
    const fresh = stackSlots(state.seed, { zFrom: maxZ - H.minDistance + H.minZSeparation, ordinal: state.lap })[0];
    s.x = fresh.x;
    s.z = fresh.z;
    s.variant = fresh.variant;
    s.scale = fresh.scale;
    s.yaw = fresh.yaw;
    group.remove(s.mesh);
    const mesh = cloneOf(s.variant, s.scale);
    s.wet = applyWetMaterials(mesh);
    s.mesh = mesh;
    mesh.rotation.y = s.yaw;
    group.add(mesh);
  }

  function recycleDrift(d, fishZ) {
    state.lap++;
    // zFrom is the fish: driftSlots already adds driftNear..driftFar to it. (The first version
    // passed fishZ + driftFar, which double-offset the band and parked recycled drift 420-600 m
    // out — outside the band it exists to fill, where it is 3 px and useless. The live read caught
    // it; the test had only bounded the band from below, so it could not.)
    const fresh = driftSlots(state.seed, { zFrom: fishZ, ordinal: state.lap })[0];
    d.x = fresh.x;
    d.z = fresh.z;
    d.variant = fresh.variant;
    d.scale = fresh.scale;
    d.yaw = fresh.yaw;
    d.mesh.rotation.y = d.yaw;
  }

  return {
    group,
    get ready() { return state.ready; },

    update(dt, fishZ, t) {
      if (!group.visible) return;
      if (t === undefined) return;

      for (const s of state.stacks) {
        // the floor is a RENDER floor: a stack is recycled the moment it would stand closer than
        // minDistance to the fish, so distant rock can never appear in the playable band.
        if (s.z - fishZ < H.minDistance) recycleStack(s, fishZ);
        const y = surfaceHeight(s.x, s.z, t) - s.scale * H.sink;
        s.mesh.position.set(s.x, y, s.z);
        // shrink out over the last `fadeIn` metres before the floor, so crossing the boundary is
        // not a pop (see ATMOSPHERE.horizon.fadeIn)
        const fade = Math.min(1, Math.max(0, (s.z - fishZ - H.minDistance) / H.fadeIn));
        s.mesh.scale.setScalar(s.mesh.userData.baseScale * fade);
        s.mesh.visible = fade > 0.02;
        setWetWaterline(s.wet, surfaceHeight(s.x, s.z, t));
      }

      for (const d of state.drift) {
        if (d.z - fishZ < H.driftNear) recycleDrift(d, fishZ);
        // a flat slab just above the surface, elliptical so it does not read as a card
        d.mesh.position.set(d.x, surfaceHeight(d.x, d.z, t) + 0.06, d.z);
        d.mesh.scale.set(d.scale, 1, d.scale * 0.55);
      }
    },

    reset(runSeed) {
      state.seed = runSeed ?? 0;
      state.lap = 0;
      for (const s of state.stacks) { group.remove(s.mesh); }
      for (const d of state.drift) { group.remove(d.mesh); }
      state.stacks.length = 0;
      state.drift.length = 0;
      if (state.ready) buildStackPool();
      buildDriftPool();   // drift needs no rock template, so it survives a failed load
    },

    debugInfo(fishZ = 0) {
      const at = (s) => ({ x: +s.x.toFixed(3), y: +s.mesh.position.y.toFixed(3), z: +s.z.toFixed(3) });
      const stacks = state.stacks.map(at);
      const drift = state.drift.map(at);
      const zs = stacks.map((s) => s.z);
      return {
        ready: state.ready,
        cap: H.count,                                    // the configured cap, always
        minZ: H.minDistance,
        stacks,                                          // live positions, so tests prove the floor
        drift,                                           // live positions, ditto for inertness
        driftCap: H.driftCount,
        driftNear: H.driftNear,
        driftFar: H.driftFar,
        nearest: zs.length ? +Math.min(...zs).toFixed(2) : null,
        maxZ: zs.length ? +Math.max(...zs).toFixed(2) : null,
        rockFiles: H.rocks,
        templates: templates.length,
        seed: state.seed,
        lap: state.lap,
        fishZ: +fishZ.toFixed(2),
      };
    },
  };
}
