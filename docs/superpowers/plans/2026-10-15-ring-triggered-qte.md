# Ring-Triggered QTE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace distance-based gate grading with a press-timing QTE: crossing the ring mouth opens exactly one SPACE window (0.30 s perfect / 0.70 s good), never before crossing, with a HUD countdown + audio cue.

**Architecture:** Pure core in `js/timing.js` (`mouthHit` geometry + `createQte`/`evaluatePress`/`qteRemaining` window math); `js/game.js` owns the lifecycle (single live gate stays unresolved while a QTE is pending; the single-live-gate invariant is the eligibility rule); the cue is `#ffm-qte` in `js/hud.js` driven by `runTime` + a synth-only blip in `js/audio.js`. `applyResult` and everything downstream are untouched.

**Tech Stack:** vanilla ES modules, Three.js r170 (vendored, no build), node:test unit suite, Playwright browser suite driving `window.__FFM_API`.

**Spec:** `docs/superpowers/specs/2026-10-15-ring-triggered-qte-design.md`

## Global Constraints

- Windows: `QTE.perfectWindow = 0.30`, `QTE.goodWindow = 0.70` seconds; assist multiplies both by `ASSIST.windowScale` (1.6) → 0.48 / 1.12.
- Mouth: `GATE.mouthRadius = 3.0` (renamed from `goodRadius`; `perfectRadius` deleted).
- One live gate at all times; while a QTE is pending the gate is exempt from `gateBehind` (the window deadline is the only expiry, else a fast fish would double-resolve); `createQte` stamps `gate.qteOpened` (one QTE per gate).
- All QTE timing reads `state.runTime`, never wall-clock (pause/time-scale safe).
- No new asset files; the QTE audio cue is synth-only via the existing `fire` → `synthFallback` path.
- `applyResult`, gauge/chain/scoring/launch mechanics, flight gates (band 63–104), and `cooldown 0.6` unchanged.
- TDD: every behavior change ships with a watched-RED test first. Retirements are grep-verified before commit.
- Repo flow: commits go to `main` directly, message style `feat:|fix:|docs: <summary> (suite: X/X unit, Y/Y browser)`.
- Browser tests: poll with `page.waitForFunction(fn, null, {timeout})` — zero-arg predicates MUST pass `null` as the second argument; never fixed sleeps for sim assertions; generous wall budgets (software GL is slow); the harness binds :8123 itself, so stop any dev server before a run.
- Rebuild `flying-fish-momentum.zip` on ship (repo agreement §7) — after the branch review, at the very end.

## Review Focus

1. **Assist player**: windows ×1.6 (0.48/1.12) — an early press must still land Perfect and the HUD must drain the widened window. Pinned by the unit test `createQte` scales both windows by `ASSIST.windowScale` (Task 1).
2. **Mash-tapping / double press**: exactly one press grades a QTE; a second press no-ops (and `e.repeat` means a held key fires once). Pinned by the unit test `evaluatePress` is idempotent + t08 section 10 (Task 1, Task 2).
3. **Run ends mid-window**: a crash or `endRun()` with a QTE pending must clear it and hide the HUD cue (no stuck overlay). Pinned by t08 section 12 (Task 2, Task 3).
4. **A press during the charge ritual** must still spam the launch gauge, never resolve a stale QTE. Pinned by t19 passing unchanged (Task 4, full suite).
5. **Debug overlay referencing deleted config**: the F3 line must show QTE seconds, not `GATE.perfectRadius`. Pinned by the Task 1 grep sweep + t16 (F3 line) passing unchanged (Task 1).

---

### Task 1: Pure QTE core + config (unit TDD)

**Files:**
- Modify: `js/config.js` (add `QTE` block; rename `GATE.goodRadius` → `mouthRadius`; delete `GATE.perfectRadius`; update the `ASSIST.windowScale` comment)
- Modify: `js/timing.js` (remove `resolveGate`; add `mouthHit`, `createQte`, `evaluatePress`, `qteRemaining`)
- Modify: `js/gate-view.js:19` (disc radius reads `GATE.mouthRadius`)
- Modify: `js/main.js:241` (debug overlay windows → `QTE` seconds) + add `QTE` to the config import
- Modify: `js/debug.js:27` (label `qte P0.30s G0.70s` instead of `rings P..m G..m`)
- Rewrite: `tests/unit/timing.test.js`

