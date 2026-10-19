import * as THREE from 'three';
import { surfaceHeight } from './wave.js';

import { createTrail, trailPush, wakeWidthForSpeed } from './wake-trail.js';
export { createTrail, trailPush, wakeWidthForSpeed };

// ---- toon wake: history ribbon + expanding ripple pool ----

const TRAIL_MAX = 24;       // surface samples (~2.9s of travel at full rate)
const SAMPLE_SECONDS = 0.12;
const RIPPLE_POOL = 24;
const RIPPLE_LIFE = 1.2;
const FOAM = new THREE.Color(0xffffff);
const FADE = new THREE.Color(0x0a3f7a); // dissolves into the deep-blue layer

export function createWake(scene) {
  const trail = createTrail(TRAIL_MAX, 0.8);
  let sampleAcc = 0;
  let rippleAcc = 0;
  let widenBoost = 0; // acceleration burst, decays
  let lastSpeed = 8;

  // ribbon: preallocated triangle strip, head = newest sample
  const positions = new Float32Array(TRAIL_MAX * 2 * 3);
  const colors = new Float32Array(TRAIL_MAX * 2 * 3);
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ribbonGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const index = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  ribbonGeo.setIndex(index);
  const ribbonMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.6,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.frustumCulled = false;
  ribbon.visible = false;
  ribbon.renderOrder = 2; // above the water (which disables depthWrite)
  scene.add(ribbon);

  // ripples: recycled flat rings that expand and fade
  const rippleGeo = new THREE.RingGeometry(0.8, 1.0, 40);
  rippleGeo.rotateX(-Math.PI / 2);
  const ripples = [];
  for (let i = 0; i < RIPPLE_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: FOAM.clone(), transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(rippleGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    ripples.push({ mesh, age: Infinity, x: 0, z: 0 });
  }

  function spawnRipple(x, z) {
    let slot = ripples.find(r => r.age >= RIPPLE_LIFE);
    if (!slot) slot = ripples.reduce((a, b) => (a.age > b.age ? a : b));
    slot.age = 0;
    slot.x = x;
    slot.z = z;
  }

  function burst(x, z, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      spawnRipple(x + Math.cos(a) * (0.8 + i * 0.25), z + Math.sin(a) * (0.8 + i * 0.25));
    }
    widenBoost = 1.8;
  }

  function reset() {
    trail.points.length = 0;
    sampleAcc = 0;
    rippleAcc = 0;
    widenBoost = 0;
    for (const r of ripples) { r.age = Infinity; r.mesh.visible = false; }
    ribbon.visible = false;
  }

  function update(dt, player, locomotion, runTime) {
    const swimming = locomotion === 'swim' || locomotion === 'charge';
    const accel = dt > 0 ? (player.speed - lastSpeed) / dt : 0;
    lastSpeed = player.speed;
    // hard acceleration briefly whitens the wake (takeoff surge, big perfect)
    if (swimming && accel > 25) widenBoost = Math.max(widenBoost, 1.5);
    widenBoost = Math.max(0, widenBoost - dt * 1.2);

    if (swimming) {
      sampleAcc += dt;
      if (sampleAcc >= SAMPLE_SECONDS) {
        sampleAcc = 0;
        trailPush(trail, player.position.x, player.position.z, runTime);
      }
      // steady ripple drip around (not centered on) the contact point, faster
      // when faster — offset spawn so ripples never form a halo on the fish
      rippleAcc += dt * (0.6 + player.speed / 40);
      if (rippleAcc > 0.55) {
        rippleAcc = 0;
        const a = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 1.0;
        spawnRipple(player.position.x + Math.cos(a) * r, player.position.z + Math.sin(a) * r * 0.6 - 0.8);
      }
    }

    // ribbon follows the recorded history, so turns curve it naturally.
    // V-shape: narrow at the hull (head), spreading astern as the foam
    // disperses — never a uniform runway. Edges wobble so the foam reads
    // irregular, not road-straight; color dissolves fast so old water calms.
    const pts = trail.points;
    const n = pts.length;
    if (n >= 2) {
      const widthScale = wakeWidthForSpeed(player.speed) * (1 + widenBoost * 0.5);
      const baseHalf = 0.75 * widthScale;
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const p = pts[n - 1 - i]; // i = 0 is the head (newest)
        const ageFrac = i / (TRAIL_MAX - 1);
        const q = pts[Math.max(0, n - 2 - i)];
        let dx = p.x - q.x, dz = p.z - q.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const half = (baseHalf * (0.3 + ageFrac * 1.1) + 0.05) * (1 + 0.25 * Math.sin(i * 1.7));
        // the ribbon samples the surface at each point, but it is FLAT across its own
        // width, so a wider amplitude lets a crest cut through its edges. Raised with the
        // field (0.06 -> 0.15) — a cosmetic lift, not a clearance rule: the ribbon draws
        // over the water with depthWrite off either way.
        const y = surfaceHeight(p.x, p.z, runTime) + 0.15;
        const o = i * 6;
        positions[o] = p.x - dz * half; positions[o + 1] = y; positions[o + 2] = p.z + dx * half;
        positions[o + 3] = p.x + dz * half; positions[o + 4] = y; positions[o + 5] = p.z - dx * half;
        c.copy(FOAM).lerp(FADE, Math.min(1, ageFrac * 2.0));
        colors[o] = c.r; colors[o + 1] = c.g; colors[o + 2] = c.b;
        colors[o + 3] = c.r; colors[o + 4] = c.g; colors[o + 5] = c.b;
      }
      ribbonGeo.attributes.position.needsUpdate = true;
      ribbonGeo.attributes.color.needsUpdate = true;
      ribbonGeo.setDrawRange(0, (n - 1) * 6);
      ribbonMat.opacity = swimming ? 0.5 : 0.2;
      ribbon.visible = true;
    } else {
      ribbon.visible = false;
    }
    // airborne: the recorded trail drains away, nothing new is sampled
    if (!swimming && pts.length) {
      const drain = Math.min(pts.length, Math.ceil(dt / SAMPLE_SECONDS));
      pts.splice(0, drain);
    }

    for (const r of ripples) {
      if (r.age >= RIPPLE_LIFE) { r.mesh.visible = false; continue; }
      r.age += dt;
      const k = Math.min(1, r.age / RIPPLE_LIFE);
      const s = 1 + k * 1.6;
      r.mesh.scale.set(s, 1, s);
      r.mesh.position.set(r.x, surfaceHeight(r.x, r.z, runTime) + 0.12, r.z);
      r.mesh.material.opacity = 0.65 * (1 - k);
      r.mesh.visible = true;
    }
  }

  function debugInfo() {
    let minX = Infinity, maxX = -Infinity;
    for (const p of trail.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    return {
      trailPoints: trail.points.length,
      ripplesActive: ripples.filter(r => r.age < RIPPLE_LIFE).length,
      ribbonVisible: ribbon.visible,
      spreadX: trail.points.length ? maxX - minX : 0,
    };
  }

  return { update, reset, burst, debugInfo };
}
