# Variety & Formations — per-run seed + Stage 2 formation library (T13–T20)

**Date:** 2026-10-18
**Spec:** docs/superpowers/specs/2026-10-18-obstacle-fairness-design.md — §8 (per-run seed), §9 (formation library)
**Method:** TDD, audit-first; native in-session execution
**Status:** approved in plan mode

## Global constraints (stand)

- Row windows ≥ 1.2 s (walls 1.35 s), spacing floor 22 m, z-jitter add-only — never moved.
- Chain reachability at arrival speed (windows 1.2/1.35, reaction 0.25, chainMargin 0.15) — never moved.
- QTE loop/timing/speed/scoring, gate clearance ruling (§7), mover envelopes, retry budget (8 → breather skip) — untouched.
- Wall after-spacing floors derive from the builder ROLE (a continuation window that builds a wall row counts as wall), NOT from the formation tag. Tags split: `o.pattern` stays the shape class (slalom|wall|center|cluster — spacing/wall derivations keep working), `o.form` carries the formation id (new).
- Pages are served while browser suites run — no js edits during a run. Clear port 8123 listeners first. `waitForFunction(fn, null, options)` — no stray `null` (predicates take the `null` arg slot).
- Commit style `feat:|fix:|docs: <summary> (suite: X/X unit, Y/Y browser)`; zip rides feature commits via `powershell -ExecutionPolicy Bypass -File "$env:TEMP\opencode\make-zip.ps1"`; HANDOFF updated in place at closure.
- No layout pins exist anywhere: corpus tests assert invariants (dz/spacing/gap/chain) and browser tests live-read — verified 2026-10-18 before this plan.

## Ledger

- [ ] **T13** docs commit: this plan + spec §8/§9.
- [ ] **T14** per-run seed watched-RED: `tests/browser/t21-variety.mjs` phase A — capture near-obstacle signature at fixed conditions, `debugRestart()`, re-capture, expect DIFFERENT (pre-fix: identical → RED).
- [ ] **T15** per-run seed GREEN + unit seed contract pin + suites + feat commit.
- [ ] **T16** formation RED: `tests/unit/worldgen-formations.test.js` — roster presence + no-immediate-repeat at d 1.0; gating at d 0.2; speed tilt (hi-form share + intentional-breach count rise with speed); streamed determinism.
- [ ] **T17** formation GREEN: config `FORMATIONS` knobs; worldgen roster pick (weighted, gated, no-repeat) + locked-role windows + role dispatch (wideGate/riskLane/offsetTurn/fork/chicane/breather) + `form` state threading (`composeChunk` state.form/formOut, `generateChunk` replay, `world.js` genState); `o.form` tag; `world.js` obstaclesNear carries pattern+form.
- [ ] **T18** full unit suite + upgraded fuzz green; fairness corpus extensions assert every gated formation is covered by the legality corpus (dz/spacing/gap/chain floors unchanged).
- [ ] **T19** t21 phase B: live formation variety at depth (teleport deep, d ≥ 0.8): ≥ 4 distinct forms sampled, no back-to-back form ids, console clean.
- [ ] **T20** feat commit + zip + docs commit closing T13–T20 + HANDOFF §4/§6 update.

## Task detail — T14/T15: per-run seed

**Audited root cause (2026-10-18):** `js/world.js buildChunk` calls `composeChunk(index, difficulty, 1337, speed, genState)` — the seed literal makes every chunk of every run identical. The pure layer (`composeChunk`/`generateChunk`) already varies layout per seed (streams keyed by `streamKey(seed, index, …)`) — this is a wiring defect only. `gateRng` (module-global `mulberry32(0x9a7e)`, js/game.js:135) continues across restarts so gate placement already varies run-to-run.

**Edits (~10 lines):**
- `js/world.js`: `let runSeed = 1337;` (default keeps the historical pin for probes); `buildChunk` passes `runSeed`; `reset(seed = 1337) { runSeed = seed >>> 0; … }`.
- `js/game.js restart()`: draw `state.runSeed = seed from ?seed= URL param if >0 else (Math.random() * 0x100000000) >>> 0`; call `world.reset(state.runSeed)`. Add `runSeed` to the state `Object.assign`.
- `js/main.js` `__FFM_API`: add `seed: () => game.state.runSeed` (observability).

