# Ocean Cohesion & Crafted Water — Design

**Date:** 2026-10-18 · **Status:** approved (register, scope, sky treatment and
approach approved in-session; stages execute TDD)
**Supersedes:** nothing; adds the first visual-atmosphere spec to the program.
**Scope:** the swimming-phase environment — water, sky, atmosphere, prop
integration, and a new horizon layer. HUD untouched. The flight/sky world
(HANDOFF §9.2 sky requirements, Phase 4) is untouched; this spec builds the
atmosphere module Phase 4 will later reuse.

## 1. Problem (audited in code, 2026-10-18)

Evidence: a live swim-phase frame supplied by the user — dated to the current
build by `SWIMMING` (`hud.js:99`) at `25 u/s` (`config.js:150`, tier `none`),
with the red gauge tick at `maxThreshold 100/120 ≈ 83%` (`hud.js:18`) — plus the
code read below. `Ocean Flight Race.png` was supplied as a **proportional
reference only**; the approved register is stylized-crafted, not that image's
fidelity class (§2).

One discrepancy is flagged for S4 rather than explained away: in that frame the
gate reads as a thin, low-contrast outline, while `gate-view.js:13-19` specifies
a bright cyan torus at 0.9 opacity with a highlight ring and a faint disc.
Either the capture predates that view or something suppresses it — S4's gate
work (fog participation, §4.6) confirms which, and does not assume the frame is
wrong.

**Four root causes of "props look dropped in, not in the water":**

1. **Props sit on a flat plane, not on the sea.** `models.js:77-81` normalises
   every prop onto `y=0`. The wave field moves ±0.93 m (`water.js:29-31`, ported
   in `wave.js:9-13`), and only the fish (`player.js:136`), gates
   (`timing.js:154`, `gate-view.js:43`), coins (`coins.js:64`) and wake
   (`wake.js:130`, `wake.js:158`) sample it. Hulls therefore intersect crests and
   hover over troughs.
2. **No contact shadows anywhere.** `models.js:85` sets
   `o.castShadow = false; o.receiveShadow = false; // perf: shadows off`, and the
   renderer never enables a shadow map (`main.js:26`). Nothing is anchored to the
   surface it floats on.
3. **Five different depth fades.** Props fade on `Fog(0xcfe8f5, 120, 480)`
   (`main.js:38`, duplicated at `water.js:135`); the water shader ignores fog
   entirely and fades by its own `1.0 - smoothstep(240.0, 700.0, |Δz|)`
   (`water.js:94`); the sky is an unfogged equirect background texture
   (`water.js:128-136`); the gate sets `fog: false` (`gate-view.js:13-15`); the
   wake sets `fog: false` on both the ribbon and the ripples
   (`wake.js:37`, `wake.js:52`). Five layers, five dissolve distances.
4. **Two lighting models that cannot agree.** `main.js:30-33` states it
   explicitly: the custom water/sky shaders "don't include the tonemap chunk",
   while props are tone-mapped by `NeutralToneMapping` (`main.js:33`) and lit by
   the hemisphere + three-directional rig (`main.js:64-74`). Same scene,
   different physics for light.

**Why the water reads flat:**

- Amplitude ≈0.93 m total across ~70 m wavelengths on a 90×220 segment plane
  (`water.js:7`) — roughly 7.8 m cells, so the surface is geometrically gentle by
  construction.
- A three-colour palette (`water.js:12-15`) quantised into five bands
  (`water.js:49-51`) with **no light input and no specular term at all** — the
  fragment shader cannot respond to the sun that is lighting everything else.
- Fog washes everything past 120 m to one pale value, and the horizon is simply
  where that washed water meets an unfogged sky.

**Configuration-home deviation:** the water palette literals (`water.js:12-15`)
and the wake's `FADE` (`wake.js:14`) live outside `config.js`, against the
`AGENTS.md` §3 rule that every number has one home. This spec moves them.

## 2. Approved look register

**Stylized-crafted** (user, in-session). Keep the cartoony low-poly identity and
make it deliberate: chunkier readable wave shapes, strong light/dark value
contrast, sun glitter, foam that reads, and props that sit *in* the water with
contact shading and one shared haze.

Two consequences that bind every stage below:

- **Buy the look with math, not geometry.** No increase in water plane segments;
  the rig is software-GL and the browser suite's budgets are calibrated to it
  (`AGENTS.md` §5.3, §5.5).
- **No fidelity-class change.** Props are the existing Kenney/hull assets; they
  are re-lit, re-grounded and re-hazed, never re-modelled.

## 3. Contract

