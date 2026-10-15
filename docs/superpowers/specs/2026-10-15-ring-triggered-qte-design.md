# Ring-Triggered QTE — Design Spec (Phase 2)

**Date:** 2026-10-15 · **Status:** approved in conversation, pending user review · **Repo:** flying-fish-momentum @ `dfb2fdf`

## 1. Purpose

Change how momentum gates are graded: **crossing the ring's mouth opens exactly one SPACE window, and the press times the grade.** The pass-through system grades by where the fish crosses; the QTE grades by when the player presses. Crossing position no longer decides the result — the press does. This implements the Phase 2 model decided in `HANDOFF.md` §9.3, with the window lengths, cue, assist behavior, and eligibility rule chosen with the user.

Downstream of the result — `applyResult` → gauge (+8/+4), momentum boost/cut, chain, scoring (500/150), the launch gate (chain ≥ 5, gauge ≥ 100) — **does not change**. SPACE keeps exactly one job outside the QTE: the launch charge spam.

## 2. Current system (as-is, verified in-tree)

| Piece | File | Contract today |
|---|---|---|
| Pure gate core | `js/timing.js` | `createGate(rng, {locomotion, playerPos, runTime, speed})`, `crossingSample(prevPos, pos, gateZ)` (interpolated plane crossing), `resolveGate(gate, sample, {assist})` → `'perfect' \| 'good' \| 'miss'` graded by **distance** from the ring axis (≤1.2 m × `ASSIST.windowScale` / ≤3.0 m), idempotent; `gateBehind`, `reseatSwimGate`, `gateCadence` |
| Lifecycle | `js/game.js` | One live `activeGate`; per frame (swim/charge-free, not locked) `reseatSwimGate` → crossing → `resolveGateResult(resolveGate(...))` → `applyResult` + `gate:resolved` event + gate nulled + 0.6 s `gateCooldown`; unresolved ≥6 m behind → forced miss; `clearGate()` drops the gate unscored on every launch/descent transition |
| Press input | `js/main.js` → `js/game.js` | `keydown Space` → `game.queuePress()`; `queuePress` only spams during `charge` |
| Visual | `js/gate-view.js` | World-space torus (3 m) + highlight + disc, gold proximity tint, `flash(result)` 0.25 s |
| Result feedback | `js/juice.js` + `js/audio.js` | DOM popups on `timing:result`; SFX file-first with synth fallback (`synthFallback` voices) |
| HUD | `js/hud.js` | `createHud(root)` → `update(state)` per frame from the main loop |
| Config | `js/config.js` | `GATE` (perfectRadius 1.2, goodRadius 3.0, outerRadius 3.0, spawnAhead 90, spawnMin 45, leadSeconds 4, cooldown 0.6, behindMiss 6, swimLift 0.8, flightMin/Max 63/104, flightReach 8, corridorX 4); `ASSIST.windowScale 1.6`; `TIMING.recentPerfectSeconds 2.5` |
| Tests | `tests/unit/timing.test.js`, `tests/browser/t08-gates.mjs`, t13/t15/t19 | Drive gates via `debugTeleportToRing(offX, offY)` and assert spatial grades |

## 3. Target design

### 3.1 Core contract — pure module `js/timing.js`

Kept unchanged: `createGate`, `crossingSample`, `gateBehind`, `gateCadence`, `reseatSwimGate`.

Replaced: `resolveGate` → **`mouthHit(gate, sample)`** → `'inside' | 'miss'`. Pure geometry, no mutation: `Math.hypot(sample.x - gate.x, sample.y - gate.y) <= GATE.mouthRadius` (the 3 m torus radius — the mouth is the old good band). Crossing outside the mouth is a plain Miss with no QTE. No assist parameter — assist widens timing, not geometry (see §4).

New QTE math (pure, no three.js):

- `createQte(gate, now, { assist = false })` → `{ gateId, startedAt: now, perfectWindow, goodWindow, resolved: false, result: null }`, with `perfectWindow = QTE.perfectWindow * (assist ? ASSIST.windowScale : 1)` and `goodWindow` likewise. The scaled windows are baked in at creation so downstream math is trivial.
- `evaluatePress(qte, pressAt)` → `'perfect' | 'good' | 'miss'`. `elapsed = pressAt - startedAt`; `elapsed < 0` → `'miss'` (a press that predates the window never counts); `elapsed <= perfectWindow` → `'perfect'`; `<= goodWindow` → `'good'`; else `'miss'`. Sets `resolved`/`result` and returns the stored result on any later call — **exactly one grade per QTE**.
- `qteRemaining(qte, now)` → `max(0, startedAt + goodWindow - now)`. Shared by the game (auto-miss expiry) and the HUD (countdown drain), so the readout and the rule can never disagree.

