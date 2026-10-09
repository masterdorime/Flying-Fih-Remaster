import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentWindows, createPrompt, evaluatePress, expirePrompt, promptInterval, inverseLerp } from '../../js/timing.js';
import { TIMING, MOMENTUM } from '../../js/config.js';

test('windows shrink with speed (PRD §7.2)', () => {
  const slow = currentWindows(MOMENTUM.minSpeed);
  const fast = currentWindows(110);
  assert.equal(slow.perfect, TIMING.perfectWindow);
  assert.equal(slow.good, TIMING.goodWindow);
  assert.equal(fast.perfect, TIMING.minPerfectWindow);
  assert.equal(fast.good, TIMING.minGoodWindow);
});

test('assist mode widens windows by 1.6x', () => {
  const w = currentWindows(110, { assist: true });
  assert.ok(Math.abs(w.perfect - TIMING.minPerfectWindow * 1.6) < 1e-9);
  assert.ok(Math.abs(w.good - TIMING.minGoodWindow * 1.6) < 1e-9);
});

test('press exactly on perfectAt is perfect (boundary, PRD §27.2)', () => {
  const p = createPrompt(0);
  const w = currentWindows(20);
  assert.equal(evaluatePress(p, p.perfectAt, w), 'perfect');
});

test('just outside perfect but inside good is good (boundary)', () => {
  const p = createPrompt(0);
  const w = currentWindows(20);
  const t = p.perfectAt + w.perfect + 0.0001;
  assert.equal(evaluatePress(p, t, w), 'good');
  const t2 = p.perfectAt + w.good + 0.0001;
  assert.equal(evaluatePress(p, t2, w), 'miss');
});

test('press outside prompt lifetime is grace (no penalty)', () => {
  const p = createPrompt(0);
  const w = currentWindows(20);
  assert.equal(evaluatePress(p, -1, w), null);
  assert.equal(evaluatePress(p, p.expiresAt + 1, w), null);
});

test('expired prompt evaluates to nothing', () => {
  const p = createPrompt(0);
  const expired = expirePrompt(p, TIMING.promptLifetime + 0.01);
  assert.equal(expired.result, 'expired');
  assert.equal(evaluatePress(expired, expired.perfectAt, currentWindows(20)), null);
});

test('prompt interval tightens with difficulty', () => {
  assert.ok(promptInterval(0) > promptInterval(0.5));
  assert.ok(promptInterval(0.5) > promptInterval(1));
});

test('inverseLerp clamps', () => {
  assert.equal(inverseLerp(8, 110, 8), 0);
  assert.equal(inverseLerp(8, 110, 110), 1);
  assert.equal(inverseLerp(8, 110, -5), 0);
});