**Interfaces:**
- Consumes: nothing (this task is the foundation).
- Produces: `mouthHit(gate, sample) -> 'inside' | 'miss'`; `createQte(gate, now, { assist }) -> { gateId, startedAt, perfectWindow, goodWindow, resolved: false, result: null }` (also sets `gate.qteOpened = true`); `evaluatePress(qte, pressAt) -> 'perfect' | 'good' | 'miss'` (sets `resolved`/`result`, idempotent); `qteRemaining(qte, now) -> number`; config `QTE { perfectWindow, goodWindow }` and `GATE.mouthRadius`.

- [ ] **Step 1: Rewrite the unit test file (RED)**

Keep the existing `createGate` / flight-band / lead-scaling / `crossingSample` / `gateBehind` + `gateCadence` / `reseatSwimGate` tests verbatim. Extend the two existing import lines rather than adding new ones (a duplicate `import` binding is a SyntaxError): line 3 becomes `import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate } from '../../js/timing.js';` and line 4 becomes `import { GATE, ASSIST, QTE } from '../../js/config.js';`. Replace the `resolveGate` tests with:

```js
const gate = () => ({ id: 1, x: 0, y: 0, z: 100 });

test('mouthHit: inside / boundary / outside, on both axes', () => {
  assert.equal(mouthHit(gate(), { x: 0, y: 0, z: 100 }), 'inside');
  assert.equal(mouthHit(gate(), { x: 3.0, y: 0, z: 100 }), 'inside');   // = mouthRadius counts
  assert.equal(mouthHit(gate(), { x: 4.5, y: 0, z: 100 }), 'miss');
  assert.equal(mouthHit(gate(), { x: 0, y: -2.1, z: 100 }), 'inside'); // vertical axis too
});

test('config: QTE windows are 0.30 / 0.70 and perfectRadius is retired', () => {
  assert.equal(QTE.perfectWindow, 0.30);
  assert.equal(QTE.goodWindow, 0.70);
  assert.equal(GATE.mouthRadius, 3.0);
  assert.equal('perfectRadius' in GATE, false);
});

test('createQte: windows from config; assist widens both by windowScale', () => {
  const q = createQte(gate(), 10);
  assert.equal(q.perfectWindow, QTE.perfectWindow);
  assert.equal(q.goodWindow, QTE.goodWindow);
  assert.equal(q.startedAt, 10);
  assert.equal(q.resolved, false);
  const a = createQte(gate(), 10, { assist: true });
  assert.ok(Math.abs(a.perfectWindow - QTE.perfectWindow * ASSIST.windowScale) < 1e-9);
  assert.ok(Math.abs(a.goodWindow - QTE.goodWindow * ASSIST.windowScale) < 1e-9);
});

test('createQte stamps qteOpened: one QTE per gate', () => {
  const g = gate();
  createQte(g, 10);
  assert.equal(g.qteOpened, true);
});

test('evaluatePress: early perfect, mid good, late miss; idempotent', () => {
  assert.equal(evaluatePress(createQte(gate(), 10), 10.30), 'perfect');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.31), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.69), 'good');
  assert.equal(evaluatePress(createQte(gate(), 10), 10.71), 'miss');
  assert.equal(evaluatePress(createQte(gate(), 10), 9.99), 'miss'); // press predates the window
  const q = createQte(gate(), 10);
  evaluatePress(q, 10.1);
  assert.equal(evaluatePress(q, 10.9), 'perfect'); // stored result wins
  assert.equal(q.resolved, true);
});

test('qteRemaining: exact before the deadline, 0 after', () => {
  const q = createQte(gate(), 10);
  assert.ok(Math.abs(qteRemaining(q, 10.25) - 0.45) < 1e-9);
  assert.equal(qteRemaining(q, 11), 0);
});
```

- [ ] **Step 2: Run it to verify RED**

Run: `node --test tests/unit/timing.test.js`
Expected: FAIL — `mouthHit`/`createQte`/`evaluatePress`/`qteRemaining` are not exported, `QTE` is undefined.

- [ ] **Step 3: Implement the config changes in `js/config.js`**

Add after the `GATE` block:

```js
// Ring-triggered QTE: crossing the mouth opens one SPACE window; the press
// times the grade (js/timing.js + js/game.js; see the 2026-10-15 spec).
export const QTE = {
  perfectWindow: 0.30, // seconds after crossing: Perfect
  goodWindow: 0.70,    // seconds after crossing: Good; beyond / no press = Miss
};
```

