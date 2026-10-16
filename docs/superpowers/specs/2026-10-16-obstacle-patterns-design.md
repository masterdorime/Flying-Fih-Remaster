# Obstacle Variety & Placement Patterns — Design Spec (Phase 3)

**Date:** 2026-10-16 · **Status:** approved in conversation (direction + all five refinement answers), pending user review of this doc · **Repo:** flying-fish-momentum @ `ae31e93`

## 1. Purpose

Replace the independent random obstacle scatter — every hazard kept outside the central corridor, so the middle route is permanently safe — with **freeform pattern rows validated by a per-row gap rule**. The center becomes sometimes occupied; every chunk keeps a guaranteed swimmable route. This is Phase 3 of the 6-phase improvement request. Constraint (unchanged): don't make swimming unfair.

Decisions already taken with the user: freeform patterns + validator (not discrete lanes); the validator enforces a **per-row lateral gap ≥ 3.0 m**; gates that land inside an obstacle are **nudged to open water at spawn**; the full 4-pattern catalog ships at once; difficulty changes shapes only (today's 2–7 counts are kept, reinterpreted as rows); movers stay, with their **sweep extremes validated**; row spacing **scales with speed**.

Downstream of placement — overlap collision (minor/major), `applyResult`, gauge/chain/scoring, coins, flight — **does not change**.

## 2. Current system (as-is, verified in-tree)

| Piece | File | Contract today |
|---|---|---|
| Pure layout | `js/worldgen.js` | `generateChunk(index, difficulty, seed=1)` → 2–7 obstacles (`round(lerp(2,7,d))`), kinds by `kindsFor` (rock/buoy → +boat → +container), each placed on a random side at `corridor + rng × (lane − corridor)` — **always outside the corridor**; grounded y (buoy 1.2, else 0.7); movers with probability `lerp(0, 0.55, d)`; `hasSafeCorridor(chunk)` validator; `mulberry32` determinism |
| Rendering + motion + collision | `js/world.js` | `buildChunk` (seed constant 1337) clones templates; movers oscillate but are **clamped outside the corridor** (`Math.max(limit, mag)`, `:53-54`); overlap collision vs `PLAYER_RADIUS 1.1`; `clampX` (corridor-based); debug hooks `debugCount/debugTeleport/debugCorridorClear` |
| Lifecycle | `js/game.js:289` | `world.update(dt, pos, PLAYER_RADIUS, difficulty, onCollision)` — no speed passed |
| Debug surface | `js/game.js:508` → `js/main.js:432` | `debugCorridorClear()` → `__FFM_API.debugCorridorClear()` |
| Config | `js/config.js` | `WORLD` (chunkLength 120, laneHalfWidth 14, corridorHalfWidth 5); `DIFFICULTY` (rampMeters 5000, rampSeconds 120, **obstacleDensityStart/End 0.12/0.85 — unreferenced anywhere, dead**); radii rock 2.6 / buoy 1.1 / boat 3.4 / container 2.2 |
| Tests | `tests/unit/worldgen.test.js`, `tests/browser/t10-world.mjs` | determinism; grounding (y ≤ 2.5); `hasSafeCorridor` over 200 chunks × difficulties; count scaling 2–7; lane bounds; t10 §4 asserts `debugCorridorClear()` |

## 3. Target design

### 3.1 Pattern generation — `js/worldgen.js` (pure, still no three.js)

`generateChunk(index, difficulty, seed, speed)` — the new `speed` parameter (m/s at build time) drives row spacing. The old 3-arg call shape is gone; `world.js` is the only production caller.

- **Rows, not scatter.** `rows = min(round(lerp(2, 7, d)), 1 + floor(95 / spacing))` — today's count formula, reinterpreted as pattern rows per chunk, capped by how many speed-spaced rows fit in the placeable band (rows at 8 m/s still scale 2–7 with difficulty; at 110 m/s at most 3 rows fit per chunk, but chunks pass ~14× faster so encounters-per-second stay roughly constant). Row `i` is placed at chunk-local `z = 20 + i × spacing + rng × 6`, capped at 115, where `spacing = clamp(speed × ROW_SPACING_SECONDS, ROW_SPACING_MIN, ROW_SPACING_MAX)`.
- **Pattern pick.** Uniform `rng()` draw among the four shapes for each row. Every obstacle spec records its row's shape in a `pattern` field (`'slalom' | 'wall' | 'center' | 'cluster'`) for unit assertions. Slalom sign alternation threads a `prevSlalomSign` local through row composition (seeded by `rng()`), so consecutiveness stays deterministic per seed:
  - **Slalom** — 1 obstacle at `x = ±(5 + rng × 5)`, strictly alternating sides via the threaded sign (consecutive slalom rows always switch, even across other pattern rows in between — the thread only advances on slalom rows). Forces S-turns; trivially valid (one obstacle can't close 28 m of water).
  - **Wall with gap** — gap center `gx ∈ [-11, 11]`, width `w ∈ [3.2, 5.0]`. Fill `[-14, 14]` outside the gap: cursor from −14, cycling the difficulty's kind list from an `rng()` start index, placing each obstacle at `cursor + r`, advancing `cursor += 2r + rng × 1.5`; any piece intersecting the gap jumps the cursor to the gap's far edge. ≤ 6 obstacles per wall, and fill stops when a center would land past ±14 — an unfenced far side is a second gap (fairer, not a failure).
  - **Center block** — 1–2 obstacles with `|x| ≤ 4` (the newly occupiable center), open water on both sides by construction.
  - **Staggered cluster** — 2–3 obstacles inside an 8 m-wide clump centered at a random `x ∈ [-10, 10]`, `z` jitter ±2.
- **Kinds, radii, grounding unchanged.** `kindsFor`, `RADII`, y rules carry over verbatim. Intra-row `z` spread never exceeds ±2 (validator groups with `ROW_BAND 5`).
- **Movers.** Flag probability `lerp(0, 0.55, d)`, `speed`/`range`/`phase` formulas unchanged — but a mover is assigned **only if its swept envelope preserves every row gap ≥ MIN_GAP** (same interval math as the validator; otherwise the obstacle stays static). No extra `rng()` draws on the static path, so determinism holds per seed. The validator (§3.2) re-checks extremes independently.
- **Re-roll + fallback.** After composing, run `validateChunkGaps`. On failure, retry with `seed + attempt` (same index/difficulty/speed), up to 8 attempts. If all fail, emit the fallback row set: a single static rock at `x = +10` (always valid — proof: one 2.6-radius obstacle leaves a 22.8 m gap). Re-roll and fallback are pure and deterministic.

### 3.2 Validator — `js/worldgen.js`

`validateChunkGaps(chunk) → boolean`. Pure, unit-tested, the single definition of "fair":

1. Group obstacles into rows: sort by `z`, greedily group with `|dz| ≤ ROW_BAND` (5 m).
2. Per row, collect blockers as lateral intervals `[x − r, x + r]`; **movers contribute their full swept envelope** `[baseX − range − r, baseX + range + r]` — the gap must hold for every phase of the sweep, not just its endpoints (a controller ruling: strictly stronger than endpoint checks, and phase-independent).
3. Sort intervals, sweep from `-laneHalfWidth` to `+laneHalfWidth`; the row passes iff the maximum open gap is `≥ MIN_GAP` (3.0 m = fish collision diameter 2 × 1.1 + 0.8 margin).
4. The chunk passes iff every row passes. (Rows are ≥ 18 m apart by construction, so reachability between consecutive gaps needs no check — see §4.)

`hasSafeCorridor` is retired (grep-verified removal across `worldgen.js`, `world.js`, `game.js`, `main.js`, `worldgen.test.js`, `t10-world.mjs`).

### 3.3 Gate nudge — `js/timing.js` (pure) + `js/game.js` + `js/world.js`

Gates spawn at `|x| ≤ 4`, which patterns may now occupy. At spawn, the gate is nudged to swimmable water:

- `world.obstaclesNear(z, halfRange)` (new, live data): `{ x, z, radius }` for every live obstacle mesh with `|mesh.z − z| ≤ halfRange`, using **live mesh x** (includes mover offsets).
- `resolveGateOverlap(gateX, gateZ, discs)` (new pure export in `js/timing.js`, beside the QTE math): scores candidate x positions by clearance (lateral distance past each footprint) over live discs with `|disc.z − gateZ| ≤ GATE.nudgeHalfRange`. A spawn that already clears everything by `GATE.nudgeMargin` never moves (open-water gates stay exactly put — teleports and tests rely on it). Otherwise the clearest available x wins, ties keeping the nearest: near a wall that is the wall's gap center, so the fish teleports onto the gate and swims its departure line with meters of margin rather than a margin-edge graze. Best-effort throughout — dense water may have no fully clear point — and crossing the mouth always stays possible.
- `trySpawnGate` calls `createGate` as today, then applies `resolveGateOverlap` against `world.obstaclesNear(gate.z, 6)` before publishing. Note: on the very first frames chunks may not yet cover the gate's `z` (world builds in `update`, after gates) — `obstaclesNear` then returns `[]` and the gate spawns un-nudged. Acceptable: open water at run start.
- Unit-tested: inside footprint → pushed to nearest clear side; far → unchanged; clamped at lane bounds; deterministic.

### 3.4 World wiring — `js/world.js`, `js/game.js`, `js/main.js`

- `buildChunk(index, difficulty, speed)` — passes `speed` into `generateChunk`; seed constant 1337 unchanged.
- `world.update(dt, pos, radius, difficulty, speed, onCollision)` gains the trailing `speed` param; `game.js:289` passes `state.speed`. (Trailing position keeps the diff minimal.)
- Mover clamp (`:53-54`) drops the corridor floor: `mesh.position.x = sign × min(laneHalfWidth, mag)` — movers may now sweep the center; the generator + validator already guarantee the sweep never closes the gap. `clampX` (corridor-based) is updated to lane-only or retired if unreferenced (grep in implementation).
- `debugCorridorClear` → `debugChunksValid` (every live chunk passes `validateChunkGaps`), through the same `game.js` → `main.js` → `__FFM_API` chain. Plus `debugObstaclesNear(z, halfRange)` (live discs for test drivers) and `debugSetLateral(x)` (lane-clamped test steering).
- Collision, `debugTeleport`, `reset`, chunk pooling: untouched.

### 3.5 Tutorial / HUD / audio

No changes. (No tutorial beat mentions obstacles; verified by grep in implementation — if one surfaces, it keeps its text.)

## 4. Numeric constants

| Key | Value | Meaning |
|---|---|---|
| `PATTERN.minGap` | 3.0 | minimum lateral gap per row (2 × 1.1 fish + 0.8 margin) |
| `PATTERN.rowBand` | 5 | validator z-grouping window (generator keeps intra-row spread ≤ 4) |
| `PATTERN.spacingSeconds` | 0.35 | row spacing = `clamp(speed × 0.35, 18, 40)` |
| `PATTERN.spacingMin / Max` | 18 / 40 | meters between rows (at 8 m/s → 18; at 110 m/s → 38.5) |
| `PATTERN.rowZ0 / rowZ1` | 20 / 115 | rows placed within chunk-local z |
| `PATTERN.wallMax` | 6 | max obstacles per wall row |
| `PATTERN.maxAttempts` | 8 | validation re-rolls before fallback |
| `GATE.nudgeMargin` | 1.6 | gate-center clearance from obstacle centers (fish 1.1 + 0.5) |
| `GATE.nudgeHalfRange` | 6 | obstacle query window around the gate z |

New `PATTERN` block in `js/config.js`; `GATE` gains `nudgeMargin`/`nudgeHalfRange`. Unchanged: `WORLD.*`, `DIFFICULTY` ramp numbers, `RADII`, `kindsFor` tiers, `GATE` spawn/lead/cooldown/reach, mover probability/formulas. `DIFFICULTY.obstacleDensityStart/End` retired (dead — grep-verified unreferenced).

## 5. Debug / automation API

- `debugChunksValid()` → bool (replaces `debugCorridorClear()` through `game`/`main`/`__FFM_API`)
- `debugObstaclesNear(z, halfRange)` → live `{ x, z, radius }` discs (movers at current positions)
- `debugSetLateral(x)` → lane-clamped test steering, returns the set x
- `debugObstacleCount()`, `debugTeleportToObstacle()` unchanged
- Unit surface: `generateChunk`, `validateChunkGaps`, `resolveGateOverlap` (all pure)

## 6. Test plan (TDD: watched RED first)

### Unit (`tests/unit/worldgen.test.js` — rewritten where behavior changed; `tests/unit/timing.test.js` — extended)

Kept verbatim: determinism (now over `(index, difficulty, seed, speed)`), grounding, `difficultyAt`, `mulberry32`, `lerp`, lane bounds, kind validity.
- `validateChunkGaps`: hand-built blocked row (full-width wall, no gap) → false; wall with 3.2 gap → true; boundary (exactly 3.0) → true; mover whose extreme closes the gap → false; mover clearing at both extremes → true.
- Patterns: 200 seeded chunks per difficulty — every chunk valid (re-roll/fallback proof); wall rows have exactly one gap ≥ 3.2; slalom rows alternate sides when consecutive; center-block rows exist somewhere in the first 10 chunks (seed 1337); ≥ 2 distinct pattern ids across the first 10 chunks (deterministic — fixed seed).
- `generateChunk` signature: old 3-arg calls updated; speed changes spacing (same seed, speed 8 vs 110 → different row z's, same validity).
- `resolveGateOverlap` (timing.test.js): open-water/far gates unchanged; threatened spawn settles into the wall gap (gap center, not margin edge); fuzz over 50 random layouts: result in-bounds and never less clear than spawn.
- Retirements grep-verified: `hasSafeCorridor`, `debugCorridorClear`, `obstacleDensityStart/End`.

### Browser

- **t10-world (§4 rewritten)**: `debugChunksValid()` true at spawn and after travel-or-run-end (an unsteered fish is supposed to wreck itself on patterned water now — dodging is gameplay — so the section tolerates run end; center-occupation is proven deterministically in unit tests instead of by browser polling).
- **t08/t13/t15/t17/t19**: gates nudge near obstacles — teleport hooks follow the live gate, grades unaffected. Must stay green unchanged (nudge is spawn-time only).
- t01/t07–t09/t11/t12/t14/t16/t18/t20: green unchanged.

## 7. Retirements (deleted in the same change, grep-verified)

- `hasSafeCorridor` (worldgen/world/game/main/tests/t10); `debugCorridorClear` → `debugChunksValid` rename sweep.
- `DIFFICULTY.obstacleDensityStart/End` (dead config).
- Corridor clamp in `world.js` mover update + `clampX` corridor floor (or the helper, if orphaned).
- Scatter placement block in `generateChunk` (replaced by pattern composers).

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Wall fill exceeds obstacle budget / draw calls balloon | `wallMax` 6 per wall; expected typical 6–12 obstacles/chunk; the browser suite staying green is the perf gate — if t-runs blow out, tune pattern weights in a follow-up |
| Re-roll churn (movers near gaps invalidate often) | Movers pre-checked at assignment (only gap-preserving sweeps are flagged); re-roll bounded at 8 with a provably-valid fallback |
| Speed at build time varies → chunk contents differ run to run | Deterministic given identical inputs (unit-pinned); gameplay never depended on cross-run chunk identity |
| Nudge pushes a gate into another obstacle | Single pass documented as best-effort; validator-grade tests cover single + double; full-mouth clearance is explicitly NOT required (center clearance is the rule) |
| First-gate nudge misses (chunks not yet built) | Documented; open water at run start makes it harmless |
| Old tests assert corridor / counts-as-obstacles | Rewritten in the same change (TDD); nothing asserts the old invariant afterwards |

## 9. Out of scope

Flight-environment props (Phase 4), movers' visuals, collision grades, coins, fish, HUD/audio, tutorial copy, music. No new assets — all patterns compose the existing rock/buoy/boat/container templates. Also deliberately deferred: pattern unlock tiers, grid/swept validators, speed-scaled gap widths.

## 10. Verification criteria

1. Chunks contain slaloms, walls with a single ≥3.2 m gap, center blocks, and clusters — including obstacles inside the old corridor.
2. Every generated chunk passes `validateChunkGaps` (unit, 200 seeds × difficulties); movers pass at both sweep extremes.
3. A gate spawning inside an obstacle footprint is nudged to swimmable water (unit); gates remain enterable in play.
4. `debugChunksValid()` true throughout t10; `debugCenterOccupied()` true within the run.
5. `npm test` + `npm run test:browser` fully green; suite counts recorded in the commit message.
6. No console errors; swim phase completes without unavoidable hits (t15 acceptance still passes with its `misses ≤ 2` budget).
