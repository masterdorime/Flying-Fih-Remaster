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
export function integrateSpeed(speed, tier, dt, flying) {
  const max = maxSpeedForTier(tier);
  const accel = (TIER_PROFILE[tier] ?? TIER_PROFILE.none).accel;
  const drag = flying ? MOMENTUM.dragFly : MOMENTUM.dragSwim;
  if (speed > max) {
    const down = speed - drag * 8 * dt; // drag decays headroom faster than gravity feels
    return Math.max(max, down);
  }
  return Math.min(max + MOMENTUM.overshootHeadroom, speed + accel * dt);
}

// Exposed for the debug overlay / tests: what speed will converge to.
export function targetSpeedForTier(tier) {
  return maxSpeedForTier(tier);
}
