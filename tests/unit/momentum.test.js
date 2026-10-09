import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTimingResult, integrateSpeed, maxSpeedForTier } from '../../js/momentum.js';
import { MOMENTUM } from '../../js/config.js';

test('perfect boost scales by tier (PRD §6.4 table)', () => {
  assert.equal(applyTimingResult(30, 'low', 'perfect'), 30 + 12);
  assert.equal(applyTimingResult(30, 'medium', 'perfect'), 30 + 16);
  assert.equal(applyTimingResult(30, 'high', 'perfect'), 30 + 22);
  assert.equal(applyTimingResult(30, 'max', 'perfect'), 30 + 30);
});

test('good boost scales by tier', () => {
  assert.equal(applyTimingResult(20, 'low', 'good'), 26);
  assert.equal(applyTimingResult(20, 'medium', 'good'), 28);
  assert.equal(applyTimingResult(20, 'high', 'good'), 31);
  assert.equal(applyTimingResult(20, 'max', 'good'), 35);
});

test('miss penalty scales by tier and never drops below MinSpeed', () => {
  assert.equal(applyTimingResult(100, 'low', 'miss'), 82);
  assert.equal(applyTimingResult(100, 'medium', 'miss'), 72);
  assert.equal(applyTimingResult(100, 'high', 'miss'), 55);
  assert.equal(applyTimingResult(100, 'max', 'miss'), 30);
  assert.equal(applyTimingResult(10, 'max', 'miss'), MOMENTUM.minSpeed); // floor
});

test('boost overshoot is bounded by headroom', () => {
  // at tier cap + big boost -> hard cap at cap + headroom
  const cap = maxSpeedForTier('medium');
  const s = applyTimingResult(cap, 'medium', 'perfect');
  assert.ok(s <= cap + MOMENTUM.overshootHeadroom + 0.001);
});

test('integrateSpeed accelerates below cap and drags above it', () => {
  const max = maxSpeedForTier('none'); // 25
  let s = 8;
  for (let i = 0; i < 100; i++) s = integrateSpeed(s, 'none', 1 / 60, false);
  assert.ok(Math.abs(s - max) < 0.5, `converges to swim cap, got ${s}`);
  let over = max + 20;
  for (let i = 0; i < 600; i++) over = integrateSpeed(over, 'none', 1 / 60, false);
  assert.ok(over <= max + 0.5, `decayed back near cap, got ${over}`);
});

test('speed never gains from holding a direction: integration is tier-bounded', () => {
  // one second of full acceleration while ALREADY at cap adds nothing
  const s = integrateSpeed(maxSpeedForTier('high'), 'high', 1.0, true);
  assert.ok(s <= maxSpeedForTier('high') + MOMENTUM.overshootHeadroom);
});
