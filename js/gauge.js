// FlightGaugeSystem (PRD §8). Pure module.

import { GAUGE, TIER_ORDER } from './config.js';

export function tierForGauge(g) {
  if (g >= GAUGE.maxThreshold) return 'max';
  if (g > GAUGE.mediumMax) return 'high';
  if (g > GAUGE.lowMax) return 'medium';
  if (g > 0) return 'low';
  return 'none';
}

export function tierIndex(tier) { return TIER_ORDER.indexOf(tier); }

// Gauge fills ONLY from Perfect/Good (PRD §8.2); overfill allowed to max 120.
export function applyFill(g, result) {
  if (result === 'perfect') return Math.min(GAUGE.max, g + GAUGE.fillPerfect);
  if (result === 'good') return Math.min(GAUGE.max, g + GAUGE.fillGood);
  return g;
}

// Miss applies instant extra drain (base drain × multiplier).
export function applyMissDrain(g) {
  return Math.max(0, g - GAUGE.drainFlying * GAUGE.missDrainMultiplier);
}

// Flying drain applies while there is no recent perfect.
export function drainFlying(g, dt, hasRecentPerfect) {
  if (hasRecentPerfect) return g;
  return Math.max(0, g - GAUGE.drainFlying * dt);
}

export function isFlying(g) { return tierForGauge(g) !== 'none'; }

// Tier direction between two gauges; null when unchanged (PRD §8.4 events).
export function tierTransition(prevTier, nextTier) {
  const a = tierIndex(prevTier), b = tierIndex(nextTier);
  if (b > a) return 'up';
  if (b < a) return 'down';
  return null;
}