| Quantity | Contract |
|---|---|
| Water plane | unchanged `PlaneGeometry(700, 1800, 90, 220)` (`water.js:7`) — no geometry growth |
| Wave field | single source of truth; the `water.js` vertex math and `wave.js` remain an **exact port** (`wave.js:1-3`) locked by `tests/unit/wave.test.js` |
| Wave amplitude | raised from ±0.93 m to a tuned target in the **1.2–1.6 m** band; the final value is a stage-tuning decision, the band is the contract |
| Dependent offsets | wave amplitude and every offset that rides it move **together and in one commit**: `GATE.swimLift` (`config.js:28`), the coin skim offset (`coins.js:31`), the wake ribbon/ripple lifts (`wake.js:130`, `wake.js:158`), and `WATER.draftFraction` (`player.js:136`) re-checked |
| Fog | **one** curve, from `config.ATMOSPHERE`, consumed by water, sky dome, props, gate and wake |
| Tone map | every layer tone-mapped identically; custom shaders stop skipping the transform |
| Sun | one direction, colour and intensity in `config.ATMOSPHERE`, shared by the key light, the water specular term and the sky-dome sun glow |
| Prop grounding | every ocean prop rides `surfaceHeight` and carries a contact decal (no shadow map) |
| Horizon layer | draws from its **own** RNG stream; worldgen's draw order and the corpus pins are untouched (`AGENTS.md` §3) |
| Post-FX | composer behind the existing `settings.postFx`; with it off the render path is today's, never black |
| Gameplay | no change to any §4 invariant, QTE rule, scoring value, speed value or worldgen layout |

## 4. Design

### 4.1 `config.js` — new `ATMOSPHERE` block

One home for the air: `sun { dir, color, intensity }`, `sky { zenith, horizon,
sunGlow, cloudBand }`, `fog { color, near, far }`, `water { deep, ocean, aqua,
foam, amplitude, chop, crestFoam, specular }`, `contact { radius, opacity }`,
`horizon { layers, scaleRange, hazeStrength, spacing }`, and
`props { sampleRange }` (the per-frame surface-sampling radius, §4.6). The literals at
`water.js:12-15` and `wake.js:14` move here (§1 deviation closed). Existing
members are used as the default values, so an unpopulated block is behaviour-
preserving.

### 4.2 `js/atmosphere.js` — new, pure

No THREE, unit-tested, mirroring the house pure/impure split (`AGENTS.md` §3).
Exports `sunVector()`, `skyColorAt(elevation)`, `fogColorAt(distance, camPos)`
and `horizonColor()`. `horizonColor()` is the seam: the sky dome paints it at the
horizon and the water fades to it, so the two meet by construction rather than by
tuning.

### 4.3 `js/water.js` — rebuilt shader

- **Vertex:** a second, shorter-wavelength chop octave added to the existing
  three terms at the **same segment count**. All four terms are ported to
  `wave.js` in the same commit.
- **Fragment:** fog driven by `atmosphere.fogColorAt`; a **sun specular term**
  built on the analytic surface slope (`wave.js:21-27` already provides
  `waveSlopes`, and the shader mirrors it); a genuinely wider deep→ocean→aqua
  value range; foam retuned to read as crest caps while keeping the existing
  fish contact/churn foam (`water.js:76-91`).
- **Tone-map parity:** the shader applies the same transform the props receive.
- The ad-hoc `smoothstep(240, 700)` distance fade (`water.js:94`) is retired in
  favour of the shared fog; the mesh keeps following the fish in x/z
  (`water.js:118-119`).

