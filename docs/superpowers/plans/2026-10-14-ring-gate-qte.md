# Ring-Gate QTE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the press-timing QTE with a momentum gate the fish physically passes through — one gate at a time, center/band/miss grading, in both swim and flight.

**Architecture:** The pure module `js/timing.js` becomes the gate core (placement + crossing resolution, rng-injected, unit-tested). A new `js/gate-view.js` renders a world-space upright portal ahead of the fish; `js/timing-view.js` is retired. `js/game.js` owns the one-gate lifecycle and feeds results into the unchanged `applyResult` (gauge/momentum/chain/scoring/launch untouched).

**Tech Stack:** Three.js r170 (vendored, importmap), node:test unit tests, Playwright browser checks, static file server on :8123.

**Spec:** `docs/superpowers/specs/2026-10-14-ring-gate-qte-design.md`

## Global Constraints

- Repo rules: TDD (behavior changes ship with a watched-RED test); one fix pass per review; sim assertions POLL (`waitForFunction`), never fixed `waitForTimeout`; generous wall budgets (~90 s around first crossings); juice popups read via the MutationObserver recorder pattern, never live DOM; commit style `feat:`/`fix:` + suite counts in the message.
- Spec constants, verbatim: `perfectRadius 1.2`, `goodRadius 3.0`, `outerRadius 3.0`, `spawnAhead 90`, `cooldown 0.6`, `behindMiss 6`, `swimLift 0.8`, `flightMin 63`, `flightMax 104`, `corridorX 4`.
- Nothing downstream of the result changes: `applyResult`, gauge (+8/+4), momentum, chain, tier, scoring (500/150), launch gate (chain ≥ 5 ∧ gauge ≥ 100), SPAM charge on SPACE, collision rules, HUD layout.
- Gates and obstacles never share space: obstacles hold `|x| ≥ corridorHalfWidth(5) + radius` (existing invariant); gates spawn within `|x| ≤ 4`.

## Review Focus

1. **Tunneling at speed** — at 110 m/s and ~4 fps software GL the fish can cross a gate's Z plane entirely within one frame; resolution must sample the interpolated crossing position or fast players get phantom misses. (Test: `crossingSample` with a 3 m step in Task 1.)
2. **Perfect circle vs fish collider** — perfect radius 1.2 vs `PLAYER_RADIUS` 1.1 is a deliberately tight window; assist scaling (×1.6 → 1.92) must stay inside `goodRadius`. (Test in Task 1.)
3. **Unreachable flight gates** — band 63–104 must sit inside the climb band 57–110 at 18 m/s climb with ~90 m of reaction distance. (Browser assertion in Task 2.)
4. **Min-speed dead air** — 90 m ahead at MinSpeed 8 m/s is ~11 s with no momentum source; confirm a run at low speed still reaches the next gate in playable time. (Live check, Task 3.)
5. **Idempotent resolution** — `resolveGate` must not double-award when the frame after crossing also samples past the gate. (Test in Task 1; browser chain check in Task 2.)

---

### Task 1: Gate core (pure) + config

**Files:**
- Modify: `js/config.js` — add `GATE` block; delete `TIMING.perfectWindow`, `TIMING.goodWindow`, `TIMING.minPerfectWindow`, `TIMING.minGoodWindow`, `TIMING.promptLifetime` (keep `TIMING.recentPerfectSeconds`), and the whole `INPUT` block
- Rewrite: `js/timing.js`
- Rewrite: `tests/unit/timing.test.js`
- Delete: nothing (Task 2 deletes `js/timing-view.js`; `js/timing-view.js` stops being imported by main.js in Task 2 — between tasks the repo keeps `git` clean via Task 2 only)

