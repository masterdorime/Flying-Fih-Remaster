import * as THREE from 'three';
import { CAMERA } from './config.js';

// CameraSpeedReactor (PRD §16). Follow + FOV response + turn tilt.
// Kick/shake are wired in Task 9.
export function createCamera(camera, settings) {
  const shakeState = { time: 0, strength: 0 };
  const kickState = { time: 0, strength: 0 };
  const lastShakeOffset = new THREE.Vector3();
  const cinematic = { active: false, t: 0 };

  function setCinematic(active, t = 0) {
    cinematic.active = active;
    cinematic.t = t;
  }

  function kick(strength = CAMERA.tierUpKick) {
    kickState.strength = strength;
    kickState.time = 0.35;
  }

  function shake(strength = CAMERA.missShake) {
    shakeState.strength = strength;
    shakeState.time = 0.45;
  }

  function update(dt, playerState, profileFov) {
    const p = playerState.position;

    // cinematic leap: orbit close around the fish, rise with it, FOV punch —
    // the camera owns itself until the leap ends, then the follow cam resumes
    if (cinematic.active) {
      const t = THREE.MathUtils.clamp(cinematic.t, 0, 1);
      const theta = Math.PI * 0.9 * t;
      const radius = THREE.MathUtils.lerp(6.5, 11, t);
      camera.position.set(
        p.x + Math.sin(theta) * radius,
        p.y + THREE.MathUtils.lerp(2.5, 6.5, t) + t * 2,
        p.z + Math.cos(theta) * radius - 3,
      );
      camera.lookAt(p.x, p.y + 1 + t * 4, p.z + 4);
      const punch = Math.sin(t * Math.PI); // peaks mid-rise, settled at both ends
      const targetFov = THREE.MathUtils.lerp(profileFov, 95, punch);
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
      return;
    }

    const lag = Math.min(1, dt / CAMERA.positionLag);

    const behind = CAMERA.distance + (kickState.time > 0 ? kickState.strength * 4 : 0);
    const desiredX = p.x * 0.8;
    const desiredY = p.y + CAMERA.height;
    const desiredZ = p.z - behind;
    camera.position.x += (desiredX - camera.position.x) * lag;
    camera.position.y += (desiredY - camera.position.y) * lag;
    camera.position.z += (desiredZ - camera.position.z) * lag;

    lastShakeOffset.set(0, 0, 0);
    if (shakeState.time > 0) {
      shakeState.time -= dt;
      const s = shakeState.strength * settings.cameraShake;
      lastShakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0);
      camera.position.add(lastShakeOffset);
    }
    if (kickState.time > 0) {
      kickState.time -= dt;
      kickState.strength *= 1 - dt * 3;
    }

    // FOV response: tier FOV + speed surge
    const targetFov = profileFov + Math.min(6, Math.max(0, (playerState.speed - 25) * CAMERA.fovSpeedResponse * 0.4));
    camera.fov += (Math.min(CAMERA.maxFov, targetFov) - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();

    const look = new THREE.Vector3(p.x * 0.9, p.y + 1.2, p.z + CAMERA.lookAhead);
    camera.lookAt(look);
    // tilt on turning
    camera.rotateZ(playerState.banking * 0.12 * settings.cameraShake + 0);
  }

  return { update, kick, shake, shakeOffset: () => lastShakeOffset.length(), setCinematic };
}
