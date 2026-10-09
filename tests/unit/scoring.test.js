import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierMultiplier, timingScore, coinScore, chainMultiplier } from '../../js/scoring.js';

test('tier multiplier climbs from 1.0 to 2.0', () => {
  assert.equal(tierMultiplier('none'), 1);
  assert.equal(tierMultiplier('low'), 1.25);
  assert.equal(tierMultiplier('medium'), 1.5);
  assert.equal(tierMultiplier('high'), 1.75);
  assert.equal(tierMultiplier('max'), 2);
});

test('perfect beats good, both scale by tier and chain', () => {
  assert.equal(timingScore('good', 'none', 0), 150);
  assert.equal(timingScore('perfect', 'none', 0), 500);
  assert.ok(timingScore('good', 'low', 0) > timingScore('good', 'none', 0));
  assert.equal(timingScore('perfect', 'max', 0), 1000);
  assert.ok(timingScore('perfect', 'none', 10) > timingScore('perfect', 'none', 0));
});

test('coin score scales by tier only, never touches gauge', () => {
  assert.equal(coinScore('none'), 250);
  assert.equal(coinScore('max'), 500);
});

test('chain multiplier caps at 2x', () => {
  assert.equal(chainMultiplier(0), 1);
  assert.equal(chainMultiplier(20), 2);
  assert.equal(chainMultiplier(100), 2);
});