**Interfaces:**
- Consumes: `config.js` (`GATE`, `ASSIST`, `DIFFICULTY` not needed), `wave.js` (`surfaceHeight`) for gate placement sampling
- Produces:
  - `createGate(rng, { locomotion, playerPos, runTime })` → `{ id, x, y, z, resolved: false, result: null }` — self-contained placement: `z = playerPos.z + GATE.spawnAhead`, `|x| ≤ GATE.corridorX`, swim `Y = surfaceHeight(x, z, runTime) + GATE.swimLift`, fly `Y` uniform in `flightMin..flightMax`; `id` from a counter (test-friendly with the injected rng)
  - `crossingSample(prevPos, pos, gateZ)` → `{ x, y, z } | null` — linear interpolation at the plane when `prevPos.z < gateZ ≤ pos.z`
  - `resolveGate(gate, sample, { assist = false } = {})` → `'perfect' | 'good' | 'miss'` — sets `gate.resolved = true`, `gate.result`; idempotent (repeat calls return the stored result); radius by `hypot(sample.x - gate.x, sample.y - gate.y)` vs `GATE.perfectRadius` (× `ASSIST.windowScale` when `assist`) and `GATE.goodRadius`
  - `gateBehind(gate, playerPos)` → boolean — `playerPos.z - gate.z ≥ GATE.behindMiss`
  - `gateCadence(gate, cooldownLeft)` → boolean — `gate.resolved === true && cooldownLeft <= 0`

- [ ] **Step 1: Write the failing tests** in `tests/unit/timing.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, crossingSample, resolveGate, gateBehind, gateCadence } from '../../js/timing.js';
import { GATE, ASSIST } from '../../js/config.js';
import { mulberry32 } from '../../js/worldgen.js';
import { surfaceHeight } from '../../js/wave.js';

const rng = () => mulberry32(7);
const gate = (over = {}) => ({ id: 1, x: 0, y: 1, z: 100, resolved: false, result: null, ...over });

test('createGate is deterministic for a seed and respects bounds', () => {
  const a = createGate(mulberry32(7), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 3 });
  const b = createGate(mulberry32(7), { locomotion: 'swim', playerPos: { x: 0, y: 0, z: 0 }, runTime: 3 });
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.x) <= GATE.corridorX);
  assert.ok(Math.abs(surfaceHeight(a.x, a.z, 3) + GATE.swimLift - a.y) < 1e-9);
});

test('flight gates sit inside the climb band', () => {
  for (let i = 0; i < 50; i++) {
    const g = createGate(mulberry32(100 + i), { locomotion: 'fly', playerPos: { x: 0, y: 80, z: 0 }, runTime: 5 });
    assert.ok(g.y >= GATE.flightMin && g.y <= GATE.flightMax, `gate y=${g.y}`);
  }
});

test('crossingSample interpolates the crossing plane (no tunneling misses)', () => {
  const s = crossingSample({ x: 0.2, y: 1.0, z: 88 }, { x: 0.4, y: 1.0, z: 92 }, 90);
  assert.ok(Math.abs(s.x - 0.3) < 1e-9 && s.z === 90);
  assert.equal(crossingSample({ x: 0, y: 0, z: 88 }, { x: 0, y: 0, z: 89 }, 90), null);
});

test('resolveGate bands: perfect / good / miss, idempotent', () => {
  assert.equal(resolveGate(gate(), { x: 0.5, y: 1.0, z: 100 }), 'perfect');       // ≤1.2
  assert.equal(resolveGate(gate(), { x: 2, y: 1, z: 100 }), 'good');              // ≤3.0
  assert.equal(resolveGate(gate(), { x: 4.5, y: 1, z: 100 }), 'miss');            // >3.0
  const g = gate();
  resolveGate(g, { x: 0, y: 1, z: 100 });
  assert.equal(resolveGate(g, { x: 4.5, y: 1, z: 100 }), 'perfect');               // stored result wins
  assert.equal(g.resolved, true);
});

test('assist widens the perfect circle but never past good', () => {
  const r = GATE.perfectRadius * ASSIST.windowScale;
  assert.ok(r < GATE.goodRadius);
  const g = gate();
  assert.equal(resolveGate(g, { x: 1.5, y: 1, z: 100 }, { assist: true }), 'perfect');
});

test('gateBehind + gateCadence', () => {
  assert.equal(gateBehind(gate({ z: 100 }), { z: 105 }), true);
  assert.equal(gateBehind(gate({ z: 100 }), { z: 95 }), false);
  assert.equal(gateCadence(gate({ resolved: false }), 0), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0.3), false);
  assert.equal(gateCadence(gate({ resolved: true }), 0), true);
});
```

