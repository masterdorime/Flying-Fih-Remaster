import * as THREE from 'three';
import { CAMERA } from './config.js';

// CameraSpeedReactor (PRD §16). Follow + FOV response + turn tilt.
// Kick/shake are wired in Task 9.
export function createCamera(camera, settings) {
  const shakeState = { time: 0, strength: 0 };
  const kickState = { time: 0, strength: 0 };
  const lastShakeOffset = new THREE.Vector3();

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

  return { update, kick, shake, shakeOffset: () => lastShakeOffset.length() };
}
