# Horizon Depth — Implementation Plan (H1–H9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-10-21
**Spec:** `docs/superpowers/specs/2026-10-21-horizon-depth-design.md` — stages H1–H6. The spec travels with this plan; executors read both.
**Completes:** `docs/superpowers/plans/2026-10-19-ocean-cohesion.md` T12 (the horizon layer), which was never started.
**Method:** TDD, audit-first; native in-session execution
**Status:** H1–H8 **done and committed**. H9 **stopped part-way** — see *Status at stop* below.

## Goal

Make distance read across the whole visible range: distant rock standing *in* the swell (recycled with travel), a haze band painted on the dome that holds station, and mid-ground content in the empty 150–400 m band — so the horizon stops being a bare seam and the props stop reading as stickers on the sea.

## Architecture

A new pure `js/farfield.js` owns everything about *where* distant things go (its own RNG stream, the 240 m floor, count/scale/spacing bounds) so that math is unit-testable in node. A new impure `js/horizon.js` renders it: pooled rock FBX on the swell with the existing wet-band treatment, plus instanced mid-ground drift. The static haze band is not a new mesh — it is a tuning of `js/sky-dome.js`'s existing horizon haze, with its numbers moved into `config.ATMOSPHERE.sky`. `ATMOSPHERE.fog` gets its `near`/`far` retuned (same linear shape) so the fog curve bites in the near-mid field.

## Two engineering decisions this plan fixes (read before H6/H7)

1. **The far layer takes its randomness from a pure module, not `Math.random()`.** The pattern being reused, `sky-world.js`, calls `Math.random()` at four sites (`:36,44,57,59`), which makes its layout unreproducible across runs. This layer's placement lives in pure `farfield.js` on the house `mulberry32`/`streamKey` machinery, because otherwise neither the live-read browser assertions nor the frozen-vantage screenshot A/B can be repeated — and repetition is the whole basis of this project's verification.
2. **Distant stacks get the wet band but are NOT registered with `game.nearHulls()`.** The tempting move is to add them to the hull list so they inherit the foam collar and contact decal. That would be wrong twice: the collar array is `ATMOSPHERE.contact.count` (6) slots and `nearHulls()` is budgeted to `contact.hullRange` (70 m), so distant rock would either be dropped silently or evict the near hulls that actually need the cue. At 240 m+ a collar is a few pixels wide (spec §4.2). Stacks ride the swell and carry the wet band; the water's side of their junction is not modelled, deliberately.

## Global Constraints (stand)

- The layer draws from its **own** RNG stream, slot **≥ 90**. worldgen's slots 1–5 are all in use (`worldgen.js:435,460,468,491,498`); no existing draw may move and the corpus pins (`worldgen.test.js`, `worldgen-fairness.test.js`, `worldgen-formations.test.js`) must keep passing unchanged.
- **Non-collidable by construction:** never registered with `obstaclesNear`, never in a chunk record, no capsule. Asserted live (H6).
- **Nothing renders nearer than 240 m** (`ATMOSPHERE.horizon.minDistance`) — a unit-tested property.
- Assets: the 12 rock FBX already on disk (`assets/models/rocks/`). The layer loads its own templates lazily; `models.js` and `loadModels`' boot path are **not** touched.
- **One fog curve, linear shape.** `ATMOSPHERE.fog` `near`/`far` are retuned; `atmosphere.js:45-49`'s `smoothstep` shape and its parity with `scene.fog` (`main.js:65`) and the water shader are preserved. `FogExp2` is explicitly out of scope.
- Caps come from a **measured** before/after fps on this rig, single workload (`AGENTS.md` §5.3, §10) — not from taste.
- Failure degrades, never throws: a failed or missing rock load leaves the haze band and drift rendering, `update` never throws, and no frame can go black (spec §7).
- **Ocean only.** Hidden whenever the flight world shows, driven from `main.js`'s existing `updateEnvironment` swap (`main.js:256-268`).
- Untouched: §4 invariants, QTE loop/timing/scoring/`applyResult`, speed values, worldgen layout, obstacle shapes, coins/scoring, HUD, flight/sky world, `sky-world.js`.
- No new dependencies, no new assets.
- **No `js/` edits while a browser suite runs.** Run browser work with `FFM_PORT` set (e.g. `8143`) so the user's dev server on 8123 is never cleared (`AGENTS.md` §5.6; the harness honours `FFM_PORT` since `b2a9d87`).
- `waitForFunction(fn, null, options)` — the predicate's `null` goes in the **arg** slot, never options (`AGENTS.md` §5.4).
- No layout pins; browser assertions stay live-read (compare against values the debug hook reports, never against a duplicated literal), and every t-file ends console-clean.
- Commit style `<type>: <summary> (suite: X/X unit, Y/Y browser)`; counters are only what was actually read. Handoff `docs commit → feature commit` order per `AGENTS.md` §6.
- **Zip is NOT regenerated by this plan** — the tracked zip is 6 commits stale by design and the user asks when they want a hand-testable build (`AGENTS.md` §6).