- [ ] **Step 2: Run and verify RED** — `node --test tests/unit/timing.test.js` → fails (module has no such exports)
- [ ] **Step 3: Rewrite `js/timing.js`** with the five signatures above; delete `currentWindows`, `evaluatePress`, `expirePrompt`, `withinBuffer`, `promptInterval`, `createPrompt`, and the now-dead imports (`TIMING`, `MOMENTUM`, `ASSIST` stays for assist scaling, `INPUT`, `DIFFICULTY`)
- [ ] **Step 4: Config edits** — add `GATE` block with the spec constants; delete the retired keys; `grep -rn "promptLifetime\|perfectWindow\|goodWindow\|bufferMs" js/` must return only `tests/unit/timing.test.js` (already rewritten)
- [ ] **Step 5: Run and verify GREEN** — `npm test` → all unit files pass
- [ ] **Step 6: Commit**

```bash
git add js/config.js js/timing.js tests/unit/timing.test.js
git commit -m "refactor: timing core becomes gate core (createGate/resolveGate/crossingSample)"
```

---

### Task 2: Mechanic swap (renderer + lifecycle + wiring + test rewrites)

**Files:**
- Create: `js/gate-view.js`
- Delete: `js/timing-view.js`, `tests/browser/t08-timing.mjs`
- Create: `tests/browser/t08-gates.mjs`
- Modify: `js/game.js` (lifecycle, tutorial copy, `queuePress` collapse), `js/main.js` (wiring, debug API), `tests/browser/t15-acceptance.mjs`, `tests/browser/t17-momentum-coins.mjs`

**Interfaces:**
- Consumes (Task 1): `createGate/crossingSample/resolveGate/gateBehind/gateCadence`, `GATE`; `wave.js surfaceHeight`
- Produces: `js/game.js` → `gameState.activeGate`, `gate()`, `debugTeleportToRing(offX = 0, offY = 0)`; `js/gate-view.js` → `createGateView(scene)` returning `{ group, update(dt, gate, playerPos, runTime), flash(result), resetColors() }`

- [ ] **Step 1: Write the failing browser test** `tests/browser/t08-gates.mjs` (observer recorder for popups per repo rule):

```js
// gate spawns; teleport through the center -> perfect; +2m -> good; off to the
// side -> miss + chain reset; cooldown gates the next spawn
```

Assertions (exact): after `start()`, poll `window.__FFM_API.gate()` non-null (90 s budget); `debugTeleportToRing()` → poll `state().lastResult === 'perfect'` and `state().chain === 1`; recorded popups include `PERFECT`; `debugTeleportToRing(2, 0)` → `lastResult === 'good'`, `counts.good === 1`; teleport to `debugTeleportToRing(9, 0)` → poll `lastResult === 'miss'`, `chain === 0`, `speed` drops; poll `gate()` non-null again (cooldown elapsed) within 30 s.

