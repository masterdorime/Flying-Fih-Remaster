# Ocean Cohesion & Crafted Water — Implementation Plan (T1–T14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-10-19
**Spec:** `docs/superpowers/specs/2026-10-18-ocean-cohesion-design.md` — stages S1–S6. The spec travels with this plan; executors read both.
**Method:** TDD, audit-first; native in-session execution
**Status:** awaiting user review

## Goal

Make the swimming-phase ocean read as one atmosphere: crafted water that responds to the sun, a sky whose horizon colour is the sea's fog colour, and props that sit *in* the water instead of on a flat plane.

## Architecture

A new pure `js/atmosphere.js` becomes the single owner of the air (sun, sky gradient, fog curve, horizon colour); `config.js` gains an `ATMOSPHERE` block so every number has one home. The water shader, a new sky dome, the scene fog, the gate and the wake all read from it. Props gain visual wave-riding and contact decals. A vendored post-FX pass, gated behind the existing `settings.postFx`, adds the grade and bloom.

## Two engineering decisions this plan fixes (read before T6/T10)

1. **The wave field becomes data, not prose.** `AGENTS.md` §7.2 names "no duplicated rules between pure modules and views" as hygiene — the wave field currently *is* such a duplication (`wave.js:9-13` vs `water.js:29-31`), guarded only by a hand-copied reference function in `tests/unit/wave.test.js:9-13`. This plan makes `wave.js` export `WAVE_TERMS` (the one data source) and adds a **port-sync test that reads `js/water.js` source text** and asserts the shader's coefficients match. That is §6's "port-sync test" in the spec, and it is what makes the amplitude change safe.
2. **Wave-riding is visual-only.** `world.js:81` gates collision on `mesh.position.y`. Moving props vertically would therefore change hit detection — a §4-row-6 collision change this phase is not allowed to make. Props ride the wave **visually** while collision, `debugTeleport` (`world.js:125`) and `debugChunksValid` keep reading the canonical spec values. `obstaclesNear` reports x/z only (`world.js:133-148`), so live-read tests are unaffected.

## Global constraints (stand)

- Water plane stays `PlaneGeometry(700, 1800, 90, 220)` (`water.js:7`) — no geometry growth, ever, for this phase.
- Wave amplitude lands in the contracted **1.2–1.6 m** band; `water.js` vertex math and `wave.js` remain one source, guarded by the port-sync test.
- Wave amplitude and every offset that rides it move **in one commit**: `GATE.swimLift` (`config.js:28`), coin skim (`coins.js:31`), wake lifts (`wake.js:130`, `wake.js:158`), `WATER.draftFraction` (`player.js:136`) re-checked.
- One fog curve, one tone map, one sun — every layer.
- The horizon layer draws from its **own** RNG stream; worldgen draw order and the corpus pins are untouched (`AGENTS.md` §3).
- Post-FX sits behind `settings.postFx` (`settings.js:8`, default 0.7, range [0,1]); with it at 0 the path is the direct renderer and the look is today's.
- Untouched: §4 invariants, QTE loop/timing/scoring/`applyResult`, speed values, worldgen layout, obstacle shapes, HUD, flight/sky world (Phase 4), music-silence debugging.
- No new dependencies beyond the vendored in-version Three addons (`AGENTS.md` §11 — same r170, addon addition, not a bump).
- Pages are served while browser suites run — **no `js/` edits during a run**; clear port 8123 listeners first (`AGENTS.md` §5.6).
- `waitForFunction(fn, null, options)` — the predicate's `null` goes in the **arg** slot, never options (`AGENTS.md` §5.4).
- No layout pins exist; browser assertions stay live-read, and every t-file ends console-clean.
- Commit style `feat:|fix:|docs: <summary> (suite: X/X unit, Y/Y browser)`; counters are only what was actually read; zip rides feature commits; HANDOFF updated in place at closure.

## Review Focus