### 3.2 Lifecycle — `js/game.js`

- New state `activeQte` alongside `activeGate`. On a crossing sample: `mouthHit(gate, sample)`:
  - `'inside'` → `activeQte = createQte(gate, state.runTime, { assist: state.assist })`; `bus.emit('qte:open', activeQte)`. **The gate stays live and unresolved** — `gateCadence` already refuses to spawn while a gate is live, so a closely spaced ring can neither spawn into nor cancel an open QTE. This is the eligibility rule: the single-live-gate invariant, verified in code.
  - `'miss'` → `resolveGateResult('miss')` immediately (plain miss, no QTE).
- While `activeQte` is pending and `!resolved`: when `state.runTime >= activeQte.startedAt + activeQte.goodWindow` with no press → `resolveQte('miss')` (auto-miss expiry). **This deadline is checked before `gateBehind`** in `updateGates` (6 m behind at minimum speed is 0.75 s — comparable to the 0.70 s window, so ordering matters).
- `queuePress()`: if `activeQte && !activeQte.resolved` → `resolveQte(evaluatePress(activeQte, state.runTime))`; else if charging → `spamPress()`. A press before any crossing finds no QTE (the window never opens early — per the decided model).
- `resolveQte(result)` → existing `resolveGateResult(result)` (applyResult + `gate:resolved` + tutorial + cooldown), then `activeQte = null`.
- `clearGate()` also nulls `activeQte` (launch/descent transitions drop a pending QTE unscored, same policy as the gate — it cannot occur in real play because a live gate blocks the gauge-fill tick path, this keeps the invariant true for debug hooks). `endRun` clears `activeQte` too, so nothing outlives a run.
- Pause/time-scale safety: the deadline is `state.runTime`-based and `update` is frozen outside `run`/`tutorial`, so an open window freezes while paused.
- New `game.qte()` accessor (or `null`).

### 3.3 Cue — HUD countdown + audio (no camera-facing overlay)

- **`js/hud.js`**: new `#ffm-qte` element — a compact draining ring (~64 px) with a `SPACE` key label, anchored bottom-center above the gauge (the gauge occupies `bottom: 28px`; the prompt sits above it). New `updateQte(qte, runTime)` called from the main loop right after `hud.update(game.state)`: no qte → hidden; else `t = 1 - qteRemaining(qte, runTime) / qte.goodWindow`, ring drains with `t`, **gold while `t <= perfectWindow / goodWindow`** (the perfect zone is the start of the drain) shifting to the HUD's cyan tint once only the good window remains. Progress comes from `runTime`, never wall-clock, so pause/`setTimeScale` behave.
- **`js/audio.js`**: a synth-only voice `qte()` (short soft blip, e.g. two quiet sine tones ≈ 880/1320 Hz) added to `synthFallback` and wired `bus.on('qte:open', sfx.qte)` next to the existing `timing:result` listener. No new audio file — nothing invented.
- Result feedback (popup + perfect/good/miss SFX) is completely unchanged; it still fires from `timing:result` inside `applyResult`.
- Ring flash on resolve (`js/gate-view.js`) is unchanged.

### 3.4 Tutorial — `js/game.js` `TUTORIAL_STEPS`

Rewrite the gate beats: spawn → "Cross the ring, then hit SPACE inside the window!"; perfect → "Perfect timing — the gauge fills fastest!"; miss → "Window missed — the chain resets!". The gauge-full/launch beat stays.

## 4. Numeric constants

New `QTE` block in `js/config.js` (decided with the user, 2026-10-15):

| Key | Value | Meaning |
|---|---|---|
| `perfectWindow` | 0.30 | seconds after crossing; a press within this = Perfect |
| `goodWindow` | 0.70 | seconds after crossing; a press within this (but past perfect) = Good; beyond / no press = Miss |

Config changes: `GATE.goodRadius` renamed **`GATE.mouthRadius`** (same value, 3.0 — the name now describes geometry, not a grade); `GATE.perfectRadius` removed; `ASSIST.windowScale` comment updated to "widens the QTE press windows (perfect 0.48 s, good 1.12 s)". `TIMING.recentPerfectSeconds` unchanged. `DIFFICULTY.promptInterval*` stay retired — not reused for window scaling (windows are fixed by decision).

## 5. Debug / automation API (`js/game.js`)

- `qte()` → pending QTE `{ gateId, startedAt, perfectWindow, goodWindow, resolved, result } | null`
- `debugPress()` → a SPACE press landing at the current `state.runTime` (same path as `queuePress`)
- `debugPressAt(t)` → a press evaluated at an explicit run-time `t` (deterministic browser tests; no wall-clock races)
- `debugGate()`, `debugTeleportToRing(offX, offY)` unchanged; tests now teleport with offsets < mouth radius to open a QTE and ≥ mouth radius for the plain-miss case