In `GATE`: rename `goodRadius` → `mouthRadius` (keep 3.0), delete `perfectRadius`. Update the `ASSIST.windowScale` comment to `// widens the QTE press windows (perfect 0.48, good 1.12)`.

- [ ] **Step 4: Run the unit file again — still RED on the core functions**

Run: `node --test tests/unit/timing.test.js`
Expected: config assertions pass; `mouthHit`/`createQte`/`evaluatePress`/`qteRemaining` still fail (not exported).

- [ ] **Step 5: Implement the pure core in `js/timing.js`**

Replace `resolveGate` with these exports (import `QTE` from `./config.js`):

```js
export function mouthHit(gate, sample) {
  return Math.hypot(sample.x - gate.x, sample.y - gate.y) <= GATE.mouthRadius ? 'inside' : 'miss';
}

export function createQte(gate, now, { assist = false } = {}) {
  const scale = assist ? ASSIST.windowScale : 1;
  gate.qteOpened = true;
  return {
    gateId: gate.id, startedAt: now,
    perfectWindow: QTE.perfectWindow * scale,
    goodWindow: QTE.goodWindow * scale,
    resolved: false, result: null,
  };
}

export function evaluatePress(qte, pressAt) {
  if (qte.resolved) return qte.result;
  const elapsed = pressAt - qte.startedAt;
  const result = elapsed < 0 || elapsed > qte.goodWindow ? 'miss'
    : elapsed <= qte.perfectWindow ? 'perfect' : 'good';
  qte.resolved = true;
  qte.result = result;
  return result;
}

export function qteRemaining(qte, now) {
  return Math.max(0, qte.startedAt + qte.goodWindow - now);
}
```

- [ ] **Step 6: Run the unit file — GREEN**

Run: `node --test tests/unit/timing.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Rename sweep + full unit suite**

Grep `js/` and `tests/` for `resolveGate|perfectRadius|goodRadius`. Expected remaining references: none (fix `js/gate-view.js:19` disc radius → `GATE.mouthRadius`; `js/main.js:241` debug windows → `{ windows: { perfect: QTE.perfectWindow, good: QTE.goodWindow } }` with `QTE` added to the config import; `js/debug.js:27` → `qte      P${windows.perfect.toFixed(2)}s G${windows.good.toFixed(2)}s`).

Run: `npm test`
Expected: full unit suite green (record the new test count for the commit message).

- [ ] **Step 8: Commit**

```bash
git add js/config.js js/timing.js js/gate-view.js js/main.js js/debug.js tests/unit/timing.test.js
git commit -m "feat: QTE core — mouth hit + press windows in pure timing (suite: XX/XX unit)"
```

---

### Task 2: Game lifecycle + t08 rewrite (browser TDD)

**Files:**
- Modify: `js/game.js` (imports, `activeQte` state, `updateGates` branch, `resolveQte`, `queuePress`, `clearGate`, `endRun`, `restart`, tutorial beats, `qte`/`debugPress`/`debugPressAt` API)
- Rewrite: `tests/browser/t08-gates.mjs`
- Modify: `tests/browser/t15-acceptance.mjs` (~line 24) and `tests/browser/t17-momentum-coins.mjs` (~line 25) — both chain gates via `debugTeleportToRing` and must press the window now

**Interfaces:**
- Consumes: Task 1's `mouthHit`, `createQte`, `evaluatePress`, `qteRemaining`.
- Produces: `game.qte() -> qte | null`; `game.debugPress()`; `game.debugPressAt(t)`; bus event `qte:open` (the only new event — `timing:result` already fires from `applyResult`). `debugPress` is consumed by the t15/t17 adaptations in this task.

- [ ] **Step 1: Rewrite `tests/browser/t08-gates.mjs` and adapt t15/t17 (RED)**

Keep sections 1 (spawn), 6 (flight band 63–104), 7 (flash renders), 8 (no gates while descending) from the current file verbatim. Replace the grading sections (old 2–5) with the new 2–5, 10, and 12 below, and add the cooldown section 9 after the kept section 8. Keep the observer-recorder popup pattern and the `null` second-arg `waitForFunction` discipline:

```js
// 2. crossing the mouth opens exactly one QTE; an early press -> PERFECT
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 90000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugPress());
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'perfect', null, { timeout: 60000 });
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.perfect, 1, 'perfect counted');
assert(s.gauge > 0, `perfect fills the gauge (${s.gauge})`);
assertEqual(s.chain, 1, 'chain starts');
const popups = await page.evaluate(() => (window.__POPUPS ?? []).join(','));
assert(popups.includes('PERFECT'), `PERFECT popup recorded (${popups})`);