Inputs and failure modes the spec implies but no task's happy path exercises. Each gets its test in the owning task.

1. **Post-FX at 0.** `settings.postFx = 0` must render the direct path with tone-map parity — never a black frame and never an untone-mapped scene. (T13)
2. **Duplicate fog setter.** `main.js:38` and `water.js:135` both set `scene.fog`; a later `createSky` call can silently win. After boot there must be exactly one owner and `scene.fog` must equal the `ATMOSPHERE` values. (T4)
3. **Model load failure.** `models.js:58-61` substitutes a fallback box on GLB/FBX failure; wave-riding and contact decals must not crash or orphan a decal against a fallback template. (T10, T11)
4. **Composer/addon failure, or a lost WebGL context.** Must fall back to the direct render path (spec §7), never a thrown error killing the loop. (T13)
5. **Horizon pool at depth.** At d ≥ 1.0 and 110 u/s the scenery pool must recycle without leaking meshes and must never appear in `debugObstaclesNear` discs. (T12)

## Ledger

- [ ] **T1** docs commit: this plan.
- [ ] **T2** S1 RED: `tests/unit/atmosphere.test.js` — `sunVector` normalisation, `skyColorAt` endpoints + monotonicity, `fogColorAt` factor endpoints, `horizonColor` stability, `ATMOSPHERE` presence.
- [ ] **T3** S1 GREEN: `config.js` `ATMOSPHERE` block + pure `js/atmosphere.js`; move the `water.js:12-15` and `wake.js:14` literals into config (closes the §3 deviation).
- [ ] **T4** S1 GREEN: single fog owner — dedupe `main.js:38` / `water.js:135`, drive `scene.fog` from `ATMOSPHERE`, feed the water shader's fog uniform. Review Focus 2's test lands here.
- [ ] **T5** S1 GREEN: tone-map parity — custom shaders apply the same transform as props; mechanism confirmed against vendored r170; browser screenshot + console-clean.
- [ ] **T6** S2 RED: `wave.js` exports `WAVE_TERMS`; `tests/unit/wave.test.js` fixtures + envelope raised to the contracted band; new `tests/unit/wave-port.test.js` reads `js/water.js` text and asserts coefficient parity.
- [ ] **T7** S2 GREEN: `wave.js` field + `water.js` vertex chop octave + fragment rebuild (shared fog, sun specular, wider value range, crest foam).
- [ ] **T8** S2 GREEN: dependent offsets in the same commit (`GATE.swimLift`, coin skim, wake lifts, draft) + unit invariants; full unit suite.
- [ ] **T9** S3: new `js/sky-dome.js`; replace the ocean equirect; horizon stitch asserted against `horizonColor()`; flight `spaceBg` untouched.
- [ ] **T10** S4: prop wave-riding — visual y only, collision and debug reads keep canonical values; budgeted to `ATMOSPHERE.props.sampleRange`. Review Focus 3's fallback test lands here.
- [ ] **T11** S4: contact decals + gate/wake fog participation (`gate-view.js:13-15`, `wake.js:37,52`).
- [ ] **T12** S5: `js/horizon.js` — far silhouettes from the 12 rock FBX, haze bands, lane framing, own stream. Review Focus 5's pool test lands here.
- [ ] **T13** S6: vendor the composer addons; wire behind `settings.postFx` with half-res bloom. Review Focus 1 and 4's tests land here.
- [ ] **T14** S6 closure: before/after fps on this rig (single workload), browser-budget recalibration, full suites, feat commit + zip, closure docs commit, HANDOFF §3/§5/§6.

---

## Task detail — T2/T3: atmosphere core

**Files:** Create `js/atmosphere.js`, `tests/unit/atmosphere.test.js`; Modify `js/config.js`.

**Interfaces produced** (later tasks consume these exact names):

