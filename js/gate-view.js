import * as THREE from 'three';
import { GATE } from './config.js';
import { surfaceHeight } from './wave.js';

// Momentum-gate visual: an upright portal standing perpendicular to travel.
// World-space, ahead of the fish — never a camera-facing overlay, so the
// chase view stays clean. Torus + inner highlight + faint inner disc.
export function createGateView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // fog PARTICIPATES (T11 cohesion): these were fog:false, so the ring never dissolved with
  // distance while every prop and the sea did — one more way the objective looked dropped
  // into the frame instead of living in the air.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.9, depthWrite: false });
  const innerMat = new THREE.MeshBasicMaterial({ color: 0x1e6fd9, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x7dd3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  // CLOCK rings get their own colour and a second concentric ring (2026-10-22). The player must know
  // which cue is coming BEFORE committing to the ring — the user's explicit choice — so the difference
  // is in the world, not only in the prompt that appears after crossing. CLOSING keeps the plain cyan.
  const clockMat = new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.85, depthWrite: false });

  const torus = new THREE.Mesh(new THREE.TorusGeometry(GATE.outerRadius, 0.18, 16, 48), ringMat);
  const highlight = new THREE.Mesh(new THREE.RingGeometry(GATE.outerRadius - 0.34, GATE.outerRadius - 0.1, 48), innerMat);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(GATE.mouthRadius, 48), discMat);
  const clockRing = new THREE.Mesh(new THREE.TorusGeometry(GATE.outerRadius * 0.64, 0.14, 12, 40), clockMat);
  clockRing.visible = false;

  const spin = new THREE.Group();
  spin.add(highlight, clockRing);
  group.add(torus, spin, disc);
  group.traverse(o => { o.renderOrder = 998; o.frustumCulled = false; });

  const RING = 0x4dd2ff, GOLD = 0xffd54a, GOOD = 0x7dff9a, BAD = 0xff5e5b, CLOCK = 0xc77dff;
  const baseRing = new THREE.Color(RING);
  const baseClock = new THREE.Color(CLOCK);
  const FLASH_SECONDS = 0.25;
  let flashLeft = 0;

  function update(_dt, gate, playerPos, runTime, locomotion) {
    // a result flash keeps the group alive for FLASH_SECONDS even after the
    // gate resolves (game nulls the gate in the same tick)
    flashLeft = Math.max(0, flashLeft - 1 / 60);
    if (!gate) {
      if (flashLeft > 0) { group.visible = true; spin.rotation.z += 0.02; }
      else group.visible = false;
      return;
    }
    group.visible = true;
    const isClock = gate.style === 'clock';
    clockRing.visible = isClock;
    disc.material.opacity = isClock ? 0.2 : 0.12;
    // swim gates ride the wave so the portal never floats detached from the sea
    const flying = locomotion === 'fly' || locomotion === 'leap';
    const y = flying ? gate.y : surfaceHeight(gate.x, gate.z, runTime) + GATE.swimLift;
    group.position.set(gate.x, y, gate.z);
    if (flashLeft <= 0) spin.rotation.z += 0.02;

    // proximity tint: gold as the fish nears the central axis
    if (playerPos && flashLeft <= 0) {
      const d = Math.hypot(playerPos.x - gate.x, playerPos.y - y);
      const near = Math.max(0, 1 - d / (GATE.mouthRadius + 2));
      torus.material.color.copy(isClock ? baseClock : baseRing).lerp(GOLD, near * 0.8);
      const pulse = 1 + Math.sin(runTime * 3) * 0.02;
      torus.scale.setScalar(pulse);
    }
  }

  function flash(result, _now) {
    const c = result === 'perfect' ? GOLD : result === 'good' ? GOOD : BAD;
    torus.material.color.set(c);
    disc.material.color.set(c);
    torus.scale.setScalar(1.25);
    flashLeft = FLASH_SECONDS; // group stays visible + colored for the flash
  }

  function resetColors() {
    torus.material.color.set(RING);
    disc.material.color.set(0x7dd3ff);
    torus.scale.setScalar(1);
  }

  function debugInfo() {
    return { visible: group.visible, flashLeft: Number(flashLeft.toFixed(2)) };
  }

  return { group, update, flash, resetColors, debugInfo };
}


