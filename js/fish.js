import * as THREE from 'three';

// Builds the cartoony flying fish from primitives. No external model needed.
// Exposes handles the player controller animates: tail, wings, fins, eyes, squash.

export function createFish() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff8c42, roughness: 0.55, metalness: 0.05 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xffe3c2, roughness: 0.6 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.5, emissive: 0x000000 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), bodyMat);
  body.scale.set(1.05, 0.85, 2.0);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.92, 20, 14), bellyMat);
  belly.scale.set(0.95, 0.62, 1.7);
  belly.position.y = -0.28;

  // Tail: three-lobe fin on a pivot so it can wiggle.
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0, -1.9);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 4), finMat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.6;
  tail.scale.set(1, 1, 0.18);
  const tailTop = tail.clone(); tailTop.position.set(0, 0.35, -0.55); tailTop.rotation.z = -0.5;
  const tailBottom = tail.clone(); tailBottom.position.set(0, -0.35, -0.55); tailBottom.rotation.z = 0.5;
  tailPivot.add(tail, tailTop, tailBottom);

  // Dorsal fin
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 4), finMat);
  dorsal.rotation.x = -Math.PI / 2;
  dorsal.scale.set(1, 1, 0.16);
  dorsal.position.set(0, 0.72, -0.2);

  // Side "wings" (the flight surfaces that scale with tier)
  const wingGeom = new THREE.ConeGeometry(0.5, 1.6, 4);
  const wingL = new THREE.Mesh(wingGeom, finMat);
  wingL.rotation.z = Math.PI / 2;
  wingL.scale.set(0.18, 1, 1);
  wingL.position.set(1.0, 0.05, 0.2);
  const wingR = wingL.clone();
  wingR.rotation.z = -Math.PI / 2;
  wingR.position.set(-1.0, 0.05, 0.2);

  // Eyes
  const eyeGeom = new THREE.SphereGeometry(0.17, 12, 10);
  const pupilGeom = new THREE.SphereGeometry(0.08, 10, 8);
  const eyes = [];
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeom, eyeWhite);
    eye.position.set(side * 0.62, 0.32, 1.25);
    const pupil = new THREE.Mesh(pupilGeom, eyeBlack);
    pupil.position.set(side * 0.68, 0.34, 1.38);
    eyes.push(pupil);
    group.add(eye, pupil);
  }

  group.add(body, belly, tailPivot, dorsal, wingL, wingR);
  group.name = 'fish';

  return {
    group,
    refs: { body, belly, tailPivot, dorsal, wingL, wingR, finMat, eyes },
  };
}

// Per-frame character animation. `phase` drives idle-swim vs flight blending.
export function animateFish(fish, { time, speed, wingScale, stretch, banking }) {
  const { tailPivot, wingL, wingR, dorsal, finMat } = fish.refs;
  const wiggle = Math.sin(time * (6 + speed * 0.12)) * (0.25 + Math.min(speed, 60) * 0.004);
  tailPivot.rotation.y = wiggle;
  dorsal.rotation.z = wiggle * 0.3;
  wingL.rotation.x = Math.sin(time * 4) * 0.18;
  wingR.rotation.x = -wingL.rotation.x;

  const flap = wingScale;
  wingL.scale.set(flap, 1, 1);
  wingR.scale.set(flap, 1, 1);
  wingL.position.x = 1.0 * Math.max(flap, 0.001) + 0.35;
  wingR.position.x = -wingL.position.x;

  // Squash & stretch along travel direction
  fish.group.scale.set(1 - stretch * 0.5, 1 - stretch * 0.3, 1 + stretch);
  fish.group.rotation.z = banking * 0.6;

  return { wiggle };
}

export function setTrailColor(fish, hex) {
  fish.refs.finMat.emissive.set(hex);
  fish.refs.finMat.emissiveIntensity = 0.85;
}
