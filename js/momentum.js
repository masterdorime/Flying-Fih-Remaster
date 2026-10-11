// PlayerMomentumController (PRD §6). Pure: no rendering, no three.js. Node-testable.

import { MOMENTUM, SPEED_BOOST, TIER_PROFILE } from './config.js';

export function maxSpeedForTier(tier) {
  return (TIER_PROFILE[tier] ?? TIER_PROFILE.none).maxSpeed;
}

// Speed change API (PRD §6.3). A miss never drops below MinSpeed; boosts may
// overshoot the tier cap by a bounded headroom (drag pulls it back).
export function applyTimingResult(speed, tier, result) {
  const table = SPEED_BOOST[result];
  if (!table) return speed;
  const boost = table[tier] ?? table.low;
  const next = speed + boost;
  if (result === 'miss') return Math.max(MOMENTUM.minSpeed, next);
  const cap = maxSpeedForTier(tier) + MOMENTUM.overshootHeadroom;
  return Math.min(next, cap);
}

// Per-second integration: accelerate toward the tier cap, drag pulls overshoot back down.
// accelOverride: pass 0 for a stalled fish (falling with no thrust).
export function integrateSpeed(speed, tier, dt, flying, accelOverride) {
  const max = maxSpeedForTier(tier);
  const accel = accelOverride ?? (TIER_PROFILE[tier] ?? TIER_PROFILE.none).accel;
  const drag = flying ? MOMENTUM.dragFly : MOMENTUM.dragSwim;
  if (speed > max) {
    const down = speed - drag * 8 * dt; // drag decays headroom faster than gravity feels
    return Math.max(max, down);
  }
  if (accel <= 0) return speed; // stalled: no thrust while falling
  return Math.min(max + MOMENTUM.overshootHeadroom, speed + accel * dt);
}

// Normalized momentum 0..1 for the adaptive music controller (reuses game speed;
// there is no separate momentum source of truth).
export function normalizeSpeed(speed, min = MOMENTUM.minSpeed, max = 110) {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (speed - min) / (max - min)));
}

// Exposed for the debug overlay / tests: what speed will converge to.
export function targetSpeedForTier(tier) {
  return maxSpeedForTier(tier);
}
