import * as THREE from 'three';
import { FLIGHT, WORLD } from './config.js';
import { puffTexture } from './clouds.js';
import { SEA_AREA, SEA_BANDS, skyBands, skyPuffCount, seaTopY } from './sky-layers.js';

// The sky world above the cloud curtain: a VAST SEA OF CLOUD, and the fish flies just over it.
//
// Rebuilt 2026-10-23 (phase 4). What was here before was a placeholder (its own header said so): ONE plane
// carrying a soft-alpha texture, plus ten Kenney props floating in the air. The plane's gaps were
// see-through — the user's "no hollow on it" was pointing at a hole you could look down through to the sky
// — and the props read as isolated blocks at altitude. See js/sky-layers.js for the band data and why the
// layout makes "no hollow" a property of the numbers, and the phase-4 spec for the whole contract.
//
// Two things make this cheap enough for a software-GL rig:
//   * each band is ONE InstancedMesh, so the whole sea is 4 draw calls (plus 4 for its recycled twin);
//   * the field is a single tile that WRAPS in z around the player, so nothing is rebuilt per frame — the
//     two tiles just move. The haze (ATMOSPHERE.flight.fog) is what hides the wrap, which is why the data
//     layer asserts the field is at least twice as deep as the fog.
export function createSkyWorld(scene, coinTemplate) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const puffTex = puffTexture();
  const bands = skyBands();
  const GEOM = new THREE.PlaneGeometry(1, 1);
  GEOM.rotateX(-Math.PI / 2); // lie flat: a cloud deck seen from above, not a billboard wall

  // ---- one InstancedMesh per band, built once, used by both tiles ----
  function buildBand(band) {
    const mat = new THREE.MeshBasicMaterial({
      map: puffTex,
      transparent: true,
      opacity: band.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(GEOM, mat, band.count);
    mesh.frustumCulled = false; // the tile is always around the player
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < band.count; i++) {
      p.set(
        (Math.random() - 0.5) * SEA_AREA.x,
        band.yBottom + Math.random() * (band.yTop - band.yBottom),
        (Math.random() - 0.5) * SEA_AREA.z,
      );
      // a slight tilt plus a free yaw, so the tile never reads as a repeating texture
      e.set((Math.random() - 0.5) * 0.22, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.22);
      q.setFromEuler(e);
      const size = band.size[0] + Math.random() * (band.size[1] - band.size[0]);
      s.set(size, 1, size);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  // ---- the field, twice: one tile behind the player and one ahead, so the wrap is always off-screen ----
  const tileA = new THREE.Group();
  const tileB = new THREE.Group();
  for (const band of bands) {
    const a = buildBand(band);
    tileA.add(a);
    const b = buildBand(band); // its own matrices: the two tiles must not read as one repeated grid
    tileB.add(b);
  }
  group.add(tileA, tileB);

  // ---- cloud towers: the landmarks a distant object gives (parallax = a sense of speed) without the
  // "isolated block props" the user asked to be rid of. Behind a debug seam because the user wants to
  // choose between this and a purely open sea from RENDERED PICTURES, not from a description.
  const TOWER_COUNT = 5;
  const TOWER_PUFFS = 11;
  const towerMesh = new THREE.InstancedMesh(
    GEOM,
    new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    TOWER_COUNT * TOWER_PUFFS,
  );
  towerMesh.frustumCulled = false;
  // OFF by default, deliberately (2026-10-23). Three renders failed to show them — first lateral and then
  // outside the camera's cone, then unrecycled and left behind — and an unverified decoration must not ship
  // as part of the look. The switch exists so the choice can be made from a FAIR pair of pictures once they
  // render; until then the shipped flight is the open sea, which IS verified.
  towerMesh.visible = false;
  group.add(towerMesh);
  const towers = [];
  function placeTower(tower, i0) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    const width = 90 + Math.random() * 90;
    for (let k = 0; k < TOWER_PUFFS; k++) {
      const f = k / (TOWER_PUFFS - 1); // 0 at the sea's surface, 1 at the top
      p.set(
        tower.x + (Math.random() - 0.5) * width * 0.5,
        seaTopY() - 6 + f * (70 + Math.random() * 60),
        tower.z + (Math.random() - 0.5) * width * 0.5,
      );
      e.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
      q.setFromEuler(e);
      s.set(width * (1 - f * 0.45) * (0.9 + Math.random() * 0.5), 1, width * (1 - f * 0.45) * (0.9 + Math.random() * 0.5));
      towerMesh.setMatrixAt(i0 + k, m4.compose(p, q, s));
    }
    towerMesh.instanceMatrix.needsUpdate = true;
  }
  function layoutTowers(seedZ) {
    towers.length = 0;
    for (let t = 0; t < TOWER_COUNT; t++) {
      const side = t % 2 === 0 ? -1 : 1;
      // AHEAD, not beside: the first attempt put them 420-900 m LATERAL, and the chase camera looks
      // forward — so they were off-screen rather than hazed, and the on/off pictures came out identical
      // twice. x stays clear of the lane (corridor ±~20) and z is ahead, so they pass by rather than sit in it.
      towers.push({ x: side * (150 + Math.random() * 320), z: seedZ + 150 + Math.random() * 600 });
      placeTower(towers[t], t * TOWER_PUFFS);
    }
  }
  // and they RECYCLE. Laid out once and left alone, they were behind the fish within a few hundred metres —
  // which is what made the with/without pictures identical even after the lateral fix.
  function recycleTowers(playerZ) {
    for (let t = 0; t < towers.length; t++) {
      const tower = towers[t];
      if (tower.z > playerZ - 260) continue;
      tower.z = playerZ + 350 + Math.random() * 500;
      tower.x = (t % 2 === 0 ? -1 : 1) * (150 + Math.random() * 320);
      placeTower(tower, t * TOWER_PUFFS);
    }
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
    layoutTowers(playerZ);
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
    // the two tiles ride the player and wrap on the field's own period (see the header)
    const period = SEA_AREA.z;
    const base = Math.floor(playerPos.z / period) * period;
    tileA.position.set(playerPos.x, 0, base);
    tileB.position.set(playerPos.x, 0, base + period);
    recycleTowers(playerPos.z);
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

  function reset(playerZ) { resetLayout(playerZ); }

  function setTowersVisible(on) { towerMesh.visible = !!on; }

  function debugInfo(playerZ) {
    let ahead = 0;
    for (const g of trailCoins) if (g.position.z > playerZ && g.position.z < playerZ + 300) ahead++;
    return {
      visible: group.visible,
      bands: bands.length,
      puffs: skyPuffCount(),
      seaTop: seaTopY(),
      props: 0, // the ten Kenney props are gone: they were the "isolated block objects"
      towers: towerMesh.visible,
      draws: (tileA.children.length + tileB.children.length) + (towerMesh.visible ? 1 : 0),
      trailAhead: ahead,
    };
  }

  return { group, update, reset, debugInfo, setTowersVisible };
}
