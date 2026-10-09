import * as THREE from 'three';

// Timing prompt visual: shrinking double ring (PRD §7.5).
// Outer ring = Good limit, inner ring = Perfect limit. Ring scale shrinks over
// the prompt's life so passing the perfect boundary is legible at any speed.
export function createTimingRing() {
  const group = new THREE.Group();
  group.visible = false;

  const goodMat = new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const perfectMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });

  const goodGeo = new THREE.RingGeometry(0.86, 1.0, 48);
  const good = new THREE.Mesh(goodGeo, goodMat);
  const perfect = new THREE.Mesh(goodGeo, perfectMat);

  group.add(good, perfect);

  const SPAWN_SCALE = 3.4;   // ring radius when prompt appears
  const PERFECT_FRACTION = 0.42; // inner ring = perfect boundary fraction of good

  function show() { group.visible = true; }
  function hide() { group.visible = false; }

  // progress 0..1: 0 = spawn, 0.5 = perfect moment, 1 = expired
  function setProgress(progress) {
    const t = Math.min(1, Math.max(0, progress));
    const scale = SPAWN_SCALE * (1 - t) + 0.55;
    group.scale.setScalar(scale);
    perfect.scale.setScalar(PERFECT_FRACTION * (1 - t) + 0.12);
    const pulse = 1 + Math.max(0, (0.5 - t)) * 0.15;
    group.rotation.z += 0.016;
    goodMat.opacity = 0.55 + 0.4 * pulse;
    perfectMat.opacity = t <= 0.5 ? 0.95 : 0.9 - (t - 0.5) * 1.2;
  }

  function flash(result) {
    const color = result === 'perfect' ? 0xffd54a : result === 'good' ? 0x7dff9a : 0xff5e5b;
    goodMat.color.set(color);
    perfectMat.color.set(color);
    group.scale.setScalar(SPAWN_SCALE * 1.35);
    group.visible = true;
  }

  function resetColors() {
    goodMat.color.set(0x4dd2ff);
    perfectMat.color.set(0xffd54a);
    perfectMat.opacity = 0.95;
  }

  return { group, show, hide, setProgress, flash, resetColors };
}