## Review Focus

Inputs and failure modes the spec implies but no task's happy path exercises. Each gets its test in the owning task.

1. **A rock FBX missing, or the load rejecting.** The layer must degrade to drift + haze band, leave `ready` false, never throw, never black a frame. (H6)
2. **A stack recycled from behind the fish to ahead of it.** It must never appear inside the 240 m floor for even one frame, and must never land inside the lane's x-range — the recycle path is a different code path from initial placement, and it is the one that would put rock in the player's face. (H6)
3. **The ocean/flight swap.** The horizon group must be hidden while the sky world shows, restored on descent, and must not carry stale positions across a restart. (H6)
4. **A restart with a new run seed.** `reset(runSeed)` must re-place the layer from the new seed, while the same `?seed=` reproduces the same layout exactly. (H3 pure, H6 live)
5. **Frame cost with every cap saturated.** All stacks and drift in view at once, stationary fish, measured against the 1.5–1.8 fps rig floor. (H9)

## Ledger

- [x] **H1** docs commit: this plan.
- [x] **H2** H1-stage RED: `tests/unit/farfield.test.js` — determinism, own-stream, the 240 m floor, caps, scale bounds, lane exclusion, z-separation. Watched fail: the module does not exist.
- [x] **H3** H1-stage GREEN: `js/farfield.js` + the `ATMOSPHERE.horizon` block populated (names disposed per spec §4.5).
- [x] **H4** H2-stage: fog retune — mid-field pin added to `atmosphere.test.js` (RED), then `near`/`far` (GREEN) + frozen-vantage A/B screenshots.
- [x] **H5** H3-stage RED: `tests/browser/t23-horizon.mjs` stacks section; watched fail (no horizon group in the scene).
- [x] **H6** H3-stage GREEN: `js/horizon.js` (lazy rock load, recycler, wave-riding, wet band) + `main.js` wiring + `debugHorizon`/`debugVisibility`. Review Focus 1, 2, 3, 4's tests land here.
- [x] **H7** H4-stage: mid-ground drift (foam slabs) + the water shader's mid-distance foam lines.
- [x] **H8** H5-stage: haze band + one home for its numbers (`ATMOSPHERE.sky.cloudBand`/`hazeBand`, read by `sky-dome.js`).
- [ ] **H9** H6-stage closure — **STOPPED part-way.** Done: the cost measurement (both caps kept, the layer's cost is below the rig's 0.64 fps resolution), the full unit suite (**127/127**), the full browser gate, and the diagnosis + fix of one `t19` driver defect. NOT done: the gate reads **18/19** (see below), the fresh-context branch review, the closure commit, HANDOFF §3/§5/§6, and the zip (never owed by default).

## Status at stop (2026-10-21)

**Shipped and verified:** H1–H8, six commits (`1379556` farfield+config, `14a5300` fog retune, `5b69852` stacks+wiring, `e0cddf2` drift+whitecaps, `e376aca` haze band, `5b3714f` the t19 driver fix). Unit **127/127**. Every browser file green — t21 (layout + formations), t22 (5/5), the new t23 (2/2) — **except** `t19`.

**The one open item: `t19-fairness` fails, and it fails in a different driver each run.**

1. **Driver defect 1 — the side pass — found, fixed, verified.** It parked the fish `radius + 1.45` from ONE hull without checking the others, so a small hull beside a liner aimed the fish *inside* the liner. Measured from a real failure: `target x -13.15 rx 0.84 gap 0.35` (exactly as asked) while a liner at `x -9.28 rx 2.09` had the fish **1.61 m inside it**. The driver now requires its parking spot to be clear of *every* hull it will swim past, retries up to four layouts otherwise, asserts `noLane` explicitly, and reports geometry on failure. **`t19` passed 5 consecutive runs after it**, against roughly half failing before.
2. **Driver defect 2 — the high-tier steering pass — diagnosed, deliberately NOT fixed.** Its own snitch: the fish's path jumps `x -5.52 → -0.08 → 2.646` (a 5.4 m lateral step in one tick) and it is hit by the liner at `x 0.68 rx 2.09`, **1.2 m inside**. The driver aims *straight* at the committed gap centre, and its per-tick cap at the high tier is `70 u/s × 0.08 s = 5.6 m` — wider than a liner — so a legitimate lateral move steps *through* an intervening hull. A real fish at that cap would be hit too.

