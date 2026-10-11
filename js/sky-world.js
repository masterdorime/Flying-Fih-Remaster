import * as THREE from 'three';
import { FLIGHT, WORLD } from './config.js';
import { templateFor } from './models.js';
import { puffTexture } from './clouds.js';

// Placeholder sky world above the cloud curtain (HANDOFF step 4): a cloud-slab
// floor, floating Kenney props, and shrimp trails at flight altitude. Everything
// recycles around the player on z, so the sky is endless. The group is shown
// only above the clouds (main.js drives visibility).
export function createSkyWorld(scene, templates, coinTemplate) {
  const group = new THREE.Group();
  scene.add(group);

  const floorY = FLIGHT.altitude - 10; // cloud slab you skim above

  // ---- cloud-slab floor ----
  const slabTex = puffTexture();
  slabTex.wrapS = slabTex.wrapT = THREE.RepeatWrapping;
  slabTex.repeat.set(8, 24);
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 1500),
    new THREE.MeshBasicMaterial({ map: slabTex, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  slab.geometry.rotateX(-Math.PI / 2);
  slab.position.y = floorY;
  group.add(slab);

  // ---- floating Kenney props (pooled, recycled like world chunks) ----
  const KINDS = ['buoy', 'buoy-flag', 'container', 'boat-speed'];
  const props = [];
  for (let i = 0; i < 10; i++) {
    const tpl = templateFor(templates, KINDS[i % KINDS.length]);
    const clone = tpl.clone(true);
    clone.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    group.add(clone);
    props.push({ group: clone, z: -300 + i * 60, spin: (Math.random() - 0.5) * 0.4 });
  }

  // ---- shrimp trails at flight altitude (visual only: ocean coins are the scored ones) ----
  const trailCoins = [];
  const TRAIL_LEN = 5;
  let nextTrailZ = -200;
  function spawnTrail(z0) {
    const x = (Math.random() - 0.5) * (WORLD.corridorHalfWidth * 2);
    for (let i = 0; i < TRAIL_LEN; i++) {
      const g = coinTemplate.clone(true);
      g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      g.position.set(x + Math.sin(z0 * 0.08) * 2, FLIGHT.altitude + Math.sin(z0 * 0.1) * 1.5, z0 + i * 5);
      group.add(g);
      trailCoins.push(g);
    }
  }

  function resetLayout(playerZ) {
    for (const p of props) {
      p.group.position.set(
        (Math.random() - 0.5) * 140,
        floorY + Math.random() * 26,
        playerZ - 150 + Math.random() * 380,
      );
      p.baseY = p.group.position.y; // bob offset base, so y never random-walks
    }
    for (const g of trailCoins) group.remove(g);
    trailCoins.length = 0;
    nextTrailZ = playerZ + 40;
    while (nextTrailZ < playerZ + 300) {
      spawnTrail(nextTrailZ);
      nextTrailZ += 90;
    }
  }

  function update(dt, playerPos) {
    if (!group.visible) return;
    slab.position.x = playerPos.x;
    slab.position.z = playerPos.z; // keep the slab under the fish for the whole flight
    for (const p of props) {
      p.group.rotation.y += p.spin * dt;
      // gentle bob so the props feel afloat (offset from the base, never accumulated)
      p.group.position.y = p.baseY + Math.sin(performance.now() * 0.0008 + p.z) * 0.004;
      const dz = p.group.position.z - playerPos.z;
      if (dz > 120) p.group.position.z -= 470;
      else if (dz < -350) p.group.position.z += 470;
    }
    for (let i = trailCoins.length - 1; i >= 0; i--) {
      const g = trailCoins[i];
      g.rotation.y += dt * 3.2;
      if (g.position.z < playerPos.z - 40) {
        group.remove(g);
        trailCoins.splice(i, 1);
      }
    }
    while (nextTrailZ < playerPos.z + 300) {
      spawnTrail(nextTrailZ);
      nextTrailZ += 90;
    }
  }

  resetLayout(0);

  // a new run starts the fish back at z=0: rebuild the sky around it
  function reset(playerZ) { resetLayout(playerZ); }

  function debugInfo(playerZ) {
    let ahead = 0;
    for (const g of trailCoins) if (g.position.z > playerZ && g.position.z < playerZ + 300) ahead++;
    return { trailAhead: ahead, slabZ: Math.round(slab.position.z), playerZ: Math.round(playerZ) };
  }

  return { group, update, reset, debugInfo };
}
