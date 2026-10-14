import * as THREE from 'three';
import { FLIGHT } from './config.js';

// ---- puff source: the single seam between procedural art and a supplied texture.
// Today: a canvas texture with clustered overlapping blobs (dense core, soft
// edges) — much less hollow than the old single-gradient blob. To use a
// supplied cloud texture instead, replace ONLY this function with
//   () => new THREE.TextureLoader().load('assets/models/skyboxes/<file>.png')
// (set .colorSpace = SRGBColorSpace and wrapS/T = RepeatWrapping as below).
// Everything below (clumps, layout, wrap) is texture-agnostic.

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t >>> 0)) / 4294967296;
  };
}

export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rng = makeRng(0xc10d);
  // cluster 6 overlapping blobs into one puff: a real core with varied
  // density, soft alpha edges — not one flat gradient
  for (let i = 0; i < 6; i++) {
    const x = 128 + (rng() - 0.5) * 100;
    const y = 128 + (rng() - 0.5) * 76;
    const r = 44 + rng() * 64;
    const a = 0.4 + rng() * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft cloud surface for the SKY-WORLD slab, which tiles the texture 8x24
// across a big plane: low contrast, gentle variation, so repeats never read
// as a lattice. (The curtain above uses puffTexture() sprites — separate art.)
export function slabTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 0, 256, 256);
  const rng = makeRng(0x51ab);
  for (let i = 0; i < 5; i++) { // soft bright masses
    const x = rng() * 256, y = rng() * 256;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 110 + rng() * 70);
    g.addColorStop(0, `rgba(255,255,255,${(0.35 + rng() * 0.35).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  for (let i = 0; i < 3; i++) { // cool shading between the masses
    const x = rng() * 256, y = rng() * 256;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 80 + rng() * 60);
    g.addColorStop(0, `rgba(178,205,232,${(0.16 + rng() * 0.12).toFixed(2)})`);
    g.addColorStop(1, 'rgba(178,205,232,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cloud curtain at FLIGHT.cloudY: layered clumps (4-8 overlapping puffs each,
// two depth tints for trough shading) so it reads as a dense cloud sea from
// above and a ceiling from below, hiding the ocean from the sky world and
// vice versa. Clumps wrap around the player as whole units (never shredded
// into isolated puffs at the wrap seam).
export function createClouds(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const tex = puffTexture();
  const RANGE = 260; // wrap window around the player

  const LAYERS = [
    { y: FLIGHT.cloudY - 3, clumps: 18, puffScale: 30, puffs: [4, 7], opacity: 0.96, tintBack: 0.45, spread: 22 }, // cloud sea
    { y: FLIGHT.cloudY + 2.5, clumps: 14, puffScale: 40, puffs: [3, 6], opacity: 0.7, tintBack: 0.6, spread: 18 },  // ceiling
  ];

  // two depth tints per layer: bright front puffs + cool shaded rear puffs
  // (volume), and per-layer opacity so the ceiling sits softer than the sea
  const layers = LAYERS.map(cfg => ({
    cfg,
    matFront: new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: cfg.opacity, depthWrite: false, fog: false }),
    matBack: new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: cfg.opacity * 0.85, depthWrite: false, fog: false, color: 0xbcd6ef }),
  }));

  const rng = makeRng(0x5eed1);
  const clumps = [];

  for (const layer of layers) {
    const cfg = layer.cfg;
    for (let i = 0; i < cfg.clumps; i++) {
      const centerX = (rng() - 0.5) * 220;
      const centerZ = -RANGE + rng() * RANGE * 2;
      const puffs = cfg.puffs[0] + Math.floor(rng() * (cfg.puffs[1] - cfg.puffs[0] + 1));
      const clump = { centerX, centerZ, cfg, mats: layer, sprites: [] };
      for (let j = 0; j < puffs; j++) {
        const s = new THREE.Sprite(rng() < cfg.tintBack ? layer.matBack : layer.matFront);
        const size = cfg.puffScale * (0.5 + rng() * 0.9);
        // mild squash only: distant puffs must not flatten into streaks
        s.scale.set(size, size * (0.55 + rng() * 0.2), 1);
        s.userData.ox = (rng() - 0.5) * 2 * cfg.spread;
        s.userData.oz = (rng() - 0.5) * 2 * cfg.spread * 0.7;
        s.userData.oy = (rng() - 0.5) * 6;
        group.add(s);
        clump.sprites.push(s);
      }
      clumps.push(clump);
    }
  }

  function placeClump(cl) {
    for (const s of cl.sprites) {
      s.position.set(cl.centerX + s.userData.ox, cl.cfg.y + s.userData.oy, cl.centerZ + s.userData.oz);
    }
  }
  for (const cl of clumps) placeClump(cl);

  function update(_dt, playerPos) {
    for (const cl of clumps) {
      const dz = cl.centerZ - playerPos.z;
      if (dz > RANGE) { cl.centerZ -= RANGE * 2; placeClump(cl); }
      else if (dz < -RANGE) { cl.centerZ += RANGE * 2; placeClump(cl); }
    }
  }

  return { group, update, clumpCount: clumps.length };
}