**Driver defect 2 is an open question with two readings, and they are different tasks:**

- **(a) The driver should route like a player** (clear the blocking hull before committing). The unit corpus (`worldgen-fairness.test.js` — 120 seeds × difficulty × speed, 0 chain violations) supports this, so the game is fine and the fix is a test rebuild.
- **(b) The rows really can offer a gap reachable in *time* at the steering cap but only by crossing another hull's body.** That would be a genuine §4-row-1 fairness gap which the corpus's *corridor* model does not model.

**The order matters and is why it was stopped rather than guessing:** fixing the test first could *hide* (b). Check the game, then fix the test. Evidence in full in `.superpowers/sdd/2026-10-21-horizon-depth/progress.md`.

---

## Task detail — H2/H3: pure farfield + the horizon config block

**Files:** Create `js/farfield.js`, `tests/unit/farfield.test.js`; Modify `js/config.js`.

**Interfaces produced** (later tasks consume these exact names):

- `export const FAR_SLOT = 90` — asserted by H2 to be outside worldgen's 1–5.
- `stackSlots(runSeed, { zFrom, zTo, ordinal = 0 }) -> Slot[]`
- `driftSlots(runSeed, { zFrom, zTo, ordinal = 0 }) -> Slot[]`
- `Slot = { x, z, variant, scale, yaw }` — `variant` is an index into the configured rock roster, `scale` a multiplier, `yaw` radians.
- `hazeAt(distance) -> number` in [0, 1] — wraps `atmosphere.fogFactorAt`, so the layer's haze and the world's haze are one number.
- Same `(runSeed, ordinal)` → identical output; a different `ordinal` → a different window (that is how the recycler refreshes without re-rolling the whole stream).

**Edits:** `config.js:314`'s zeros become `ATMOSPHERE.horizon = { minDistance: 240, zBand: 600, count: 6, driftCount: 20, driftNear: 120, driftFar: 300, minScale: 0.6, maxScale: 1.8, driftScale: 0.25, minZSeparation: 60, rocks: ['basaltic-columns.fbx', 'column-rocks.fbx', 'extra-large-rocks.fbx', 'pile-rocks.fbx'] }`. Name disposition per spec §4.5: `spacing` → `minZSeparation`; `scaleRange` → explicit `minScale`/`maxScale`; `layers` and `hazeStrength` **retired** (the band is painted on the dome, and its strength lives in `ATMOSPHERE.sky` at H8).

**Tests (`tests/unit/farfield.test.js`):** `FAR_SLOT >= 90`; `stackSlots` is deterministic for a given `(seed, ordinal)` and differs across ordinals; **every** slot has `z - 0 >= minDistance` from the window's near edge and `|x| > WORLD.laneHalfWidth`; `slots.length === ATMOSPHERE.horizon.count`; consecutive slots differ in z by `>= minZSeparation`; `scale` inside `[minScale, maxScale]`; `variant` a valid roster index; `driftSlots` respects `driftNear`/`driftFar`; `hazeAt(0) === 0` and `hazeAt(10000) === 1`.

**Plus the draw-order guard the spec (§6) requires and behaviour cannot test:** a source scan asserting neither `js/farfield.js` nor `js/horizon.js` imports a chunk builder from `worldgen.js` (`composeChunk`, `generateChunk`, `rowClusters`, or any `worldgen` import at all). §4.7's rule — this layer must never enter worldgen's draw order — is invisible to any behavioural test, so it is pinned at the source, the same way `wave-port.test.js` pins the shader mirror.

**Deliberate deviation from the spec's named interface:** §4.1 names `createFarStream(runSeed)` returning a stream. This plan instead passes `(runSeed, ordinal)` into each slot builder. Reason: a returned stream object is stateful, and a stateful stream cannot be re-entered mid-recycle without guessing how many draws earlier calls consumed — which is exactly the coupling the RNG discipline exists to avoid. The `ordinal` argument makes the refresh explicit and keeps every call a pure function of its arguments. If an executor finds `createFarStream` referenced elsewhere, this is why it does not exist.

**Commit:** `feat: pure farfield placement for the horizon layer + ATMOSPHERE.horizon config (suite: X/X unit)`

