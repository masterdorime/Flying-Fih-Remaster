// PrecisionTimingSystem core (PRD §7). Pure: window math + evaluation. Node-testable.

import { TIMING, MOMENTUM, ASSIST, INPUT, DIFFICULTY } from './config.js';

export function lerp(a, b, t) { return a + (b - a) * t; }

export function inverseLerp(a, b, v) {
  if (b === a) return 0;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}

// Windows shrink as speed rises (PRD §7.2), widen in Assist mode.
export function currentWindows(speed, { assist = false } = {}) {
  const f = inverseLerp(MOMENTUM.minSpeed, maxSpeedRef(), speed);
  let perfect = lerp(TIMING.perfectWindow, TIMING.minPerfectWindow, f);
  let good = lerp(TIMING.goodWindow, TIMING.minGoodWindow, f);
  if (assist) { perfect *= ASSIST.windowScale; good *= ASSIST.windowScale; }
  return { perfect, good };
}

function maxSpeedRef() {
  // 110 = Max tier top speed. Kept literal here so timing stays independent of profile edits.
  return 110;
}

export function createPrompt(now, lifetime = TIMING.promptLifetime) {
  return {
    state: 'active',
    spawnTime: now,
    perfectAt: now + lifetime / 2,
    expiresAt: now + lifetime,
    result: null,
  };
}

// Evaluate a press. Returns 'perfect' | 'good' | 'miss' | null (grace: press outside prompt lifetime).
export function evaluatePress(prompt, pressTime, windows) {
  if (prompt.state !== 'active') return null;
  const d = Math.abs(pressTime - prompt.perfectAt);
  if (d <= windows.perfect) return 'perfect';
  if (d <= windows.good) return 'good';
  if (pressTime >= prompt.spawnTime && pressTime <= prompt.expiresAt) return 'miss';
  return null;
}

export function expirePrompt(prompt, now) {
  if (prompt.state === 'active' && now >= prompt.expiresAt) {
    return { ...prompt, state: 'expired', result: 'expired' };
  }
  return prompt;
}

// A press is buffered if it arrived up to INPUT.bufferMs after the moment it
// should have been evaluated (late buffer, PRD §7.3). The browser input layer
// uses this; core evaluation itself stays time-exact.
export function withinBuffer(pressTime, evaluatedAt) {
  return pressTime - evaluatedAt <= INPUT.bufferMs / 1000;
}

// Spawn cadence from difficulty 0..1 (PRD §13).
export function promptInterval(difficulty) {
  return lerp(DIFFICULTY.promptIntervalStart, DIFFICULTY.promptIntervalEnd, clamp01(difficulty));
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