## 6. Test plan

### Unit (`tests/unit/timing.test.js` — rewritten, TDD: watched RED first)

- `mouthHit`: inside → `'inside'`; exactly at `mouthRadius` → `'inside'`; outside → `'miss'`; graded on both axes (hypot).
- `createQte`: windows equal `QTE` config; assist scales both by `ASSIST.windowScale`; `startedAt` = now.
- `evaluatePress`: within `perfectWindow` → `'perfect'`; within `goodWindow` → `'good'`; past → `'miss'`; press before `startedAt` → `'miss'`; second call returns the stored result.
- `qteRemaining`: 0 after the deadline; exact before.
- `createGate` / `crossingSample` / `gateBehind` / `gateCadence` / `reseatSwimGate` tests carried over unchanged.

All other unit files untouched.

### Browser (`tests/browser/t08-gates.mjs` — rewritten)

- A gate spawns; `debugTeleportToRing()` → poll `qte()` non-null → `debugPress()` → PERFECT (popup, gauge +8, chain +1).
- `debugTeleportToRing()` → poll `qte()` → poll `state.runTime - qte.startedAt > qte.perfectWindow` → press → GOOD (+4). (Poll run-time — never a fixed sleep.)
- `debugTeleportToRing()` → poll run-time past `startedAt + goodWindow` with **no press** → MISS (chain reset, speed cut).
- `debugTeleportToRing(3.5, 0)` (outside the mouth) → plain MISS and `qte()` stays `null` the whole time (no window opened).
- Next gate spawns only after resolution + the 0.6 s cooldown; flight gates still inside 63–104; no gates while descending.
- t15 acceptance: loop = teleport(0,0) → wait qte → press; keeps the 90 s summary shape (perfects > 0).
- t13/t19: chain-to-launch flow now earns perfects via press; launch sequence (chain ≥ 5, gauge ≥ 100, SPAM, leap, flight) unchanged.
- t12/t17 adapt where they assert gate grades; t01/t07/t09/t10/t11/t14/t16/t18/t20 stay green unchanged.

## 7. Retirements (deleted in the same change, grep-verified)

- `resolveGate` from `js/timing.js` (distance grading) and its unit tests.
- `GATE.perfectRadius`; `GATE.goodRadius` → `GATE.mouthRadius` rename sweep (`timing.js`, `gate-view.js` disc, tests).
- Nothing in `applyResult`, momentum, gauge, scoring, flight, or worldgen is touched.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Window too tight to read at 110 u/s | 0.30/0.70 s fixed; assist widens ×1.6; dual cue (HUD drain + audio blip); values are one config block |
| Mash-tapping catches windows more often than the old 70 ms QTE did | Accepted by decision: the windows are deliberately readable; Perfect stays a timing skill paced by the audio blip + HUD drain, and the gauge/chain/tier economy is unchanged |
| Countdown desyncs from the rule | Both read `qteRemaining` (same pure helper) |
| Pause with an open window | Deadline is run-time-driven; the update loop is frozen while paused |
| Press meant for the next ring arrives during this window | First press grades and resolves (exactly one QTE); leftover presses fall through to the charge path only |
| Old API still referenced | Grep audit for `resolveGate|perfectRadius|goodRadius` before commit; full suite green (t19/t20 individually if wall-clock challenged) |

## 9. Out of scope

`applyResult`, gauge/chain/scoring/launch mechanics, flight environment (Phase 4), obstacle patterns (Phase 3), fish, ocean, worldgen, music. No new assets. Also deliberately deferred: input buffering across rings, difficulty-scaled windows.

## 10. Verification criteria

1. Crossing inside the ring mouth opens exactly one SPACE window (HUD countdown + audio), never before crossing.
2. Press ≤0.30 s → PERFECT: +8 gauge, chain+1, speed boost, 500 score. Press 0.30–0.70 s → GOOD: +4. Later / no press → MISS: chain reset, tier-based speed cut.
3. Crossing outside the mouth → plain MISS, no window opens (`qte()` stays null).
4. A second ring cannot spawn — or cancel an open QTE — until the QTE resolves and the 0.6 s cooldown elapses.
5. `debugPress` / `debugPressAt` drive the same code path as the keyboard.
6. `npm test` + `npm run test:browser` fully green; suite counts recorded in the commit message.
7. No console errors; no camera-facing overlay at any time.
8. Per repo agreement: `feat:` commit to `main` with suite counts, and `flying-fish-momentum.zip` rebuilt on ship.