> Mechanism note, stated honestly: the in-shader tone-mapping route (reusing
> three's tonemapping chunks vs. hand-rolling the Neutral curve) is **not yet
> verified against the vendored r170 source**. Stage 1 confirms the plumbing
> against `vendor/three/` before the shader is finalised.

### 4.4 `js/wave.js` — locked in lockstep

Amplitude and the new chop term change here and in the shader together, per the
port contract at `wave.js:1-3`. `waveSlopes` gains the new term's derivative.
`tests/unit/wave.test.js` is updated to the new field, and the dependent offsets
in §3 are re-verified against it.

### 4.5 `js/sky-dome.js` — new

A crafted sky for the **ocean only**: gradient from `atmosphere.skyColorAt`, a
sun disc/glow placed on `atmosphere.sunVector()`, a stylized cloud band, and a
haze layer whose colour is `atmosphere.horizonColor()`. Precedent already exists
in `createFallbackDome` (`water.js:142-167`), so this extends existing machinery
rather than inventing a subsystem. The flight `spaceBg` swap (`main.js:169`) is
not touched.

### 4.6 Prop cohesion — `js/world.js`, `js/models.js`

- **Wave-riding:** ocean props sample `surfaceHeight(x, z, t)` so hulls sit on
  the swell. Sampling is budgeted to props within `ATMOSPHERE.props.sampleRange`
  (default 200 m) of the camera, because this is CPU work on a rig with no
  headroom; S4 measures the cost and the radius is the dial.
- **Contact decals:** one pooled dark radial sprite lying on the water beneath
  each prop, which is what actually reads as "sitting in" water. Deliberately
  **not** a shadow map: `models.js:85` disabled shadows for perf and real ones
  cost more than they return at this stylization.
- **Fog participation:** `gate-view.js:13-15` and `wake.js:37,52` drop
  `fog: false`, so the objective and the wake live in the same air as everything
  else.

### 4.7 `js/horizon.js` — new, the depth layer

Pooled far silhouettes built from the **12 rock FBX already on disk**
(`assets/models/rocks/`, measured 2026-10-18; unloaded since the 2026-10-17
rock→ship change — no new assets), placed at 300–700 m, non-collidable, plus haze
bands and periodic lane framing so the sea has a sense of travel and the horizon
stops being a bare line.

**RNG safety (non-obvious, load-bearing):** the layer uses its own stream and
never enters worldgen's draw order. `AGENTS.md` §3 is explicit that reordering
draws changes layouts, and the corpus tests pin those contracts, so the scenery
is additively seeded and cannot perturb obstacle composition.

### 4.8 Post-processing — vendored, behind an existing toggle

Vendor `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass` (and
their shader/pass dependencies) from the **matching r170 examples** into
`vendor/three/addons/` — the same version already vendored, so this is an addon
addition, not a version bump (`AGENTS.md` §11). `main.js:250` switches to
`composer.render`. Bloom runs at **half resolution**. The whole layer is gated
behind the existing `settings.postFx` (already wired at `main.js:246`), so
disabling it degrades prettiness and never cohesion — §4.3's parity holds on the
direct path too.

## 5. Staging

Feeds the implementation plan; each stage lands its own watched-RED tests.

1. **S1 — atmosphere core.** `ATMOSPHERE` config + pure `atmosphere.js` +
   unit tests + tone-map parity confirmed against r170 + rotation of the five
   fade sites onto one curve. Behaviour-preserving by default.
2. **S2 — water rebuild.** Shader, `wave.js` lockstep, amplitude into the
   contracted band, dependent offsets (`GATE.swimLift`, the coin skim offset,
   wake lifts, draft) moved in the same commit.
3. **S3 — sky dome.** New dome replaces the equirect for the ocean; horizon
   stitch verified against `horizonColor()`.
4. **S4 — prop cohesion.** Wave-riding + contact decals + gate/wake fog
   participation.
5. **S5 — horizon layer.** Far silhouettes, haze bands, lane framing, own
   stream.
6. **S6 — post-FX.** Vendored composer + half-res bloom behind `settings.postFx`;
   fps measurement and browser-budget recalibration.

## 6. Tests (watched-RED first)

**Unit:** `atmosphere.js` math (sun vector normalisation, sky gradient
monotonicity, fog curve endpoints, `horizonColor` stability); a **port-sync
test** asserting the shader's wave constants equal `wave.js`'s, so the exact-port
contract cannot silently drift; `ATMOSPHERE` presence and default fallbacks;
dependent-offset invariants (`GATE.swimLift` ≥ contracted amplitude margin).

**Browser:** screenshots for the look (visual changes verify by eye — §10);
console-clean on every file; live-reads that a prop's rendered `y` tracks
`surfaceHeight` and that the sea's far colour matches the dome's horizon colour;
composer on **and** off both render without error.

**Performance:** before/after fps on this rig, same conditions, single workload,
per §10 — the number decides whether half-res bloom stays.

## 7. Failure handling

Dome, horizon layer or composer failure falls back to the current direct render
path, following the existing `try/catch` precedent at `water.js:137` and
`main.js:58`. The worst case is today's look; never a black screen, and never a
thrown error that kills the run loop.

## 8. Non-goals / out of scope

- **HUD** — not touched in this phase (panel chrome, SVG shrimp glyph, speed
  dial and the segmented gauge remain a separate proposal).
- **Flight/sky world** — Phase 4 territory, including HANDOFF §9.2's sky
  requirements. This spec deliberately builds the atmosphere module Phase 4 will
  reuse, and nothing more.
- **Gameplay** — §4 invariants, QTE rules (`applyResult`, windows, chain),
  scoring, speed values, worldgen layout and RNG draw order, obstacle shapes.
- **Assets** — no new asset purchases or authored models; the rock FBX reuse is
  the only asset change and it is a re-activation of files already shipped.
- **Music-silence debugging** stays blocked pending the user's
  `debugMusicTest()` run (HANDOFF §8).

## 9. Risks

1. **Amplitude ripple.** Raising the wave field changes fish ride height, gate
   lift and coin skim. Mitigated by §3's lockstep rule and the S2 single-commit
   discipline; the port-sync test is the guard.
2. **Software-GL performance.** The composer and per-frame prop surface sampling
   both cost on a rig already at 1.5–1.8 fps. Mitigated by half-res bloom, the
   `settings.postFx` gate and a windowed prop-sampling budget; measured before
   and after rather than assumed.
3. **Browser-budget recalibration.** Timing-sensitive waits calibrated to the
   current fps floor may need re-measuring (§5.5). Expected work, budgeted as
   such, not a surprise.
4. **RNG contamination.** The horizon layer must not enter worldgen's draw
   order; mitigated by its own stream and asserted by the existing corpus pins
   continuing to pass.
5. **Reference drift.** The supplied reference image is a mood/proportion guide;
   if a stage starts converging on that fidelity class it has exceeded the
   approved register (§2) and should be pulled back.