// 3. a late (but in-window) press -> GOOD (press at an explicit run-time so
//    frame pacing can't jump the window)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => {
  const q = window.__FFM_API.qte();
  window.__FFM_API.debugPressAt(q.startedAt + q.perfectWindow + 0.05);
});
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'good', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.good, 1, 'good counted');
assertEqual(s.chain, 2, 'good extends the chain');

// 4. no press before the deadline -> MISS (chain reset, speed cut)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
const preMiss = await page.evaluate(() => window.__FFM_API.state().speed);
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => {
  const q = window.__FFM_API.qte();
  return q && window.__FFM_API.state().runTime - q.startedAt > q.goodWindow;
}, null, { timeout: 60000 });
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'miss', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.chain, 0, 'miss resets the chain');
assert(s.speed < preMiss, `miss cuts speed (${preMiss.toFixed(1)} -> ${s.speed.toFixed(1)})`);
assertEqual(s.counts.miss, 1, 'miss counted');

// 5. crossing OUTSIDE the mouth -> plain miss, and NO window ever opens
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
const wide = await page.evaluate(async () => {
  const api = window.__FFM_API;
  let sawQte = false;
  const before = api.state().counts.miss;
  api.debugTeleportToRing(9, 0);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 25));
    if (api.qte()) sawQte = true;
    if (api.state().counts.miss > before) break;
  }
  return { sawQte, before, after: api.state().counts.miss };
});
assert(!wide.sawQte, 'no QTE window opens when the crossing misses the mouth');
assertEqual(wide.after, wide.before + 1, 'wide crossing counted as a plain miss');

// 10. exactly one press grades: a second press while resolved no-ops
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
const double = await page.evaluate(() => {
  const api = window.__FFM_API;
  const before = api.state().counts.perfect;
  api.debugPress();
  api.debugPress(); // second press must not double-grade
  return { before, after: api.state().counts.perfect };
});
assertEqual(double.after, double.before + 1, 'a second press does not re-grade the QTE');

// 12. a run ending with a QTE pending clears it (no stuck cue, no stale state)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.endRun());
const postEnd = await page.evaluate(() => ({ qte: window.__FFM_API.qte(), phase: window.__FFM_API.state().phase }));
assertEqual(postEnd.qte, null, 'ending a run clears a pending QTE');
assertEqual(postEnd.phase, 'results', 'run ended');
```

Cooldown section 9, placed after the kept section 8:

```js
// 9. the next gate appears after the cooldown (one at a time)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
```

And adapt the two teleport-loop tests so they press the window (they go RED with t08 until the lifecycle lands). t15 ~line 24:

```js
if (api.gate()) {
  api.debugTeleportToRing(); // park on the portal's center axis
  api.debugPress();          // Phase 2: cross the mouth, then hit the window
}
```

(The loop's 20 ms cadence means the press lands ~0–40 ms after the window opens → inside the 0.30 s perfect window; the first iteration's press may no-op before the crossing, which is fine.) Same edit at t17 ~line 25 (`// chain perfects: cross the mouth, press in the window`).

- [ ] **Step 2: Run the new tests to verify RED**

Run: `node tests/browser/t08-gates.mjs` (stop any dev server first — the harness binds :8123 itself), then `node tests/browser/t15-acceptance.mjs` and `node tests/browser/t17-momentum-coins.mjs`
Expected: all FAIL — `__FFM_API.qte is not a function` / `debugPress is not a function`.

- [ ] **Step 3: Implement the lifecycle in `js/game.js`**

- Import: `createQte, evaluatePress, qteRemaining` added to the `./timing.js` import; `resolveGate` removed.
- State: `let activeQte = null;` beside `activeGate`.
- In `updateGates`, replace the `crossingSample` block:

