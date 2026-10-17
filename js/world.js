import * as THREE from 'three';
import { WORLD, COLLISION } from './config.js';
import { generateChunk, validateChunkGaps } from './worldgen.js';
import { templateFor } from './models.js';

// Live world: chunk pool of instanced Kenney props + rock clusters, moving
// hazards, and deterministic overlap collision against the player (PRD §11).

// Watercraft (the rock class renders ship hulls since 2026-10-17, plus the
// boat/ship kinds) sail the river: bow toward the swimmer with a small
// deterministic yaw jitter. Random spin made 9-18 m hulls lie across the lane
// and fuse into neighbours; bow-forward keeps the x-footprint at the beam
// width, inside the hitbox disc. Buoys/containers keep a random spin.
const WATERCRAFT = new Set(['rock', 'boat', 'ship']);
const BOW_YAW = Math.PI; // verified in probe: native bow +z -> point at the fish

export function createWorld(scene, templates) {
  const chunks = new Map(); // index -> { group, obstacles:|{spec, mesh, baseX}[], difficulty }
  let nextIndex = 0;
  let elapsed = 0;
  let lastCrash = -99; // global crash-grace clock (i-frames, COLLISION.graceSeconds)

  function ensureChunks(playerZ, difficulty, speed) {
    const wantFrom = Math.floor((playerZ - WORLD.chunksBehind * WORLD.chunkLength) / WORLD.chunkLength);
    const wantTo = wantFrom + WORLD.chunksAhead + WORLD.chunksBehind;
    while (nextIndex < wantTo) {
      chunks.set(nextIndex, buildChunk(nextIndex, difficulty, speed));
      nextIndex++;
    }
    for (const [i, chunk] of chunks) {
      if (i < wantFrom) { scene.remove(chunk.group); chunks.delete(i); }
    }
  }

  function buildChunk(index, difficulty, speed) {
    const spec = generateChunk(index, difficulty, 1337, speed);
    const group = new THREE.Group();
    const obstacles = [];
    for (const ob of spec.obstacles) {
      const tpl = templateFor(templates, ob.kind);
      if (!tpl) continue;
      const mesh = tpl.clone(true);
      mesh.position.set(ob.x, ob.y, index * WORLD.chunkLength + ob.z);
      mesh.rotation.y = WATERCRAFT.has(ob.kind)
        ? BOW_YAW + (ob.phase % 0.24) - 0.12
        : (ob.phase * 3) % (Math.PI * 2);
      group.add(mesh);
      obstacles.push({ spec: ob, mesh, baseX: ob.x });
    }
    scene.add(group);
    return { group, obstacles, difficulty, z0: index * WORLD.chunkLength };
  }

  function update(dt, playerPos, playerRadius, difficulty, speed, onCollision) {
    elapsed += dt;
    ensureChunks(playerPos.z, difficulty, speed);

    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        const { spec, mesh } = ob;
        if (spec.moving) {
          // movers sweep the open water freely now (the generator + validator
          // already guarantee the sweep never closes the row gap) — only the
          // lane bounds still apply
          const raw = ob.baseX + Math.sin(elapsed * spec.speed + spec.phase) * spec.range;
          const sign = Math.sign(raw) || Math.sign(ob.baseX) || 1;
          mesh.position.x = sign * Math.min(WORLD.laneHalfWidth, Math.abs(raw));
        }
        // collision test only for nearby props
        const dz = Math.abs(mesh.position.z - playerPos.z);
        if (dz > spec.radius + 6) continue;
        const dx = Math.abs(mesh.position.x - playerPos.x);
        const dy = Math.abs(mesh.position.y - playerPos.y);
        const reach = spec.radius + playerRadius;
        if (dx < reach && dz < reach + 2 && dy < reach) {
          if (elapsed - lastCrash > COLLISION.graceSeconds) { // global crash grace (PRD collision recovery)
            lastCrash = elapsed;
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

  // ---- debug helpers (automated verification) ----
  function debugCount() {
    let n = 0;
    for (const chunk of chunks.values()) n += chunk.obstacles.length;
    return n;
  }

  function debugTeleport(player, nth = 0) {
    // put the fish just before the nth-nearest obstacle ahead (0 = nearest)
    const pz = player.state.position.z;
    const ahead = [];
    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        const z = ob.mesh.position.z;
        if (z > pz) ahead.push(ob);
      }
    }
    ahead.sort((a, b) => a.mesh.position.z - b.mesh.position.z);
    const ob = ahead[Math.min(nth, ahead.length - 1)];
    if (ob) {
      player.state.position.set(ob.mesh.position.x, ob.mesh.position.y, ob.mesh.position.z - 4);
    }
  }

  // Live obstacle discs near a z-plane (gate placement, coin lanes, dodge
  // probes read these). Movers report their FULL SWEEP ENVELOPE from the base
  // x (radius + range): callers stay clear at every phase, not just this one.
  function obstaclesNear(z, halfRange) {
    const discs = [];
    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        if (Math.abs(ob.mesh.position.z - z) <= halfRange) {
          if (ob.spec.moving) {
            discs.push({ x: ob.baseX, z: ob.mesh.position.z, radius: ob.spec.radius + (ob.spec.range || 0), moving: true });
          } else {
            discs.push({ x: ob.mesh.position.x, z: ob.mesh.position.z, radius: ob.spec.radius });
          }
        }
      }
    }
    return discs;
  }

  function debugChunksValid() {
    // spec.x is the layout base (only meshes move), so the pure validator
    // reads the same sweep envelopes the generator promised
    for (const chunk of chunks.values()) {
      if (!validateChunkGaps({ obstacles: chunk.obstacles.map(ob => ob.spec) })) return false;
    }
    return true;
  }

  function reset() {
    for (const chunk of chunks.values()) scene.remove(chunk.group);
    chunks.clear();
    nextIndex = 0;
  }

  return { update, reset, chunks, debugCount, debugTeleport, debugChunksValid, obstaclesNear };
}
