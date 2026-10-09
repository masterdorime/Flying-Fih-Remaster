import * as THREE from 'three';
import { MOMENTUM, WORLD, RECOVERY, PLANE, ASSIST } from './config.js';
import { integrateSpeed } from './momentum.js';
import { profileFor } from './flight-state.js';

const TIER_ALTITUDE = { none: 0, low: 5, medium: 13, high: 26, max: 42 };

// PlayerMovementController + PlayerMomentumController runtime (PRD §4, §6, §9, §10).
export function createPlayer(scene, fish) {
  const state = {
    position: new THREE.Vector3(0, RECOVERY.waterY, 0),
    lateralVel: 0,
    verticalVel: 0,
    yaw: 0,
    banking: 0,
    speed: MOMENTUM.minSpeed,
    planeExitDamp: 0,
    airborneTimeAtMin: 0,
    stretch: 0,
    squashDip: 0,
    waterEntryCooldown: 0,
  };

  function capFor(tier, assist) {
    const base = profileFor(tier).maxSpeed;
    return assist ? base * ASSIST.speedScale : base;
  }

  function update(dt, input, game) {
    const assist = game.state.assist;
    const tier = game.state.tier;           // single source of truth: game state
    const planeMode = game.state.planeMode; // plane mode owned by the game too
    const cap = capFor(tier, assist);
    const profile = profileFor(tier);

    // ---- forward momentum (pure integrate; never gains from direction input) ----
    const raw = integrateSpeed(state.speed, tier, dt, game.state.flying);
    state.speed = Math.min(raw, cap + MOMENTUM.overshootHeadroom);

    // ---- steering ----
    const damp = state.planeExitDamp > 0 ? 0.35 : 1;
    const lateralTarget = input.x * profile.turnRate * profile.airControl * 0.55 * damp;
    state.lateralVel += (lateralTarget - state.lateralVel) * Math.min(1, dt * 6);
    state.position.x += state.lateralVel * dt;
    if (state.position.x > WORLD.laneHalfWidth) { state.position.x = WORLD.laneHalfWidth; state.lateralVel = 0; }
    if (state.position.x < -WORLD.laneHalfWidth) { state.position.x = -WORLD.laneHalfWidth; state.lateralVel = 0; }
    state.position.z += state.speed * dt;

    // ---- vertical ----
    const waterY = RECOVERY.waterY;
    if (planeMode) {
      const climb = input.y * PLANE.climbRate * damp; // W = +input.y = climb
      state.verticalVel += (climb - state.verticalVel) * Math.min(1, dt * 4);
      state.position.y += state.verticalVel * dt;
      state.position.y = Math.min(PLANE.climbCeiling, Math.max(waterY, state.position.y));
    } else {
      const targetY = tier === 'none'
        ? waterY
        : waterY + TIER_ALTITUDE[tier] + (game.state.gauge / 120) * 5;
      const k = Math.min(1, dt * profile.gravityScale * 2.2);
      state.position.y += (targetY - state.position.y) * k;
      state.verticalVel = (targetY - state.position.y) * profile.gravityScale;
      if (state.position.y < waterY) state.position.y = waterY;
    }

    // water entry splash bookkeeping (recovers when falling back from the sky)
    if (state.waterEntryCooldown > 0) state.waterEntryCooldown -= dt;
    if (state.position.y <= waterY + 0.05 && state.verticalVel < -6 && state.waterEntryCooldown <= 0) {
      state.waterEntryCooldown = 0.8;
      state.squashDip = Math.min(1, Math.abs(state.verticalVel) / 12);
      game.onWaterEntry?.(Math.abs(state.verticalVel));
    }

    // failure watchdog
    if (state.speed <= MOMENTUM.minSpeed && state.position.y > waterY + 2) {
      state.airborneTimeAtMin += dt;
    } else {
      state.airborneTimeAtMin = 0;
    }

    // ---- visuals ----
    state.banking += ((-state.lateralVel * 0.045 * profile.airControl) - state.banking) * Math.min(1, dt * 8);
    state.yaw = state.lateralVel * -0.02;
    const targetStretch = Math.min(0.35, (state.speed - 20) / 260);
    state.stretch += (targetStretch - state.stretch) * Math.min(1, dt * 5);
    if (state.squashDip > 0) state.squashDip = Math.max(0, state.squashDip - dt * 2.5);

    fish.group.position.copy(state.position);
    fish.group.rotation.y = state.yaw;
  }

  return { state, update };
}
