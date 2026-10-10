import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeed } from '../../js/momentum.js';

test('normalizeSpeed maps the game speed range to 0..1', () => {
  assert.equal(normalizeSpeed(8), 0);
  assert.equal(normalizeSpeed(59), 0.5);
  assert.equal(normalizeSpeed(110), 1);
});

test('normalizeSpeed clamps outside the range', () => {
  assert.equal(normalizeSpeed(0), 0);
  assert.equal(normalizeSpeed(500), 1);
  assert.equal(normalizeSpeed(8, 8, 8), 0);
});
