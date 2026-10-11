import * as THREE from 'three';
import { FLIGHT } from './config.js';

// Soft round puff drawn once on a canvas, shared by the cloud curtain and the
// sky-world floor. Cheaper than any texture file and it needs no network.
export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 30 + Math.random() * 68;
    const y = 40 + Math.random() * 48;
    const r = 22 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cloud curtain at FLIGHT.cloudY: two sprite layers so it reads as a cloud sea
// from above and a ceiling from below, hiding the ocean from the sky world and
// vice versa. Sprites wrap around the player on z so the curtain is endless.
export function createClouds(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const tex = puffTexture();
  const RANGE = 260; // wrap window around the player

  const LAYERS = [
    { y: FLIGHT.cloudY - 2.5, count: 46, scale: 34, opacity: 0.95 }, // cloud sea, seen from above
    { y: FLIGHT.cloudY + 2.0, count: 30, scale: 44, opacity: 0.8 },  // ceiling, seen from below
  ];

  const layers = LAYERS.map(cfg => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: cfg.opacity, depthWrite: false });
    const sprites = [];
    for (let i = 0; i < cfg.count; i++) {
      const s = new THREE.Sprite(mat);
      const scale = cfg.scale * (0.6 + Math.random() * 0.8);
      s.scale.set(scale, scale * 0.55, 1);
      s.position.set(
        (Math.random() - 0.5) * 220,
        cfg.y + (Math.random() - 0.5) * 6,
        -RANGE + Math.random() * RANGE * 2,
      );
      group.add(s);
      sprites.push(s);
    }
    return sprites;
  });

  function update(_dt, playerPos) {
    for (const sprites of layers) {
      for (const s of sprites) {
        const dz = s.position.z - playerPos.z;
        if (dz > RANGE) s.position.z -= RANGE * 2;
        else if (dz < -RANGE) s.position.z += RANGE * 2;
      }
    }
  }

  return { group, update };
}
