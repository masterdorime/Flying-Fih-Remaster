# Ring-Gate QTE — Design Spec

**Date:** 2026-10-14 · **Status:** approved in conversation, pending user review · **Repo:** flying-fish-momentum @ `76c286d`

## 1. Purpose

Replace the press-timing QTE (shrink a ring to its core, hit SPACE at the right moment) with a **momentum gate the fish physically passes through**. The player steers (and in flight, climbs/dives) through a portal; the quality of the pass grants momentum. SPACE is retired as a scoring input entirely and keeps only its launch-SPAM role.

## 2. Current system (as-is, verified in-tree)

| Piece | File | Contract today |
|---|---|---|
| Pure timing core | `js/timing.js` | `currentWindows(speed,{assist})`, `createPrompt(now, lifetime)`, `evaluatePress(prompt, pressTime, windows)` → `'perfect'\|'good'\|'miss'\|null`, `expirePrompt`, `withinBuffer`, `promptInterval(difficulty)` |
| Ring visual | `js/timing-view.js` | camera-facing shrinking double ring overlay (`setProgress(progress)`, `flash(result)`) — the overlay that blocks the view |
| Lifecycle | `js/game.js` | `activePrompt`, `nextPromptAt`, `spawnPrompt()`, `consumePress(atTime)`, `queuePress()` (charge → `spamPress`, else buffered); frame-start buffered press consumed at `state.runTime`; scheduling via `promptInterval(difficulty)`, frozen during `charge`/`leap`; expiry emits `prompt:expired` |
| Frame wiring | `js/main.js` | keydown Space → `game.queuePress()`; ring positioned ahead of the fish, `quaternion` copied from camera, `setProgress` per frame |
| Debug API | `js/main.js` | `prompt()`, `pressAt(t)` |
| Config | `js/config.js` | `TIMING` (perfectWindow .07, goodWindow .18, minPerfectWindow .045, minGoodWindow .11, promptLifetime 2.2, recentPerfectSeconds 2.5 — **last one stays**), `INPUT.bufferMs`, `ASSIST.windowScale` |
| Tests | unit `timing.test.js`, browser `t08-timing.mjs`, `t13-flow`, `t15-acceptance` (45 perfects via `pressAt`), `t19` chain-gate flow | drive presses |

Downstream of the result — `applyResult` → gauge (`+8/+4`), momentum, chain, tier, scoring (500/150), launch gate (chain ≥ 5, gauge ≥ 100) — **does not change**.

## 3. Target design

### 3.1 Core contract — pure module `js/timing.js` (rewritten)

- `createGate(rng)` → `{ id, x, y, z, resolved: false, result: null }` — geometry-only; rng injected (mulberry32-style) like `worldgen.js` so placement is unit-testable and deterministic.
- `resolveGate(gate, playerPos)` → `'perfect' | 'good' | 'miss' | null`. Null while the fish has not reached the gate plane. Once reached (see 3.3), grade by distance from the ring's central axis (horizontal `dx` and vertical `dy` combined): `≤ PERFECT_R` perfect, `≤ GOOD_R` good, otherwise miss. Sets `gate.resolved`/`gate.result` (idempotent).
- `gateCadence(prevGate, playerZ, cooldownActive)` → whether the next gate may spawn: prev resolved AND cooldown elapsed.
- `gatePlacement(locomotion, player, rng, surfaceY)` → corridor X, waterline Y (swim) or flight-band Y (fly).

### 3.2 Lifecycle — `js/game.js`

