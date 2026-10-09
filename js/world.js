import * as THREE from 'three';
import { WORLD } from './config.js';
import { generateChunk, hasSafeCorridor } from './worldgen.js';
import { templateFor } from './models.js';

// Live world: chunk pool of instanced Kenney props + rock clusters, moving
// hazards, and deterministic overlap collision against the player (PRD §11).

export function createWorld(scene, templates) {
  const chunks = new Map(); // index -> { group, obstacles:|{spec, mesh, baseX, lastHit}[], difficulty }
  let nextIndex = 0;
  let elapsed = 0;

  function ensureChunks(playerZ, difficulty) {
    const wantFrom = Math.floor((playerZ - WORLD.chunksBehind * WORLD.chunkLength) / WORLD.chunkLength);
    const wantTo = wantFrom + WORLD.chunksAhead + WORLD.chunksBehind;
    while (nextIndex < wantTo) {
      chunks.set(nextIndex, buildChunk(nextIndex, difficulty));
      nextIndex++;
    }
    for (const [i, chunk] of chunks) {
      if (i < wantFrom) { scene.remove(chunk.group); chunks.delete(i); }
    }
  }

  function buildChunk(index, difficulty) {
    const spec = generateChunk(index, difficulty, 1337);
    const group = new THREE.Group();
    const obstacles = [];
    for (const ob of spec.obstacles) {
      const tpl = templateFor(templates, ob.kind);
      if (!tpl) continue;
      const mesh = tpl.clone(true);
      mesh.position.set(ob.x, ob.y, index * WORLD.chunkLength + ob.z);
      mesh.rotation.y = (ob.phase * 3) % (Math.PI * 2);
      group.add(mesh);
      obstacles.push({ spec: ob, mesh, baseX: ob.x, lastHit: -99 });
    }
    scene.add(group);
    return { group, obstacles, difficulty, z0: index * WORLD.chunkLength };
  }

  function update(dt, playerPos, playerRadius, difficulty, onCollision) {
    elapsed += dt;
    ensureChunks(playerPos.z, difficulty);

    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        const { spec, mesh } = ob;
        if (spec.moving) {
          const sign = Math.sign(ob.baseX) || 1;
          const mag = Math.abs(ob.baseX + Math.sin(elapsed * spec.speed + spec.phase) * spec.range);
          const limit = WORLD.corridorHalfWidth + spec.radius;
          mesh.position.x = sign * Math.min(WORLD.laneHalfWidth, Math.max(limit, mag));
        }
        // collision test only for nearby props
        const dz = Math.abs(mesh.position.z - playerPos.z);
        if (dz > spec.radius + 6) continue;
        const dx = Math.abs(mesh.position.x - playerPos.x);
        const dy = Math.abs(mesh.position.y - playerPos.y);
        const reach = spec.radius + playerRadius;
        if (dx < reach && dz < reach + 2 && dy < reach) {
          if (elapsed - ob.lastHit > 0.5) { // grace window, PRD collision recovery
            ob.lastHit = elapsed;
            onCollision?.({
              kind: spec.kind,
              major: spec.kind === 'boat' || spec.kind === 'container' || spec.radius > 2.5,
              at: mesh.position.clone(),
            });
          }
        }
      }
    }
  }

  function clampX(x, radius) {
    const limit = Math.max(WORLD.corridorHalfWidth + radius, 0.5);
    return Math.min(WORLD.laneHalfWidth, Math.max(limit, x));
  }

  // ---- debug helpers (automated verification) ----
  function debugCount() {
    let n = 0;
    for (const chunk of chunks.values()) n += chunk.obstacles.length;
    return n;
  }

  function debugTeleport(player) {
    // put the fish exactly on the nearest upcoming obstacle
    const pz = player.state.position.z;
    let best = null;
    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        const z = ob.mesh.position.z;
        if (z > pz && (!best || z < best.z)) best = { x: ob.mesh.position.x, y: ob.mesh.position.y, z };
      }
    }
    if (best) {
      player.state.position.set(best.x, best.y, best.z - 4);
    }
  }

  function debugCorridorClear() {
    for (const chunk of chunks.values()) {
      if (!hasSafeCorridor(chunk)) return false;
    }
    return true;
  }

  function reset() {
    for (const chunk of chunks.values()) scene.remove(chunk.group);
    chunks.clear();
    nextIndex = 0;
  }

  return { update, reset, chunks, debugCount, debugTeleport, debugCorridorClear };
}