- `sunVector() -> {x, y, z}` — normalised, from `ATMOSPHERE.sun.dir`
- `skyColorAt(elevation) -> {r, g, b}` — `elevation` in [-1, 1]; returns `ATMOSPHERE.sky.horizon` at 0 and `ATMOSPHERE.sky.zenith` at 1
- `fogColorAt(distance, camPos) -> {r, g, b}` — the single fade curve; equals the fog colour at/after `far`
- `horizonColor() -> {r, g, b}` — the seam colour the sky dome paints and the water fades to

**Edits:**
- `config.js`: add `ATMOSPHERE` — `sun { dir, color, intensity }`, `sky { zenith, horizon, sunGlow, cloudBand }`, `fog { color, near, far }`, `water { deep, ocean, aqua, foam, amplitude, chop, crestFoam, specular }`, `contact { radius, opacity }`, `horizon { layers, scaleRange, hazeStrength, spacing }`, `props { sampleRange }`. Existing members seed the values so an unpopulated block is behaviour-preserving: `fog.color 0xcfe8f5` / `near 120` / `far 480` from `main.js:38`; `water.deep/ocean/aqua/foam` from `water.js:12-15`; the sun from `main.js:65-66`; the wake's `FADE 0x0a3f7a` from `wake.js:14`.
- `js/atmosphere.js`: pure module, no THREE import. Colour helpers return plain `{r,g,b}` in 0–1 so the module stays THREE-free and unit-testable; call sites wrap in `THREE.Color`.

**Tests (`tests/unit/atmosphere.test.js`):** `sunVector` is unit length within 1e-9; `skyColorAt(0)` equals horizon and `skyColorAt(1)` equals zenith; luminance of `skyColorAt` is non-decreasing over 20 samples; `fogColorAt` leaves the base colour at `near` and has reached the fog colour by `far`, monotone between; `horizonColor()` returns a stable value across 100 calls; `ATMOSPHERE` exists with every key the module reads.

**Commit:** `feat: shared atmosphere core — config ATMOSPHERE + pure js/atmosphere.js (sun/sky/fog/horizon single source), water+wake colour literals moved home … (suite: X/X unit, Y/Y browser)`

## Task detail — T4: one fog owner

**Audited problem:** fog is set twice at boot — `main.js:38` and inside `createSky` at `water.js:135` — with identical literals today, so whichever runs last wins silently. Review Focus 2.

**Edits:** delete the `water.js:135` assignment; `main.js:38` builds `scene.fog` from `ATMOSPHERE.fog`. **Interfaces produced:** `debugFog()` on `__FFM_API` (`js/main.js`, additive, inert in production — the `AGENTS.md` §3 hook family) returning `{ color, near, far }` read from the live `scene.fog`. The water shader later consumes the same values (T7).

**Test:** browser assertion that `scene.fog.color/near/far` equal `ATMOSPHERE.fog` after boot and after an environment swap; console-clean. Add to the existing scene t-file rather than a new suite.

## Task detail — T5: tone-map parity

**Problem:** `main.js:30-33` states custom shaders skip the tonemap chunk while props are tone-mapped — the "two physics for light" root cause 4 in the spec.

**Mechanism (verify, do not assume):** confirm against the **vendored** `vendor/three/three.module.min.js` how `ShaderMaterial` receives `TONE_MAPPING` and `toneMappingExposure`, then use three's own tonemapping chunks in the custom shaders rather than hand-rolling the Neutral curve. If r170's plumbing does not support it for `ShaderMaterial`, the fallback is a hand-written Neutral curve in the shader — record which path was taken in the plan's SDD ledger (`AGENTS.md` §7.4).

**Verification:** browser screenshot at a fixed `?seed=` + console-clean; a spot probe comparing a water pixel against a prop pixel under the same key light at the horizon.

## Task detail — T6/T7: water rebuild

**Files:** Modify `js/wave.js`, `js/water.js`, `tests/unit/wave.test.js`; Create `tests/unit/wave-port.test.js`.

