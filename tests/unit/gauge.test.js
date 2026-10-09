import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierForGauge, applyFill, applyMissDrain, drainFlying, tierTransition } from '../../js/gauge.js';
import { GAUGE } from '../../js/config.js';

test('tier thresholds (PRD §5.2/§5.3 incl. exact boundaries)', () => {
  assert.equal(tierForGauge(0), 'none');
  assert.equal(tierForGauge(0.1), 'low');
  assert.equal(tierForGauge(GAUGE.lowMax), 'low');            // <= 30 is Low
  assert.equal(tierForGauge(GAUGE.lowMax + 0.1), 'medium');
  assert.equal(tierForGauge(GAUGE.mediumMax), 'medium');      // <= 70 is Medium
  assert.equal(tierForGauge(GAUGE.mediumMax + 0.1), 'high');
  assert.equal(tierForGauge(GAUGE.highMax), 'high');
  assert.equal(tierForGauge(99.95), 'high');
  assert.equal(tierForGauge(GAUGE.maxThreshold), 'max');      // 100 → max
  assert.equal(tierForGauge(GAUGE.max), 'max');               // 120 allowed
});

test('fill only from perfect/good, overfill capped at 120', () => {
  assert.equal(applyFill(50, 'perfect'), 62);
  assert.equal(applyFill(50, 'good'), 55);
  assert.equal(applyFill(50, 'miss'), 50); // miss never fills
  assert.equal(applyFill(115, 'perfect'), GAUGE.max);
});

test('drain rules (PRD §8.3)', () => {
  const base = 100;
  const after1s = drainFlying(base, 1, false);
  assert.ok(Math.abs(after1s - (base - GAUGE.drainFlying)) < 1e-9);
  assert.equal(drainFlying(base, 1, true), base); // recent perfect pauses drain
  assert.equal(drainFlying(1, 10, false), 0);     // clamped at 0
});

test('miss drain = base drain × 1.8', () => {
  const g = applyMissDrain(64);
  assert.ok(Math.abs(g - (64 - GAUGE.drainFlying * GAUGE.missDrainMultiplier)) < 1e-9);
});

test('tierTransition up/down/null (PRD §8.4)', () => {
  assert.equal(tierTransition('low', 'medium'), 'up');
  assert.equal(tierTransition('high', 'medium'), 'down');
  assert.equal(tierTransition('medium', 'medium'), null);
  assert.equal(tierTransition('max', 'none'), 'down');
});