- [ ] **Step 2: Run and verify RED** — `node tests/browser/run-all.mjs t08` → fails (no `gate` API)
- [ ] **Step 3: Create `js/gate-view.js`** — upright torus (outer `GATE.outerRadius`, tube 0.18) + inner highlight ring + faint inner disc in the XY plane; `MeshBasicMaterial`, `transparent`, `depthWrite: false`, `fog: false`; `update` re-seats swim gates on the wave (`surfaceHeight + GATE.swimLift`), idles with slow highlight rotation + pulse, and tints gold as `hypot(player.x - gate.x, player.y - gate.y)` shrinks; `flash(result)` uses the juice colors (gold/green/red) then `resetColors()`
- [ ] **Step 4: `js/game.js` lifecycle** — replace `activePrompt`/`nextPromptAt`/`spawnPrompt`/`consumePress`/`pressQueued` with: one `activeGate` spawned at `player.z + GATE.spawnAhead` when `gateCadence(resolved, cooldownLeft) && !ended`, cooldown reset to `GATE.cooldown` on resolve; each `update(dt, input)`: sample `prevPos` before `player.update`, `sample = crossingSample(prevPos, player.state.position, activeGate.z)` → if sample: `result = resolveGate(activeGate, sample, { assist })`, `applyResult(result)`, `bus.emit('gate:resolved', result)`, start cooldown; else `gateBehind(...)` unresolved → resolve `'miss'` the same way; delete the buffered-press block, `prompt:expired` emit, `prompt:spawn` tutorial trigger; `queuePress()` keeps only the charge→`spamPress()` branch; rewrite `TUTORIAL_STEPS` to the gate beats (spawn prompt "Steer the fish THROUGH the ring to gain momentum!", perfect "Dead center = PERFECT — fills the gauge fastest!", miss "Missed the ring? Chain resets — line up the next one!", keep the gauge-full/SPAM beat); expose `gate()` and `debugTeleportToRing(offX, offY)` (sets `player.state.position` to `{ gate.x + offX, gate.y + offY, gate.z - 2 }`)
- [ ] **Step 5: `js/main.js` wiring** — drop `createTimingRing` import/instance and the ring-follow/`setProgress` block; add `createGateView(scene)` + per-frame `gateView.update(dt, game.state.activeGate, game.player.state.position, game.state.runTime)` and `flash` on `gate:resolved`; Space handler stays (charge spam only); debug API: `gate()` and `debugTeleportToRing()` in, `prompt()` and `pressAt()` out; delete `js/timing-view.js`
- [ ] **Step 6: Adapt t15 + t17** — t15's momentum loop becomes `debugTeleportToRing()` in a polled loop keeping the 90 s acceptance summary shape (`perfects > 0`, score, distance, `maxTier`); t17's chain section replaces the `prompt()/pressAt` loop with `debugTeleportToRing()`; keep every existing assertion otherwise
- [ ] **Step 7: Run and verify GREEN** — `npm test`, then `node tests/browser/run-all.mjs` (t08–t17 first; if the combined runner exceeds wall-clock, run `t19` and `t20` individually as before)
- [ ] **Step 9: One fix pass** on anything the review turns up; minors deferred to the final report
- [ ] **Step 10: Commit**

```bash
git add -A js tests/browser docs
git commit -m "feat: press-timing QTE replaced by pass-through momentum gates (suite: NN/NN unit, NN/NN browser)"
```

---

### Task 3: Live verification and ship

**Files:** modify `HANDOFF.md` (dev artifact), rebuild `flying-fish-momentum.zip`

- [ ] **Step 1: Swim screenshot** — server running; `start()`; capture: gate stands on the waterline ahead, no overlay covering the fish, contact foam/wake still intact
- [ ] **Step 2: Flight screenshot** — `setGauge(115)` + `debugForceFlight()`; capture a gate at altitude inside 63–104 with the fish needing W/S alignment; assert `debugGate().y` in band
- [ ] **Step 3: Miss + flash screenshot** — force a miss (teleport wide), capture the red flash and chain reset in HUD
- [ ] **Step 4: Min-speed cadence check** — hold a miss pattern at MinSpeed; confirm the next gate appears in playable time (≤ ~12 s); if it feels dead, retune `GATE.spawnAhead` (single constant) and note it
- [ ] **Step 5: Console clean** — zero console errors across the above (favicon 404 excepted)
- [ ] **Step 6: Ship** — full suite green (t19/t20 individually if wall-clock), then commit the zip + HANDOFF update (§4 mechanics, §7 test inventory incl. `t08-gates`, §11 history) in the repo commit style; push
