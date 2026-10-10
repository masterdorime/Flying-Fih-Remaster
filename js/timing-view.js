import * as THREE from 'three';

// Timing prompt visual: shrinking double ring (PRD §7.5).
// The BLUE (Good) ring is the shrinking timer — it starts big and collapses.
// The GOLD (Perfect) ring is a FIXED target. The blue ring passes through the
// gold ring at the perfect moment, so "hit when they align" is readable at any speed.

const SPAWN_SCALE = 3.4;  // blue ring radius (group units) when the prompt appears
const END_SCALE = 0.55;   // blue ring radius when the prompt expires
// At the perfect moment (progress 0.5) blue is exactly at the gold radius:
const TARGET_SCALE = (SPAWN_SCALE + END_SCALE) / 2;

export function createTimingRing() {
  const group = new THREE.Group();
  group.visible = false;

  const goodMat = new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const perfectMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });

  // Blue timer ring: lives in its own pivot so it can shrink independently.
  const goodPivot = new THREE.Group();
  const good = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 48), goodMat);
  goodPivot.add(good);

  // Gold target ring: constant size, always visible, never shrinks.
  const perfect = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 48), perfectMat);
  perfect.scale.setScalar(TARGET_SCALE);

  group.add(goodPivot, perfect);

  function setProgress(progress) {
    const t = Math.min(1, Math.max(0, progress));
    goodPivot.scale.setScalar(SPAWN_SCALE * (1 - t) + END_SCALE);
    // glow both rings as they converge; gold pulses when blue is on top of it
    const convergence = Math.max(0, 1 - Math.abs(t - 0.5) * 5);
    perfectMat.opacity = 0.75 + convergence * 0.25;
    goodMat.opacity = 0.5 + 0.35 * (1 - convergence);
    perfect.rotation.z -= 0.01;
    goodPivot.rotation.z += 0.014;
  }

  function flash(result) {
    const color = result === 'perfect' ? 0xffd54a : result === 'good' ? 0x7dff9a : 0xff5e5b;
    goodMat.color.set(color);
    perfectMat.color.set(color);
    goodPivot.scale.setScalar(TARGET_SCALE * 1.3);
    group.visible = true;
  }

  function resetColors() {
    goodMat.color.set(0x4dd2ff);
    perfectMat.color.set(0xffd54a);
    goodMat.opacity = 0.8;
    perfectMat.opacity = 0.95;
  }

  return { group, setProgress, flash, resetColors, TARGET_SCALE };
}
