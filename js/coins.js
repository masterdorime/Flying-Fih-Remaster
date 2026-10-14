import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COINS, WORLD } from './config.js';
import { surfaceHeight } from './wave.js';

// Shrimp coins (player-requested mechanic): the shrimp_low_poly.glb model.
// Coins spawn as CONTINUOUS trails along the safe corridor — like the coin
// trains in endless runners — so there are always shrimp ahead to collect.
// Coins affect SCORE ONLY — the gauge fills only from Perfect/Good (PRD §8.2).

export async function loadCoinModel() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('assets/models/shrimp_low_poly.glb');
  const scene = gltf.scene;
  scene.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.4 / Math.max(size.x, size.y, size.z);
  scene.scale.setScalar(scale);
  return scene;
}

const SPACING = 4;          // coin spacing inside a trail
const TRAIL_GAP = 24;       // distance between consecutive trail starts (>= spacing -> continuous)
const AHEAD = 160;          // keep coins alive this far ahead
const BEHIND = 30;          // recycle this far behind
const MAGNET_RANGE = 4.5;   // start pulling toward the fish (nerfed 2026-10-14)
const MAGNET_REACH = 2.4;   // collect radius once magnetized
const BASE_REACH = 1.6;     // normal collect radius
const SKIM = 0.3;           // ocean shrimp ride this far above the wave surface
const WAVE_RIDE = 3;        // spring rate locking low trails to the swell

export function createCoins(scene, coinTemplate) {
  const active = []; // { group, baseX, baseY, z, phase }
  let elapsed = 0;
  let nextTrailZ = 20;

  function spawnTrail(z0, high, time) {
    const startX = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * (WORLD.corridorHalfWidth - 2.5));
    const baseY = 1.8 + Math.random() * 6;          // high-trail base only...
    const highTrail = high && Math.random() < 0.4;  // ...elevated trails only when airborne
    const count = Math.floor(TRAIL_GAP / SPACING);  // length matches the gap -> no holes
    for (let i = 0; i < count; i++) {
      const z = z0 + i * SPACING;
      const x = startX + Math.sin(z * 0.08) * 1.8;               // gentle lateral weave
      // ocean shrimp skim the live wave surface (same field the fish rides);
      // airborne trails keep the old elevated band
      const low = !highTrail;
      const y = highTrail
        ? baseY + 14 + Math.sin(z * 0.06) * 2.5
        : surfaceHeight(x, z, time) + SKIM;
      const group = coinTemplate.clone(true);
      group.position.set(x, y, z);
      scene.add(group);
      active.push({ group, z, phase: Math.random() * Math.PI * 2, low });
    }
  }

  let playerZ = 0;

  function update(dt, playerPos, onCollect, high = false, time = null) {
    elapsed += dt;
    playerZ = playerPos.z;
    const t = time ?? elapsed; // game clock keeps coins phase-locked to the water shader

    // back on the water, unreachable sky coins from the last flight are removed
    // outright (low trails top out near y≈9; anything above 12 is a leftover high)
    if (!high) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].group.position.y > 12) {
          scene.remove(active[i].group);
          active.splice(i, 1);
        }
      }
    }

    // keep a continuous river of coins ahead of the fish
    while (nextTrailZ < playerPos.z + AHEAD) {
      spawnTrail(nextTrailZ, high, t);
      nextTrailZ += TRAIL_GAP;
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const coin = active[i];
      const g = coin.group;
      g.rotation.y += dt * 3.2;
      // low trails stay glued to the swell as it moves; the magnet (below)
      // overpowers this spring once the fish is close
      if (coin.low) {
        const waveY = surfaceHeight(g.position.x, g.position.z, t) + SKIM;
        g.position.y += (waveY - g.position.y) * Math.min(1, dt * WAVE_RIDE);
      }
      g.position.y += Math.sin(elapsed * 2 + coin.phase) * 0.008; // bob

      const dx = g.position.x - playerPos.x;
      const dy = g.position.y - playerPos.y;
      const dz = g.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let reach = BASE_REACH;
      if (dist < MAGNET_RANGE) {
        const pull = (1 - dist / MAGNET_RANGE) * dt * 6;
        g.position.x -= dx * pull;
        g.position.y -= dy * pull;
        g.position.z -= dz * pull;
        reach = MAGNET_REACH;
      }

      if (dist < reach) {
        onCollect?.(coin);
        scene.remove(g);
        active.splice(i, 1);
        continue;
      }
      if (coin.z < playerPos.z - BEHIND) {
        scene.remove(g);
        active.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const coin of active) scene.remove(coin.group);
    active.length = 0;
    nextTrailZ = 20;
  }

  // debug: verify the trail is continuous (largest z gap ahead) and reaches far
  function debugInfo() {
    const ahead = active
      .map(c => c.z)
      .filter(z => z > playerZ && z < playerZ + 120)
      .sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < ahead.length; i++) maxGap = Math.max(maxGap, ahead[i] - ahead[i - 1]);
    let maxY = 0;
    for (const c of active) maxY = Math.max(maxY, c.group.position.y);
    return {
      active: active.length,
      maxGapAhead: Number(maxGap.toFixed(1)),
      coverageAhead: ahead.length ? Number((ahead[ahead.length - 1] - playerZ).toFixed(0)) : 0,
      maxY: Number(maxY.toFixed(1)),
    };
  }

  function debugTeleport(player) {
    if (!active.length) return null;
    let best = active[0];
    for (const c of active) if (c.z > player.state.position.z && c.z < (best.z > player.state.position.z ? best.z : Infinity)) best = c;
    const pos = [best.group.position.x, best.group.position.y, best.z];
    player.state.position.set(pos[0], pos[1], pos[2] - 2);
    return pos;
  }

  return { update, reset, debugInfo, debugTeleport, active };
}
