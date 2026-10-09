// Scoring (PRD §14.2 PROPOSED model). Pure.
import { COINS, SCORING, TIER_ORDER } from './config.js';

export function tierMultiplier(tier) {
  return 1 + TIER_ORDER.indexOf(tier) * 0.25; // none 1.0 -> max 2.0
}

export function timingScore(result, tier, chain) {
  const base = result === 'perfect' ? SCORING.perfect : SCORING.good;
  return Math.round(base * tierMultiplier(tier) * chainMultiplier(chain));
}

export function chainMultiplier(chain) {
  return 1 + Math.min(chain, 20) * 0.05;
}

export function coinScore(tier) {
  return Math.round(COINS.scoreValue * tierMultiplier(tier));
}

export function sustainedBonus(dt) {
  return SCORING.sustainedPerSecond * dt;
}