```js
const sample = crossingSample(prevPos, pos, activeGate.z);
if (sample && !activeGate.qteOpened) {
  if (mouthHit(activeGate, sample) === 'inside') {
    activeQte = createQte(activeGate, state.runTime, { assist: state.assist });
    bus.emit('qte:open', activeQte);
  } else {
    resolveGateResult('miss'); // crossed outside the mouth: plain miss, no QTE
  }
}
if (activeQte && !activeQte.resolved) {
  // a pending QTE owns the gate: no behind-miss until the window expires,
  // or a fast fish (6 m behind < 0.70 s) would double-resolve
  if (qteRemaining(activeQte, state.runTime) <= 0) {
    resolveQte('miss'); // auto-miss on expiry (shared helper — same math as the HUD)
  }
} else if (gateBehind(activeGate, pos)) {
  resolveGateResult('miss');
}
```

- Add `function resolveQte(result) { activeQte = null; resolveGateResult(result); }`.
- `queuePress`: `if (activeQte && !activeQte.resolved) { resolveQte(evaluatePress(activeQte, state.runTime)); return; }` before the existing charge check.
- `clearGate`: also `activeQte = null`. `endRun` and `restart`: clear `activeQte`.
- Tutorial beats (`TUTORIAL_STEPS`): spawn → `'Cross the ring, then hit SPACE inside the window!'`; perfect → `'PERFECT! Right inside the window — speed and gauge jump up.'`; miss → `'Window missed? Chain resets — cross the next ring and time your press!'`.
- API additions: `qte: () => activeQte,` · `debugPress: () => queuePress(),` · `debugPressAt: (t) => (activeQte && !activeQte.resolved ? resolveQte(evaluatePress(activeQte, t)) : null),`

- [ ] **Step 4: Run t08 — GREEN**

Run: `node tests/browser/t08-gates.mjs`
Expected: `PASS t08-gates`.

- [ ] **Step 5: Run t15 and t17 — GREEN**

Run: `node tests/browser/t15-acceptance.mjs`, then `node tests/browser/t17-momentum-coins.mjs`
Expected: both PASS, t15's summary showing `misses: 0` and `perfects > 0`.

- [ ] **Step 6: Commit**

```bash
git add js/game.js tests/browser/t08-gates.mjs tests/browser/t15-acceptance.mjs tests/browser/t17-momentum-coins.mjs
git commit -m "feat: ring-triggered QTE lifecycle — press times the grade (suite: XX/XX unit, 15/15 browser)"
```

---

### Task 3: HUD countdown + audio cue

**Files:**
- Modify: `js/hud.js` (`#ffm-qte` markup + styles + `updateQte`)
- Modify: `js/audio.js` (`synthFallback.qte`, `sfx.qte`, `bus.on('qte:open', sfx.qte)`)
- Modify: `js/main.js` (call `hud.updateQte(game.qte(), game.state.runTime)` right after `hud.update(game.state)` at line 231)
- Modify: `tests/browser/t08-gates.mjs` (sections 11 + the HUD half of 12)

**Interfaces:**
- Consumes: Task 1's `qteRemaining` (import into `hud.js` from `./timing.js` — `timing.js` is pure: config + wave math only); Task 2's `game.qte()` and the `qte:open` event.
- Produces: DOM `#ffm-qte` (`.hidden` class pattern like the charge meter); `debugAudioStats().calls.qte` increments per opened window.

- [ ] **Step 1: Extend t08 with the cue assertions (RED)**

Add after section 10 (section 12 stays; extend it with the HUD assertion after the `postEnd` checks):

```js
// 11. the cue shows while a window is open and hides when it resolves
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => {
  const el = document.querySelector('#ffm-qte');
  return el && !el.classList.contains('hidden');
}, null, { timeout: 60000 });
const cue = await page.evaluate(() => {
  const el = document.querySelector('#ffm-qte');
  const drain = document.querySelector('#ffm-qte-drain');
  return { drainWidth: drain ? drain.style.width : '', label: el.textContent };
});
assert(cue.drainWidth.endsWith('%'), `the countdown ring drains (${cue.drainWidth})`);
assert(cue.label.includes('SPACE'), `the prompt names the key (${cue.label})`);
await page.evaluate(() => window.__FFM_API.debugPress());
await page.waitForFunction(() => {
  const el = document.querySelector('#ffm-qte');
  return !el || el.classList.contains('hidden');
}, null, { timeout: 60000 });
// audio: the open blip fired through the counted synth path
const stats = await page.evaluate(() => window.__FFM_API.debugAudioStats());
assert((stats.calls.qte ?? 0) >= 1, `qte open cue counted (${stats.calls.qte})`);
```