- One live gate. `game.state.activeGate` replaces `activePrompt`; `gate()` replaces `prompt()`.
- Spawn: 90 m ahead of the fish (`GATE_SPAWN_AHEAD`), only after the previous gate resolved + `GATE_COOLDOWN` (0.6 s). `X` uniform in ±4 (inside the ±5 safe corridor; obstacles never enter the corridor, so gates and hazards can't stack). Swim: `Y = surfaceHeight(x, z, time) + 0.8`. Flight: `Y` uniform in 63–104 — inside the `FLIGHT` band (57–110) so W/S alignment matters.
- Each frame (swim/charge-free only): if the fish has crossed the gate's Z plane (past `gate.z`), resolve immediately. If the gate is ≥ 6 m behind the fish unresolved, resolve as `'miss'` (the player went around it).
- Resolution → `applyResult(result)` + visual flash (event `gate:resolved` or direct view call) + cooldown timer.
- `queuePress()` collapses to the charge-only spam lever; the buffered-press path is deleted.

### 3.3 Rendering — new `js/gate-view.js`; `js/timing-view.js` retired

- `createGateView(scene)` → `{ group, update(dt, playerPos), flash(result), resetColors() }`.
- Upright portal: torus (outer 3 m, tube 0.18) + inner highlight ring + faint inner disc, in the XY plane so the fish flies *through* it. World-space, ahead of the fish; `depthWrite: false`; renderOrder below HUD. Idle: slow rotation of highlight + soft pulse.
- Proximity tint: shifts gold as the fish nears the gate axis (opacity boost), red flash on miss.
- No camera-facing overlay anywhere — the view stays clean (the user's explicit requirement).

### 3.4 Frame wiring — `js/main.js`

- Remove Space→`queuePress` for scoring; Space still reaches `game.queuePress()` (charge spam) — simplest: keep the call, since `queuePress` no-ops outside charge.
- Replace the ring-follow block with `gateView.update(dt, player.position)`.
- `debugGate()` replaces `prompt()`; `debugTeleportToRing(offX = 0, offY = 0)` teleports the fish to the live gate's plane ± offsets (perfect/good/miss test hooks), analogous to `debugTeleportToCoin`.

### 3.5 Tutorial — `js/game.js` `TUTORIAL_STEPS`

Rewrite the QTE beats: "Steer the fish THROUGH the ring to gain momentum!" on gate spawn; "Dead center = PERFECT — fills the gauge fastest!" on perfect; "Missed the ring? Chain resets — line up the next one!" on miss. The gauge-full/launch beat stays.

## 4. Numeric constants (new `GATE` block in `js/config.js`)

| Key | Value | Meaning |
|---|---|---|
| `perfectRadius` | 1.2 | center circle (> fish collider 1.1 → fair but tight) |
| `goodRadius` | 3.0 | outer band; beyond = miss |
| `outerRadius` | 3.0 | visual torus radius (matches good band) |
| `spawnAhead` | 90 | meters ahead of the fish |
| `cooldown` | 0.6 | seconds between resolve and next spawn |
| `behindMiss` | 6 | meters past the plane → forced miss |
| `swimLift` | 0.8 | portal center above the wave surface while swimming |
| `flightMin` / `flightMax` | 63 / 104 | gate Y band while flying (inside 57–110) |
| `corridorX` | 4 | absolute X bound for placement |

## 5. Debug / automation API

- `debugGate()` → `{ x, y, z, resolved, result } | null`
- `debugTeleportToRing(offX = 0, offY = 0)` → new player position (z = gate.z − 2 so the crossing happens next frames)
- Retired: `prompt()`, `pressAt()`

## 6. Test plan

### Unit (`tests/unit/timing.test.js` — rewritten)
- `createGate` deterministic for a seed; placement respects `GATE` bounds and corridor.
- `resolveGate`: inside perfect radius → perfect; inside good band → good; outside → miss; not-yet-crossed → null; idempotent after resolve.
- `gateCadence`: no spawn while unresolved; spawns after cooldown.
- Assist scales `perfectRadius` by `ASSIST.windowScale`.

`tests/unit/worldgen/gauge/momentum/scoring/settings/wave/wake` — untouched.

### Browser (rewritten where they drove presses)
- **t08 → gates**: a gate spawns; `debugTeleportToRing()` → perfect (gauge/speed/chain/popup PERFECT); `debugTeleportToRing(2, 0)` → good; teleport-wide → miss + chain reset + speed cut; cooldown respected before next gate.
- **t15 acceptance**: momentum driven by `debugTeleportToRing()` loop; keep the 90 s acceptance summary shape (perfects > 0, score, distance).
- **t13 flow / t19 chain gate**: adapt to the gate flow (chain ≥ 5 → charge; SPAM; leap; flight crossing gates at altitude).
- t01/t07–t12/t14/t16–t18/t20 — must stay green unchanged.

## 7. Retirements (deleted in the same change, with their tests)

- `js/timing-view.js`; `ring.*` wiring in `js/main.js`.
- `TIMING.perfectWindow`, `goodWindow`, `minPerfectWindow`, `minGoodWindow`, `promptLifetime`; `INPUT.bufferMs` (all grep-verified unreferenced afterwards).
- `currentWindows`, `evaluatePress`, `expirePrompt`, `withinBuffer`, `promptInterval`, `createPrompt` from `js/timing.js`.
- Buffered-press path (`pressQueued`, `consumePress`, frame-start consume), `prompt:expired` event, `prompt:spawn` tutorial trigger.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Passing through at max speed is hard | Perfect radius 1.2 with 3 m good band; assist widens the center circle |
| Gates confusing against the ocean | Gold proximity tint + pulse; big portal (3 m vs 5.5 m fish) |
| Vertical alignment in flight frustrating | Band 63–104 generous; gate X fixed near corridor center |
| Anything still calling retired API | Grep audit for `pressAt|prompt()|queuePress|currentWindows` before commit; suite green |

## 9. Out of scope

Fish model, ocean/water, clouds, wake, music, HUD layout. No changes to gauge/momentum/scoring/launch mechanics — only the input that produces their results.

## 10. Verification criteria

1. A gate spawns ahead; the fish passes through → PERFECT/GOOD popup, gauge fills, chain increments, speed boosts.
2. Missing a gate → MISS popup, chain reset, speed cut; the next gate spawns after cooldown.
3. In flight, gates sit at altitude; W/S alignment changes the grade.
4. No ring overlay blocks the chase view at any time.
5. `npm test` + `npm run test:browser` fully green (t19/t20 may need individual runs for wall-clock).
6. No console errors.
