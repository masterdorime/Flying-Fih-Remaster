// FlightStateMachine (PRD §9): tier profiles, plane-mode eligibility, movement scaling.

import { TIER_PROFILE } from './config.js';
import { tierForGauge } from './gauge.js';

export function profileFor(tier) {
  return TIER_PROFILE[tier] ?? TIER_PROFILE.none;
}

export function isPlaneTier(tier) {
  return tier === 'max';
}

// Player can leave the water once the gauge reaches Low tier.
export function canLeaveWater(tier) {
  return tier !== 'none';
}

// Plane mode is only the Max tier (player request: full gauge = plane flight).
export function planeModeAllowed(tier) {
  return isPlaneTier(tier);
}

// Assist mode shrinks the top speed of a profile.
export function effectiveMaxSpeed(tier, { assist = false, assistSpeedScale = 0.85 } = {}) {
  const base = profileFor(tier).maxSpeed;
  return assist ? base * assistSpeedScale : base;
}
