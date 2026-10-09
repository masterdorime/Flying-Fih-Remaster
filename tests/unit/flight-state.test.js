import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileFor, planeModeAllowed, canLeaveWater, effectiveMaxSpeed } from '../../js/flight-state.js';
import { tierForGauge } from '../../js/gauge.js';

test('profiles match PRD §9.2 table', () => {
  assert.equal(profileFor('none').maxSpeed, 25);
  assert.equal(profileFor('low').maxSpeed, 35);
  assert.equal(profileFor('medium').maxSpeed, 50);
  assert.equal(profileFor('high').maxSpeed, 70);
  assert.equal(profileFor('max').maxSpeed, 110);
  assert.equal(profileFor('max').fov, 95);
  assert.equal(profileFor('none').gravityScale, 1.0);
  assert.equal(profileFor('max').gravityScale, 0.4);
});

test('plane mode only at max tier', () => {
  assert.equal(planeModeAllowed('max'), true);
  for (const t of ['none', 'low', 'medium', 'high']) assert.equal(planeModeAllowed(t), false);
});

test('can leave water at low tier and above', () => {
  assert.equal(canLeaveWater('none'), false);
  assert.equal(canLeaveWater('low'), true);
});

test('assist scales top speed', () => {
  assert.equal(effectiveMaxSpeed('high', { assist: false }), 70);
  assert.ok(Math.abs(effectiveMaxSpeed('high', { assist: true }) - 59.5) < 1e-9);
});

test('gauge-to-tier mapping used by the state machine', () => {
  assert.equal(tierForGauge(0), 'none');
  assert.equal(tierForGauge(100), 'max');
  assert.equal(tierForGauge(75), 'high');
});
