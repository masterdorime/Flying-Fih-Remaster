import * as THREE from 'three';
import { MOMENTUM, WORLD, RECOVERY, PLANE, ASSIST, FLIGHT, WATER, TIER_PROFILE } from './config.js';
import { integrateSpeed } from './momentum.js';
import { profileFor } from './flight-state.js';
import { surfaceHeight, waveSlopes } from './wave.js';

// PlayerMovementController + PlayerMomentumController runtime (PRD §4, §6, §9, §10).
// Locomotion is a phase machine:
//   swim    — locked to the ocean surface; the gauge fills here
//   charge  — first flight only: the SPAM-QTE ritual at the surface
//   leap    — scripted cinematic rise through the cloud curtain
//   fly     — fixed high altitude; Perfect hits refill the gauge
//   descend — the gauge emptied: sink back through the clouds to the ocean
export function createPlayer(scene, fish) {
  const state = {
    position: new THREE.Vector3(0, RECOVERY.waterY, 0),
    lateralVel: 0,
    verticalVel: 0,
    yaw: 0,
    banking: 0,
    pitch: 0,            // wave-slope nose pitch while swimming
    waveRoll: 0,         // wave-slope body roll while swimming
    speed: MOMENTUM.minSpeed,
    locomotion: 'swim',
    leapT: 0,               // 0..1 cinematic progress during 'leap'
    cruiseY: FLIGHT.altitude, // W/S-adjustable cruise altitude while flying
    planeExitDamp: 0,
    airborneTimeAtMin: 0,
    stretch: 0,
    squashDip: 0,
    waterEntryCooldown: 0,
    chargeShake: 0,
  };

  function capFor(tier, assist) {
    const base = profileFor(tier).maxSpeed;
    return assist ? base * ASSIST.speedScale : base;
  }

  function update(dt, input, game) {
    const assist = game.state.assist;
    const tier = game.state.tier;            // single source of truth: game state
    const fly = state.locomotion === 'fly';
    const cap = capFor(tier, assist);
    const profile = profileFor(tier);
    // charge locks the fish at the surface but still lets it steer sideways to
    // aim the launch; the leap is fully scripted (no input at all)
    const moveInput = state.locomotion === 'leap' ? { x: 0, y: 0 }
      : state.locomotion === 'charge' ? { x: input.x, y: 0 }
      : input;

    // ---- forward momentum (pure integrate; never gains from direction input) ----
    // A fish pinned at MinSpeed while AIRBORNE has no thrust (it tumbles down);
    // only the water restores forward speed. That makes bad crashes endable.
    const airborne = state.locomotion !== 'swim' && state.locomotion !== 'charge' && state.position.y > RECOVERY.waterY + 2;
    const stalled = state.speed <= MOMENTUM.minSpeed + 0.01 && airborne;
    const STRUGGLE_ACCEL = 5; // slow climb back toward MinSpeed while in the water
    const accel = stalled ? 0 : (state.speed <= MOMENTUM.minSpeed + 0.01 ? STRUGGLE_ACCEL : undefined);
    const raw = integrateSpeed(state.speed, tier, dt, game.state.flying, accel);
    state.speed = Math.min(raw, cap + MOMENTUM.overshootHeadroom);

    // ---- steering (disabled while locked in a cinematic) ----
    const damp = state.planeExitDamp > 0 ? 0.35 : 1;
    const lateralTarget = moveInput.x * profile.turnRate * profile.airControl * 0.55 * damp;
    state.lateralVel += (lateralTarget - state.lateralVel) * Math.min(1, dt * 6);
    state.position.x += state.lateralVel * dt;
    if (state.position.x > WORLD.laneHalfWidth) { state.position.x = WORLD.laneHalfWidth; state.lateralVel = 0; }
    if (state.position.x < -WORLD.laneHalfWidth) { state.position.x = -WORLD.laneHalfWidth; state.lateralVel = 0; }
    state.position.z += state.speed * dt;

    // ---- vertical, per locomotion ----
    const waterY = RECOVERY.waterY;
    switch (state.locomotion) {
      case 'charge': {
        // locked at the surface, trembling as the gauge blows
        state.chargeShake += dt;
        const jitter = Math.sin(state.chargeShake * 60) * 0.35 * Math.min(1, state.chargeShake);
        state.position.y = waterY + jitter;
        state.verticalVel = 0;
        break;
      }
      case 'leap': {
        // scripted rise: anticipation dip, explosive launch, settle into the sky
        state.leapT = Math.min(1, state.leapT + dt / FLIGHT.leapSeconds);
        const t = state.leapT;
        let h;
        if (t < 0.28) h = -0.8 * Math.sin((t / 0.28) * Math.PI);        // wind-up dip
        else {
          const k = (t - 0.28) / 0.72;                                   // explosive rise
          h = Math.pow(k, 0.62) * (FLIGHT.altitude - waterY) * 1.06 - (k > 0.9 ? (k - 0.9) * 6 : 0);
        }
        state.position.y = waterY + Math.max(-1.2, h);
        state.verticalVel = 30;
        break;
      }
      case 'fly': {
        // full planar control: A/D steers (above), W/S works the cruise altitude
        state.cruiseY = THREE.MathUtils.clamp(
          state.cruiseY + moveInput.y * FLIGHT.climbRate * dt,
          FLIGHT.flyMin, FLIGHT.flyMax,
        );
        state.position.y += (state.cruiseY - state.position.y) * Math.min(1, dt * 3);
        state.verticalVel = THREE.MathUtils.clamp((state.cruiseY - state.position.y) * 3, -FLIGHT.climbRate, FLIGHT.climbRate);
        break;
      }
      case 'descend': {
        state.position.y -= FLIGHT.descendSpeed * dt;
        state.verticalVel = -FLIGHT.descendSpeed;
        if (state.position.y <= waterY) {
          const impact = Math.abs(state.verticalVel);
          state.position.y = waterY;
          state.verticalVel = 0;
          // a 30 u/s landing IS a water entry: splash + squash before the swim pose
          if (impact > 6 && state.waterEntryCooldown <= 0) {
            state.waterEntryCooldown = 0.8;
            state.squashDip = Math.min(1, impact / 12);
            game.onWaterEntry?.(impact);
          }
          game.onLanded?.();
        }
        break;
      }
      default: { // swim
        // buoyancy: ride the same wave field the water shader draws. The fish
        // bobs on swells and pitches/rolls onto the surface instead of hovering
        // on a flat line. Speed/timing/gauge/launch rules are untouched, and
        // swim vertical velocity stays far below splash thresholds (~±2 vs 6).
        const t = game.state.runTime;
        const target = surfaceHeight(state.position.x, state.position.z, t) + WATER.swimRideOffset;
        const prevY = state.position.y;
        state.position.y += (target - state.position.y) * Math.min(1, dt * WATER.buoyancyRate);
        state.verticalVel = dt > 0 ? (state.position.y - prevY) / dt : 0;
        const { ddx, ddz } = waveSlopes(state.position.x, state.position.z, t);
        const targetPitch = THREE.MathUtils.clamp(
          -Math.atan(ddz) * WATER.pitchFromSlope - state.verticalVel * 0.03, -0.6, 0.6);
        state.pitch += (targetPitch - state.pitch) * Math.min(1, dt * 5);
        const targetRoll = THREE.MathUtils.clamp(Math.atan(ddx) * WATER.rollFromSlope, -0.5, 0.5);
        state.waveRoll += (targetRoll - state.waveRoll) * Math.min(1, dt * 5);
      }
    }

    // water splash bookkeeping
    if (state.waterEntryCooldown > 0) state.waterEntryCooldown -= dt;
    if (state.position.y <= waterY + 0.05 && state.verticalVel < -6 && state.waterEntryCooldown <= 0) {
      state.waterEntryCooldown = 0.8;
      state.squashDip = Math.min(1, Math.abs(state.verticalVel) / 12);
      game.onWaterEntry?.(Math.abs(state.verticalVel));
    }

    // ---- visuals: yaw/bank/squash ----
    // Screen-right = world -X, so negative lateral velocity is a right turn:
    // yaw the nose into the turn and bank the same way (right wing dips).
    state.banking += ((state.lateralVel * 0.045 * profile.airControl) - state.banking) * Math.min(1, dt * 8);
    state.yaw = state.lateralVel * 0.02;
    const targetStretch = Math.min(0.35, (state.speed - 20) / 260);
    state.stretch += (targetStretch - state.stretch) * Math.min(1, dt * 5);
    if (state.squashDip > 0) state.squashDip = Math.max(0, state.squashDip - dt * 2.5);

    fish.group.position.copy(state.position);
    fish.group.rotation.y = state.yaw;
    fish.group.rotation.x = state.locomotion === 'swim' ? state.pitch : 0;
    fish.group.rotation.z = state.banking * 0.6 + (state.locomotion === 'swim' ? state.waveRoll : 0);
  }

  function setLocomotion(next) {
    state.locomotion = next;
    if (next !== 'leap') state.leapT = 0;
    if (next !== 'charge') state.chargeShake = 0;
    if (next === 'fly') state.cruiseY = FLIGHT.altitude; // each flight starts at the gate altitude
  }

  return { state, update, setLocomotion };
}
