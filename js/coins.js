import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COINS, WORLD } from './config.js';

// Shrimp coins (player-requested mechanic): the shrimp_low_poly.glb model,
// spinning and bobbing in arcs that mark the safe lane.
// Coins affect SCORE ONLY — the gauge fills only from Perfect/Good (PRD §8.2).

export async function loadCoinModel() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('assets/models/shrimp_low_poly.glb');
  const scene = gltf.scene;
  scene.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.4 / Math.max(size.x, size.y, size.z);
  scene.scale.setScalar(scale);
  return scene;
}

export function createCoins(scene, coinTemplate) {
  const active = []; // { group, x, y, z, baseY, collected }
  let elapsed = 0;
  let nextArcAt = 8;

  function spawnArc() {
    const tone = Math.random() < 0.5 ? -1 : 1;
    const x0 = tone * (1 + Math.random() * (WORLD.corridorHalfWidth - 1));
    const z0 = playerZ + 70 + Math.random() * 30;
    const count = 4 + Math.floor(Math.random() * 3);
    const spacing = 5.5;
    for (let i = 0; i < count; i++) {
      const y = 1.6 + Math.sin((i / (count - 1)) * Math.PI) * 3.5;
      const group = coinTemplate.clone(true);
      group.position.set(x0, y, z0 + i * spacing);
      scene.add(group);
      active.push({ group, baseY: y, x: x0, y, z: z0 + i * spacing });
    }
  }

  let playerZ = 0;

  function update(dt, playerPos, onCollect) {
    elapsed += dt;
    playerZ = playerPos.z;

    while (nextArcAt < playerPos.z + 90) {
      spawnArc();
      nextArcAt += 55 + Math.random() * 60;
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const coin = active[i];
      // spin + bob
      coin.group.rotation.y += dt * 3.2;
      coin.group.position.y = coin.baseY + Math.sin(elapsed * 2 + coin.z * 0.4) * 0.35;

      const dx = coin.group.position.x - playerPos.x;
      const dy = coin.group.position.y - playerPos.y;
      const dz = coin.group.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let reach = 1.6;
      if (dist < 8) {
        // magnet drift inside the radius
        const pull = (1 - dist / 8) * dt * 14;
        coin.group.position.x -= dx * pull;
        coin.group.position.y -= dy * pull;
        if (dist < COINS.magnetRadius * 3) reach = COINS.magnetRadius * 3;
      }

      if (dist < reach) {
        onCollect?.(coin);
        scene.remove(coin.group);
        active.splice(i, 1);
        continue;
      }
      if (coin.z < playerPos.z - 40) {
        scene.remove(coin.group);
        active.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const coin of active) scene.remove(coin.group);
    active.length = 0;
    nextArcAt = 8;
  }

  function debugNearestCoinPos() {
    if (!active.length) return null;
    let best = active[0];
    for (const c of active) if (c.z < best.z) best = c;
    return [best.group.position.x, best.group.position.y, best.group.position.z];
  }

  function debugTeleport(player) {
    const pos = debugNearestCoinPos();
    if (pos) player.state.position.set(pos[0], pos[1], pos[2] - 2);
    return pos;
  }

  return { update, reset, debugNearestCoinPos, debugTeleport, active };
}