And in section 12, after the `postEnd` checks, add: `assertEqual(await page.evaluate(() => document.querySelector('#ffm-qte').classList.contains('hidden')), true, 'the cue hides when the run ends');`

- [ ] **Step 2: Run to verify RED**

Run: `node tests/browser/t08-gates.mjs`
Expected: FAIL at section 11 — `#ffm-qte` is null.

- [ ] **Step 3: Implement the HUD cue in `js/hud.js`**

Markup (inside `createHud`'s template, after the gauge-wrap div):

```html
<div id="ffm-qte" class="ffm-qte hidden">
  <div class="ffm-qte-ring"><div class="ffm-qte-drain" id="ffm-qte-drain"></div></div>
  <div class="ffm-qte-key">SPACE</div>
</div>
```

Styles: `#ffm-qte` fixed, bottom ~96 px, centered, `pointer-events: none`; `.ffm-qte-ring` a 64 px rounded bar (matching the HUD gauge's treatment); `.ffm-qte-drain` a rounded fill; `.ffm-qte-key` small uppercase letter-spaced label. Then:

```js
function updateQte(qte, runTime) {
  if (!qte) { qteEl.classList.add('hidden'); return; }
  qteEl.classList.remove('hidden');
  const t = Math.min(1, Math.max(0, 1 - qteRemaining(qte, runTime) / qte.goodWindow));
  drainEl.style.width = (t * 100).toFixed(1) + '%';
  const inPerfect = t <= qte.perfectWindow / qte.goodWindow;
  drainEl.style.background = inPerfect
    ? 'linear-gradient(90deg, #ffd54a, #ff9430)'
    : 'linear-gradient(90deg, #4dd2ff, #7dff9a)';
}
```

Import `qteRemaining` from `./timing.js`. Return `{ update, updateQte }`.

- [ ] **Step 4: Implement the audio cue in `js/audio.js`**

Add to `synthFallback`: `qte() { tone({ freq: 880, dur: 0.08, type: 'sine', gain: 0.35 }); tone({ freq: 1320, dur: 0.06, delay: 0.05, gain: 0.25 }); },`. Add to `sfx`: `qte: () => fire('qte'),`. Add beside the `bus.on('timing:result', ...)` listener: `bus.on('qte:open', sfx.qte);`. No `SFX_FILES` entry — it stays synth-only through `fire`'s fallback, and `fire`'s `count()` makes it visible in `debugAudioStats().calls.qte`.

- [ ] **Step 5: Wire the call in `js/main.js`**

After `hud.update(game.state);` (line 231): `hud.updateQte(game.qte(), game.state.runTime);`

- [ ] **Step 6: Run t08 — GREEN, then the audio check**

Run: `node tests/browser/t08-gates.mjs`
Expected: `PASS t08-gates` (audio cue counted, cue shows/hides).

- [ ] **Step 7: Commit**

```bash
git add js/hud.js js/audio.js js/main.js tests/browser/t08-gates.mjs
git commit -m "feat: QTE cue — HUD countdown + synth open blip (suite: XX/XX unit, 15/15 browser)"
```

---

### Task 4: Full-suite verification + handoff update

**Files:**
- Modify: `HANDOFF.md` (§9 status — the file stays untracked per §10)

**Interfaces:**
- Consumes: nothing new — all code landed in Tasks 1–3.
- Produces: nothing; the deliverable is a verified green suite and an accurate handoff.

- [ ] **Step 1: Full suite**

Run: `npm run test:all`
Expected: unit + browser all green (record the counts). If t19/t20 hit wall-clock under load, re-run them individually to confirm.

- [ ] **Step 5: Update `HANDOFF.md` and record the ship state**

Mark Phase 2 shipped in §9 (commit hash, suite counts, `qte:open` event, `QTE` config block, `GATE.mouthRadius` rename, the behind-miss exemption while a window is pending); leave the file untracked per §10. No git commit is needed for this task — the only tracked changes were committed in Tasks 1–3, and the suite counts from Step 1 go into the final review + the handoff. (`flying-fish-momentum.zip` is rebuilt at ship, after the final branch review.)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-15-ring-triggered-qte.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **subagent-driven**, because the tasks are tightly sequential through shared interfaces (`createQte`/`evaluatePress` → lifecycle → cue) and a silent mistake (e.g. a press that no-ops, a window that desyncs from the overlay) is exactly what an independent per-task reviewer catches cheapest. Does the plan capture what you want, and which approach should we use?
