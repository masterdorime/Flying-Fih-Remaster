import * as THREE from 'three';
import { WORLD, COLLISION } from './config.js';
import { composeChunk, capsuleHit, validateChunkGaps } from './worldgen.js';
import { templateFor } from './models.js';

// Live world: chunk pool of instanced Kenney props + rock clusters, moving
// hazards, and deterministic overlap collision against the player (PRD §11).

// Watercraft (the rock class renders ship hulls since 2026-10-17, plus the
// boat/ship kinds) sail the river: bow toward the swimmer with a small
// deterministic yaw jitter. Random spin made 9-18 m hulls lie across the lane
// and fuse into neighbours; bow-forward keeps the x-footprint at the beam
// width, inside the honest hull capsule (2026-10-18). Containers join the
// small-yaw policy — their honest capsule is beam-true, so free spin is out.
const WATERCRAFT = new Set(['rock', 'boat', 'ship', 'container']);
const BOW_YAW = Math.PI; // verified in probe: native bow +z -> point at the fish

export function createWorld(scene, templates) {
  const chunks = new Map(); // index -> { group, obstacles:|{spec, mesh, baseX}[], difficulty }
  let nextIndex = 0;
  let elapsed = 0;
  let lastCrash = -99; // global crash-grace clock (i-frames, COLLISION.graceSeconds)
  // cross-chunk generation state (2026-10-18 cursor rows): chunks are composed
  // sequentially on a global cursor and chain-checked against the previous
  // chunk's tail row; reset() clears it for a fresh run
  let genState = null;

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
    const spec = composeChunk(index, difficulty, 1337, speed, genState);
    genState = { cursor: spec.cursorOut, prevRow: spec.prevRowState, prevSlalomSign: spec.prevSlalomSign };
    const group = new THREE.Group();
    const obstacles = [];
    for (const ob of spec.obstacles) {
      const tpl = templateFor(templates, ob.kind, ob.variant);
      if (!tpl) continue;
      const mesh = tpl.clone(true);
      mesh.position.set(ob.x, ob.y, index * WORLD.chunkLength + ob.z);
      mesh.rotation.y = WATERCRAFT.has(ob.kind)
        ? BOW_YAW + (ob.phase % 0.07) - 0.035 // ±2°: tips stay inside the capsule grace
        : (ob.phase * 3) % (Math.PI * 2);
      group.add(mesh);
      obstacles.push({ spec: ob, mesh, baseX: ob.x, hit: false });
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
        // collision test only for nearby props (honest hull capsule on the
        // horizontal plane — the pre-2026-10-18 vertical guard stays as-is so
        // flight clearance semantics are unchanged)
        const dy = Math.abs(mesh.position.y - playerPos.y);
        if (dy < spec.radius + playerRadius) {
          const hitRadius = spec.rx ?? spec.radius;
          const hitHalfLen = spec.rz ?? spec.radius;
          const dz = Math.abs(mesh.position.z - playerPos.z);
          if (dz > hitHalfLen + 6) continue;
          if (capsuleHit(playerPos.x, playerPos.z, { x: mesh.position.x, z: mesh.position.z, rx: hitRadius, rz: hitHalfLen }, playerRadius)) {
            // a hull that has already hit you is dead for the rest of the run;
            // the global grace still shields freshly-crashed fish from OTHER hulls
            if (!ob.hit && elapsed - lastCrash > COLLISION.graceSeconds) {
              ob.hit = true;
              lastCrash = elapsed;
              onCollision?.({
                kind: spec.kind,
                major: spec.kind === 'boat' || spec.kind === 'container' || (spec.rx ?? spec.radius) > 2.5,
                at: mesh.position.clone(),
              });
            }
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
  // x (rx + range): callers stay clear at every phase, not just this one.
  // 2026-10-18: discs carry the honest capsule half-beam (rx ?? radius).
  function obstaclesNear(z, halfRange) {
    const discs = [];
    for (const chunk of chunks.values()) {
      for (const ob of chunk.obstacles) {
        if (Math.abs(ob.mesh.position.z - z) <= halfRange) {
          const rx = ob.spec.rx ?? ob.spec.radius;
          if (ob.spec.moving) {
            discs.push({ x: ob.baseX, z: ob.mesh.position.z, radius: rx + (ob.spec.range || 0), rx, rz: ob.spec.rz ?? ob.spec.radius, moving: true });
          } else {
            discs.push({ x: ob.mesh.position.x, z: ob.mesh.position.z, radius: rx, rx, rz: ob.spec.rz ?? ob.spec.radius });
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
    genState = null; // fresh cursor + chain state for the new run
  }

  return { update, reset, chunks, debugCount, debugTeleport, debugChunksValid, obstaclesNear };
}