**T6 (RED), in order:**
1. `wave.js` exports `WAVE_TERMS` — the uniform term shape `{kx, kz, w, a}` with `sin(kx*x + kz*z + w*t) * a`. The three existing terms become entries (term 3's negative omega folded in); `waveOffset` and `waveSlopes` derive from the array. `waveSlopes` stays the analytic derivative, now summed over terms.
2. `tests/unit/wave.test.js` keeps its independent closed-form fixtures (they must not derive from `WAVE_TERMS`, or they prove nothing) updated to the new field, and the envelope test's bound (`wave.test.js:33`) raised to the contracted band.
3. `tests/unit/wave-port.test.js` (new): read `js/water.js` as text, extract the vertex-shader wave expression, and assert every `WAVE_TERMS` coefficient appears with the right magnitude. This is the watch that carries the RED — it fails the moment the shader and `wave.js` disagree, which is exactly the drift the spec's §6 asks to prevent.

**T7 (GREEN):**
- `water.js` vertex: add the second, shorter-wavelength chop octave **at the same segment count**; all terms mirrored from `WAVE_TERMS`.
- `water.js` fragment: fog from `atmosphere.fogColorAt` (retiring the `smoothstep(240.0, 700.0, …)` fade at `water.js:94`); a sun specular term built on the analytic slope; a wider deep→ocean→aqua value range; foam retuned as crest caps while keeping the fish contact/churn foam (`water.js:76-91`).
- Amplitude lands inside 1.2–1.6 m.

**Verification:** `npm test` green including the port-sync test; browser screenshot at a fixed `?seed=` for the look; console-clean.

## Task detail — T8: dependent offsets (one commit, no exceptions)

Amplitude moves fish ride height, gate lift, coin skim and the wake's surface lifts. `GATE.swimLift 0.8` (`config.js:28`) is smaller than the new peak amplitude, so gates would dip into crests — the sweep is mandatory, not optional.

**Edits:** `GATE.swimLift` raised for the new band; coin skim (`coins.js:31`); wake ribbon/ripple lifts (`wake.js:130`, `wake.js:158`); `WATER.draftFraction` (`player.js:136`) re-checked against trough occlusion.

**Tests:** unit invariant `GATE.swimLift ≥ contracted amplitude peak + margin`; `tests/unit/wave.test.js` envelope; full unit suite. Browser: an existing gate t-file confirms swim gates still sit above the surface.

**Commit (T7+T8 together):** `feat: crafted water — wave field as data (WAVE_TERMS) + port-sync guard, second chop octave, sun specular, widest value range, crest foam, shared fog, tone-map parity; dependent offsets swept (suite: X/X unit, Y/Y browser)`; zip rides.

## Task detail — T9: sky dome

**Files:** Create `js/sky-dome.js`; Modify `js/main.js`, `js/water.js`.

`createFallbackDome` (`water.js:142-167`) is the precedent — this is a promoted, crafted version of it: gradient from `atmosphere.skyColorAt`, a sun disc/glow on `atmosphere.sunVector()`, a stylized cloud band, and a haze layer painted in `atmosphere.horizonColor()`, which **is** the water's far colour (the stitch, by construction). Ocean only — the flight `spaceBg` swap (`main.js:169`) is untouched.

**Test:** browser — sea and sky sample agree at the horizon within a small tolerance; `debugEnvironment()` still reports `ocean`; flight swap still works; screenshot; console-clean.

## Task detail — T10/T11: prop cohesion

**T10 — wave-riding (visual only).** In `world.js:update`, set `mesh.position.y = spec.y + waveOffset(mesh.position.x, mesh.position.z, elapsed)` for ocean props within `ATMOSPHERE.props.sampleRange` of the camera (`elapsed` already exists at `world.js:20`). **Collision reads the canonical spec `y`, not `mesh.position.y`** (see the second engineering decision above) — the `world.js:81` dy gate must be re-pointed at `spec.y` as part of this task, and `debugTeleport` (`world.js:125`) must keep placing at the spec y. Test: browser live-read that a prop's rendered y tracks `surfaceHeight` while its collision y does not drift; plus a unit assertion that the dy gate is computed from the spec, not the mesh.

**T11 — decals + fog participation.** One pooled dark radial sprite per nearby prop, lying on the water, sized from `ATMOSPHERE.contact`; recycled with the chunk pool; must no-op cleanly for `models.js` fallback templates (Review Focus 3). Drop `fog: false` at `gate-view.js:13-15` and `wake.js:37,52` so the objective and wake share the air. Also settle the frame discrepancy flagged in spec §1 — confirm the live gate's appearance matches `gate-view.js:13-19` and record the finding.

**Test:** browser screenshot; console-clean; decal count bounded by the props in range (no orphan growth over a long run).

## Task detail — T12: horizon layer

**Files:** Create `js/horizon.js`; Modify `js/main.js`, `js/models.js`.

Pooled far silhouettes built from the 12 rock FBX in `assets/models/rocks/` (measured 2026-10-18), placed 300–700 m out, non-collidable, plus haze bands and periodic lane framing.

**RNG safety (load-bearing):** its own stream, seeded from the run seed with a **new, unused slot** — it must never enter `worldgen`'s draw order, or obstacle layouts change and the corpus pins break (`AGENTS.md` §3). Assert the existing corpus tests still pass unchanged.

**Test:** Review Focus 5 — browser at d ≥ 1.0 / 110 u/s: pool recycles with a bounded mesh count over a long run; the scenery never appears in `debugObstaclesNear` discs; `debugChunksValid` unaffected; console-clean.

## Task detail — T13: post-FX

**Files:** Vendor into `vendor/three/addons/postprocessing/` (+ `shaders/` as required): `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass` and their pass/shader dependencies, from the **matching r170 examples** — same version already vendored, so an addon addition, not a bump (`AGENTS.md` §11). Modify `js/main.js`.

`main.js:250` switches to `composer.render` when enabled; bloom at **half resolution**; the whole layer gated on `settings.postFx > 0` (`settings.js:8`). When the composer owns tone mapping, the renderer's own tone mapping is stood down so nothing is double-transformed.

**Tests:** Review Focus 1 — `postFx = 0` renders the direct path, tone-mapped, not black; `postFx > 0` renders the composer path. Review Focus 4 — a forced composer-construction failure falls back to `renderer.render` with a console warning, not a thrown error. Both states console-clean.

## Task detail — T14: closure

Measure fps before/after on this rig, same conditions, **single workload** (`AGENTS.md` §5.3, §10). Recalibrate any browser wait budgets the real numbers move; the fps number decides whether half-res bloom stays. Run the full unit suite, then the full browser gate with nothing else running. Feature commit + zip + closure docs commit + HANDOFF §3/§5/§6.

**Commit:** `feat: gated post-FX (half-res bloom + grade behind settings.postFx) + measured perf (suite: X/X unit, Y/Y browser)`

---

## Out of scope

- HUD restyle; the flight/sky world and HANDOFF §9.2's sky requirements (Phase 4 reuses this atmosphere module).
- Any gameplay number, §4 invariant, QTE rule, worldgen draw order, or obstacle shape.
- New asset purchases or authored models — the rock FBX reuse is a re-activation of files already shipped.
- Generating the GLSL wave expression from `WAVE_TERMS` (Option A during planning). Deferred: the port-sync test satisfies the spec's §6 contract; literal generation was rejected as a readability/compile-risk trade in T6/T7 and can be revisited if drift ever recurs.
- Music-silence debugging — still blocked pending the user's `debugMusicTest()` run (HANDOFF §8).

## Deferred findings (ledger them at execution)

- `HANDOFF.md` states the rock pack as **13 FBX** in §1/§9.1 but **12** in §3; measured 12. Correct at closure, not mid-flight.