## Task detail — H4: the fog retune

**Audited problem (spec §1 fault 2):** the sea lifts with distance (`water.js:209-211`) while the props are fogged on `ATMOSPHERE.fog` alone, which is **2.0% at 150 m** — so a hull at normal range is effectively unfogged while the water beneath it has lifted.

**RED first — pin the purpose, not the number:** add to `tests/unit/atmosphere.test.js` an assertion that the curve is **meaningful in the near-mid field**: `fogFactorAt(150) >= 0.05` and `fogFactorAt(400) >= 0.5`, plus the existing monotonicity. Today that fails at 150 m (0.0197). Then pick `near`/`far` in `ATMOSPHERE.fog` that satisfy both while leaving the horizon stitch intact — a candidate is `near 60 / far 620`; the test is the constraint, the numbers are the tuning.

**Then the look, which is what actually decides it:** frozen-vantage before/after screenshots via `.superpowers/sdd/2026-10-19-ocean-cohesion/probe-water-look.mjs` (pins `?seed=1337`, parks on a hull, pauses → bit-identical camera across runs). Show the user both stills. **This is the one stage that alters an already approved look**; it is isolated here so it can be reverted alone by two numbers.

**Verification:** `npm test` green (including `atmosphere.test.js` and every consumer of the curve); screenshots; console-clean.

**Commit:** `feat: retune the shared fog curve so haze ramps across the near-mid field (suite: X/X unit, Y/Y browser)`

## Task detail — H5/H6: the stack layer

**Files:** Create `js/horizon.js`; Create `tests/browser/t23-horizon.mjs`; Modify `js/main.js`.

**Interfaces produced:**

- `createHorizon(scene, runSeed) -> { group, ready, update(dt, fishZ, t), reset(runSeed), debugInfo(fishZ) }`
  - `group` — a `THREE.Group`; `main.js` toggles `group.visible` with the ocean.
  - `ready` — false until the rock templates resolve; until then only drift renders.
  - `debugInfo(fishZ) -> { ready, stacks, cap, drift, nearest, minZ, maxZ, rockFiles }` — reports the **configured** cap and floor so the browser test duplicates no literal.
- `__FFM_API.debugHorizon(z?)` — additive, inert in production (the `AGENTS.md` §3 hook family); defaults to the fish's z.
- `debugVisibility()` gains `horizon: group.visible` and `horizonInfo`.

**H5 (RED), in order:** write `tests/browser/t23-horizon.mjs` with the stacks section only, and watch it fail with the right reason (`debugHorizon is not a function`). Sections: (a) live stacks `=== cap`; (b) **every** live stack's z is beyond `minZ` from the fish; (c) `debugObstaclesNear()` contains **none** of them (compare against the discs' `x`/`z`, the non-collidable proof); (d) a stack's rendered y changes across frames as the field moves (wave-riding, not a flat plane); (e) console-clean.

**H6 (GREEN):**
- Lazy load: `new FBXLoader().loadAsync('assets/models/rocks/' + file)` for each configured rock, normalised by its bounding box; `try/catch` per file → a failure removes that variant and, if all fail, leaves `ready = false` with drift still rendering (Review Focus 1).
- Pool + recycler: one clone per slot; `update` wraps a slot whose `dz` falls outside the band by calling `stackSlots(runSeed, { …, ordinal: ++lap })` for the slot's replacement, so the refresh is deterministic and fresh (Review Focus 2 — assert the new z is beyond the floor and the x outside the lane).
- Wave-riding: `mesh.position.y = surfaceHeight(x, z, t)` (`wave.js`) so the stack intersects the swell; the same `t` the water uses.
- Wet band: `applyWetMaterials(clone)` at build, then `setWetWaterline(handles, surfaceHeight(x, z, t))` per frame (`wet-props.js:76,97`). **No `nearHulls` registration** (engineering decision 2).
- Wiring in `main.js`: build beside `skyWorld` (`main.js:185`), `group.visible = true` at build, `bus.on('run:start', () => horizon.reset(game.state.runSeed ?? 0))` mirroring `:187`, `updateEnvironment` sets `horizon.group.visible = !above` beside `:264`, a per-frame `horizon.update(dt, p.z, game.state.runTime)` beside `:311`, and `if (!group.visible) return;` inside `update` mirroring `sky-world.js:73` (Review Focus 3).
- `reset(runSeed)` re-places every slot from the new seed (Review Focus 4).

**Verification:** t23 green; screenshots at the frozen vantage (the stacks must read as *in* the water); console-clean; the corpus tests unchanged.