**Tests:**
- `tests/unit/worldgen.test.js` — contract pin: `generateChunk(3, 0.5, 1337, 25)` vs `…4242…` obstacle signatures differ; same seed twice equal (dedup with existing seed-42 determinism test). Pure layer — passes today, pins the contract.
- `tests/browser/t21-variety.mjs` phase A (the watched RED): boot via `__FFM_API.start(...)` per t10 §3c pattern → wait `debugObstaclesNear(0, 60).length > 0` → signature = sorted `[x,z]` to 0.5 → `debugRestart()` → wait → re-signature → assert differ. `?seed=777` control: two restarts with the pinned param give EQUAL signatures (proves the drawing, not rng luck).

**Commit:** `feat: per-run world seed — world.reset(seed) + per-restart draw (?seed= URL pin) kills the every-run identical layout replay … (suite: 83/83 unit, 17/17 browser)`; zip rides.

## Task detail — T16/T17: formation library

**Approved roster** (config `FORMATIONS.roster`, values tunable there):

| id | weight | minD | tilt | windows |
|----|--------|------|------|---------|
| slalom / wall / center | 1.0 | 0 | 0 | 1 (basics) |
| cluster | 0.9 | 0.25 | 0.4 | 1 |
| breather | 0.5 | 0.15 | 1.4 | 1 (intentional empty window) |
| wideGate | 0.8 | 0.35 | 1.6 | 1 — wall row, gap `gw = 9 + rng()*3` |
| offsetTurn | 0.8 | 0.40 | 0.6 | 2 — big-offset slalom rows, alternating sign |
| fork | 0.8 | 0.55 | 1.0 | 2 — centerRow, then wall row with gap `gx = ±(4..8)` |
| chicane | 0.7 | 0.55 | 0.4 | 2 — wall rows, edge gaps on opposite sides |
| riskLane | 0.6 | 0.70 | 0 | 1 — wall row, edge-hug gap `gx = ±(10..13)`, `gw = 3.6..4.5` |

**Mechanics (js/worldgen.js):**
- `state.form = { id, seq, last, breathers }`: formation in progress, remaining pending roles, last completed id (no-repeat guard), intentional-breather tally.
- Per window BEFORE the attempt loop: continuation (`seq[0]`) or one weighted pick (`mulberry32(streamKey(seed, index, 5, ordinal))`) → `pickFormation(d, speed, last)`; eligible = `minD <= d && id !== last`; weight `w = weight * (1 + tilt * speedT)`, `speedT = clamp((speed − 25) / (110 − 25), 0, 1)` (knobs in config). Attempt loop builds the LOCKED role each retry (retries re-jitter, not re-pick).
- `role === 'breather'` → commit-empty path (existing skip mechanics; `last='breather'`, `breathers++`). All-attempts-fail → enforced breather (existing) and clears form state.
- Commit: `o.form = formId` on every obstacle of the row; `o.pattern` unchanged (shape class); wall-ness for spacing floors from the ROLE (`windowDistance(speed, roleIsWall)` and `prevRow.wall`).
- Return adds `formOut: { id, seq, last, breathers }`; thread through `generateChunk` replay state AND `world.js` genState assignment (`form: spec.formOut`).
- `wallRow(rng, rowZ, d, opts)` gains optional `{ gx, gw }` overrides (default = today's numbers; basic wall behavior unchanged).

**Tests (RED batch first):**
- `tests/unit/worldgen-formations.test.js` (new): walk helper threads composeChunk state incl. form exactly like world.js.
  - roster presence + consecutive-id no-repeat across seeds at d 1.0, speed 60 (breathers excluded from tag observability — noted).
  - gating: d 0.2 seeds sweep → only basics tagged; gated ids never appear.
  - tilt: at d 0.9, per-chunk hit share {wideGate, fork} at speed 110 > at 25; `formOut.breathers` per 16-chunk walk at 110 > at 25. 24-seed sweeps, deterministic.
  - determinism: same seed → identical form stream; different seed → different stream.
- `tests/unit/worldgen-fairness.test.js` — extend corpus: every walked chunk's `o.form` ∈ roster ids; corpus seed sweep reaches every gated formation ≥ once (keeps the legality floors exercised per formation). Existing floors untouched and still green.

**Browser:** t21 phase B — `debugTeleportFar` style deep run (t15 router precedent), d ≥ 0.8 stretch; sample forms from `debugObstaclesNear` over the stretch: ≥ 4 distinct ids, no consecutive repeats, console clean.

**Commits:** `feat: stage 2 formation library — weighted difficulty-gated formations (wide gate/offset turn/fork/chicane/risk lane/breather), no-immediate-repeat guard, speed-tilt toward wide paths; row windows/spacing/chain floors untouched …`; zip rides; then docs commit closes the ledger.

**Out of scope:** flight, QTE changes, camera rework, SFX (Stage 6), coin module changes (risk lanes pay via `findClearLane` naturally).