**Commit:** `feat: distant rock stacks in the swell + the horizon layer's pool and wiring (suite: X/X unit, Y/Y browser)`

## Task detail — H7: mid-ground drift and the water's foam lines

**Files:** Modify `js/horizon.js`, `js/water.js`, `js/config.js`; Modify `tests/browser/t23-horizon.mjs`.

Two parts, split by the spec's "math, not geometry" rule (§4.2):
- **Geometry** (the only new draws): the `driftCount` fragments from `driftSlots`, rock pieces scaled by `driftScale` plus flat foam slabs reusing `clouds.js`'s `slabTexture()`; wave-riding, no hitbox, same recycler.
- **Shader foam lines** (no draws): a sparse long-crest foam family added to `water.js`'s existing `fine` streak block, band-limited by the same `fwidth()` fade already there. This is a **look** change: it verifies by screenshot, not by a unit test (`AGENTS.md` §10), and it must not disturb `wave-port.test.js`'s coefficient guards.

**Test:** extend t23 with a drift section — live drift count equals the configured count, `debugObstaclesNear()` still contains none of them; plus the screenshot pair for the foam lines.

**Commit:** `feat: mid-ground drift and mid-distance foam lines (suite: X/X unit, Y/Y browser)`

## Task detail — H8: the haze band and one home for its numbers

**Audited problem:** the band already exists (`sky-dome.js:66-68`: `mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.12, elev)) * 0.55)`), but its constants and the cloud band's `0.80` (`sky-dome.js:64`) are hardcoded in the shader — and `config.js:283`'s `sky` block holds only `zenith`/`horizon`, though the parent spec's §4.1 named `cloudBand`.

**RED first:** a unit guard in the house `shader-parity.test.js` style — `ATMOSPHERE.sky` must expose `cloudBand` and `hazeBand` as numeric keys in `(0, 1]`, and `sky-dome.js` must read them (source scan) rather than contain the literals. Fails today: the keys do not exist.

**GREEN:** add `sky.cloudBand = { strength: 0.80, low: 0.05, high: 0.18, fallLow: 0.40, fallHigh: 0.78 }` and `sky.hazeBand = { strength: 0.55, elevation: 0.12 }`; wire both through the dome's uniforms; tune the band by screenshot (the ledger records it as reading very subtle).

**Commit:** `feat: the horizon haze band's numbers get one home in ATMOSPHERE.sky (suite: X/X unit, Y/Y browser)`

## Task detail — H9: closure

Measure fps before/after on this rig, same conditions, **single workload** with every cap saturated (Review Focus 5). **Set the caps from that number**, and recalibrate any browser wait budget the added draw calls disturb (`AGENTS.md` §5.5). Then the full unit suite, then the full browser gate on `FFM_PORT` beside the dev server, then: feature commit, HANDOFF §3/§5/§6 updates, SDD ledger closure. A fresh-context review pass on the branch before the closure commit (`AGENTS.md` §7.3) — and that reviewer is asked the spec's §9 risk 5 explicitly: **does the layer still read as stylized-crafted, or has it drifted toward a fidelity class the parent spec's §2 does not approve?**

**Commit:** `feat: horizon depth — measured caps and closure (suite: X/X unit, Y/Y browser)`

---

## Out of scope

- Collidable content of any kind; coins and scoring; worldgen draw order and layout; §4 invariants; QTE; speed values; obstacle shapes.
- The flight/sky world (`sky-world.js` untouched; Phase 4 owns it) and `models.js`/`loadModels`' boot path.
- New assets, new dependencies, `FogExp2` or any change to the fog curve's **shape**.
- The dome's sun-disc constants (`sky-dome.js:55-56`) — outside this document.
- HUD.
- Zip regeneration (the user asks; the tracked zip is intentionally stale).

## Deferred findings (ledger at execution)

- `sky-world.js` uses `Math.random()` at four sites (`:36,44,57,59`), so its layout is unreproducible run-to-run. Not this plan's business (flight world, Phase 4), but it is the reason engineering decision 1 exists, and Phase 4 should adopt `farfield`'s shape.
- `HANDOFF.md` §1/§9.1 states the rock pack as **13 FBX** where §3 says **12**; measured 12 on 2026-10-21. Correct at closure, not mid-flight.
- The rock FBX reference `texture-palette.png` by relative path; whether `FBXLoader` resolves it outside `models.js` is unverified until H6's first screenshot. If it does not, the fallback is to bind the palette explicitly in `horizon.js` — record which path was taken.
