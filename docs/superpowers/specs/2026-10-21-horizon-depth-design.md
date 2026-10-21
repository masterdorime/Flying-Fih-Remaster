# Horizon Depth — Design

**Date:** 2026-10-21 · **Status:** approved in-session (the four shaping decisions were taken by
the user: character, motion, scope, content); stages execute TDD.
**Extends:** `2026-10-18-ocean-cohesion-design.md` §4.7 (the horizon layer, staging S5), which
specified that layer's *safety contract* — own RNG stream, non-collidable, rock-FBX reuse — but not
its character. This document fixes the character and widens the scope to the near-mid field.
**Scope:** the swimming-phase environment only. HUD, gameplay, worldgen layout and RNG draw order,
coins/scoring, and the flight/sky world are all untouched.

## 1. Problem (audited in code, 2026-10-21)

Evidence: a live swim frame (`Screenshot 2026-10-21 003020.png`) plus the code read below. Three
faults that are really one seam.

1. **The horizon is a bare straight line.** `sky-dome.js:8-10` records that this seam used to be
   worse — the background equirect had its own painted sea — and the crafted dome fixed the
   *colour* mismatch. But nothing occupies the distance, so the meeting of sea and sky is still a
   ruled line right across the frame.
2. **The mid-field is empty, and the props standing in it get no aerial perspective.** The sea
   brightens with distance (`water.js:209-211`: `mix(col, uOcean, smoothstep(80.0, 300.0, dist) *
   0.35)`), while the props are fogged on `ATMOSPHERE.fog` alone (`config.js:285`, near 120 /
   far 480). On three's curve that is **2.0% at 150 m** and **29.7% at 250 m** — a hull at normal
   viewing range is effectively unfogged while the water beneath it has already lifted. The props
   therefore read as *stickers on the sea*: the half of the user's original note ("obstacle and
   water and the fish still look separate") that the cohesion phase did not close.
3. **The layer §4.7 specified is unbuilt.** `js/horizon.js` does not exist, and `config.js:314`
   holds `horizon: { layers: 0, scaleRange: 0, hazeStrength: 0, spacing: 0 }` — a block of zeros
   reserved by the approved spec and never populated.

## 2. Approved register (user, in-session, 2026-10-21)

| Decision | Chosen | What it rules out |
|---|---|---|
| What is out there | **Distant rock stacks standing IN the swell, haze behind** | Haze-only (too soft to give a depth plane); shader-only painted horizon (cannot stand rock in water) |
| Motion | **Stacks recycle with travel; the farthest haze holds station** | All-static (no "sense of travel", which is §4.7's stated purpose); all-recycling (the colour break would itself move, and any placement gap would show a bare seam) |
| Scope | **Widen it — retune the shared fog curve too, and add mid-ground content** | Shipping the horizon layer alone and leaving the near props as crisp as they are today |
| Mid-ground content | **Purely visual — no hitbox, coins untouched** | Collidable debris (a fairness change, its own spec); denser coin trails (a scoring decision) |

**The consequence that shapes everything below:** every chosen option is *visual*. Nothing
collidable, no coin, no score, no speed, no QTE, no worldgen layout. **The §4 fairness table is not
engaged by this document.**

## 3. Contract

| Quantity | Contract |
|---|---|
| RNG | The layer draws from its **own** stream. worldgen's slots **1–5** are all in use (`worldgen.js:435,460,468,491,498`); the horizon takes **slot ≥ 90**, so no existing draw moves and the corpus pins stay green |
| Collision | Non-collidable by construction: never registered with `obstaclesNear`, never in a chunk record, no capsule, no hitbox. Asserted live (§6), not assumed |
| Distance floor | Nothing renders nearer than **240 m**. The playable lane is ±14 m and rows compose inside 360 m, so the floor keeps distant rock unmistakably *not* a hazard. A unit-tested property, not a convention |
| Assets | The **12 rock FBX already on disk** (`assets/models/rocks/`) — no new assets, per §4.7. They are **not** added to `loadModels`' boot path; the layer loads its own templates lazily, so boot cost is unchanged |
| Fog | **One** curve, in its existing one home (`ATMOSPHERE.fog`), keeping three's linear `smoothstep` **shape** that `atmosphere.js:45-49` and `water.js` both assume. This document retunes `near`/`far`; it does not reshape the curve |
| Performance | "Buy the look with math, not geometry" (parent spec §2). Counts are **capped from a measured before/after fps** on this rig, not chosen by taste |
| Failure | A failed rock load degrades to the haze band alone. The layer never throws and can never black a frame |
| World | **Ocean only.** Hidden whenever the flight world is showing, driven from the one place that already swaps them (`main.js`'s `updateEnvironment`) |

## 4. Design

### 4.1 `js/farfield.js` — new, PURE

No THREE. Placement and density math, so it is unit-testable in node (AGENTS §3's pure/impure
split, the same shape as `worldgen`/`world` and `wave`/`water`).

- `createFarStream(runSeed)` → a stream keyed `streamKey(runSeed, index, 90, ordinal)`, reusing
  `mulberry32`/`streamKey` from `worldgen.js` rather than inventing an RNG.
- `stackSlots({ zFrom, zTo, ... })` → deterministic `{ x, z, variant, scale, yaw }` for the stacks
  in a z window, honouring the 240 m floor, the count cap and the scale range.
- `driftSlots(...)` → the same for mid-ground motes, 120–300 m.
- `hazeAt(distance)` → a thin wrapper over `atmosphere.fogFactorAt`, so the layer's haze and the
  world's haze are the same number rather than a second opinion.

Properties the pure layer owns and the tests pin: determinism per seed; **different** seeds give
**different** slots; the 240 m floor; count caps; scale bounds; no slot inside the playable lane's
x-range at any z it can be recycled into (belt and braces with the floor); and consecutive stacks
separated in z by at least `minZSeparation`, because a row of distant rock reads as a *wall* and a
wall in the far distance is the one thing this layer must not accidentally build.

### 4.2 `js/horizon.js` — new, IMPURE

Three things, all ocean-only, all following the recycler shape `sky-world.js` already establishes
(pooled clones; a `dz` window that wraps; `reset(playerZ)` on a new run; `debugInfo(playerZ)` for
live reads) — **except** that it takes its randomness from `farfield`, not `Math.random()`, which
is a smell `sky-world.js` carries (`sky-world.js:36,44,57,59`) and this layer must not copy.

- **Solid stacks.** Pooled FBX meshes from the rock set, sized by `scale`, placed by `farfield`,
  recycled over a window around the fish. Each **rides the swell** by sampling `surfaceHeight(x, z,
  t)` (`wave.js` — the same function `world.js` uses for hulls), so it sits *in* the water rather
  than on a flat plane. Each gets the **wet waterline band** by reusing `wet-props.js`'s injection:
  one copy of that treatment, not a second implementation.
  **Deliberately no foam collar and no contact decal.** Those live in the water shader's `uHulls`
  array, which `game.nearHulls()` budgets to `ATMOSPHERE.contact.hullRange` (70 m). At 240 m+ a
  collar is a few pixels wide; the wet band plus the wave-riding intersection is what actually
  reads, and buying the rest with geometry would be the opposite of the parent spec's §2 rule.
- **Mid-ground drift.** Two parts, split by the parent spec's "math, not geometry" rule:
  - **Geometry** (instanced, and the only new draws): small solid fragments — rock pieces from the
    same FBX set scaled down, plus flat foam slabs. Both are shapes already on disk; the slabs reuse
    `clouds.js`'s `slabTexture()` seam rather than a new texture. Placed at 120–300 m, same
    recycler, wave-riding, no hitbox. Their job is to resolve as they approach, which is a motion
    cue geometry has to carry.
  - **Shader foam lines** (no draws at all): a sparse long-crest foam family added to `water.js`'
    existing `fine` streaks, tuned to the mid-distance scale. The water shader already owns
    band-limited line families, so this is the cheap half and it needs no pool, no recycle and no
    perf budget.
- **Lifecycle.** `createHorizon(scene, runSeed)` → `{ group, update(dt, fishZ, t), reset(runSeed),
  debugInfo(fishZ) }`.

### 4.3 The static far haze band — extends `sky-dome.js`, no new mesh

The static half of the decision, and the dome **already owns it**: `sky-dome.js:66-68` lifts the
last ~0.12 of elevation toward the seam colour at 0.55,
`col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.12, elev)) * 0.55)`, and `sky-dome.js:16-18`
deliberately opts the dome out of fog because it is the fog colour's *source*. The band therefore
holds station by construction — it is painted on the dome.

So this stage is a tuning plus **one home for the numbers**. The band and haze constants
(`0.80` at `sky-dome.js:64`; `0.12` and `0.55` at `:68`) move into `config.ATMOSPHERE.sky`, whose
block as built holds only `zenith` and `horizon` (`config.js:283`) even though the parent spec's
§4.1 named `sunGlow`/`cloudBand`. Adding the band keys closes that gap; it does **not** renumber or
relocate the dome's sun-disc constants (`:55-56`), which are outside this document.

### 4.4 `config.ATMOSPHERE.fog` — retuned, not re-shaped

`near`/`far` move so haze ramps across the near-mid field instead of switching on at 120 m. The
**shape stays three's linear smoothstep**, because `atmosphere.js:45-49` exists precisely for
parity with `scene.fog` (`main.js:65`) and the water shader's `smoothstep(uFogNear, uFogFar,
vFogDepth)`. Switching the class to `FogExp2` would be a change to the "one air" contract and is
explicitly **not** proposed here — it is the fallback if the retune reads mechanical, and it would
then be its own decision.

The retune is judged on a **frozen-vantage A/B** (`probe-water-look.mjs`, built 2026-10-21: seed
pinned, camera converged, sim paused → a bit-identical vantage across runs), not by assertion.

### 4.5 `config.ATMOSPHERE.horizon` — the reserved block, populated, names settled

The zeros at `config.js:314` become the layer's numbers: stack count and cap, `zBand`,
`minDistance` (240), `minScale`/`maxScale`, `minZSeparation`, drift count/range/size.

**Name disposition, stated explicitly so no stale name survives** (the same housekeeping the gate
work did when it retired `nudgeMargin`/`nudgeHalfRange`): `spacing` → **renamed** `minZSeparation`
(it always meant the spacing between things, and now says between what); `scaleRange` **retired** in
favour of an explicit `minScale`/`maxScale` pair, because `[a, b]` arrays are the only
array-shaped config in an otherwise flat numeric block; `layers` **retired outright** — the far
band is painted on the dome, not layered, so a count of "layers" names nothing real;
`hazeStrength` **retired here and placed in `ATMOSPHERE.sky`** instead, because the haze band is a
dome shader input and `§4.3` is its owner. One number, one home (§3) — this document must not
half-populate a block and leave a same-named key in two places.

### 4.6 Wiring

`main.js` builds `horizon` beside `skyWorld`; calls `horizon.update(...)` in the ocean phase; and
extends the existing environment swap (`main.js:256-268`, which already toggles `water.mesh.visible`,
`skyWorld.group.visible`, `skyDome.setVisible` and `game.setOceanVisible`) to toggle the horizon
group with the ocean. `horizon.reset(runSeed)` on restart, from the same place the per-run seed is
drawn (`js/game.js`).

## 5. Staging

Feeds the implementation plan; each stage lands its own watched-RED tests. The order matters —
every stage is a safe checkpoint.

1. **H1 — pure farfield.** `farfield.js` + unit tests. Nothing renders; no visual risk.
2. **H2 — fog retune.** Two config numbers, the frozen-vantage A/B, and any dependent test
   recalibration. Isolated deliberately: it changes the whole ocean's look and must be revertable
   on its own.
3. **H3 — stacks.** Lazy rock loading, the recycler, wave-riding, the wet band reused.
4. **H4 — drift.** The mid-ground instanced set.
5. **H5 — haze band + config homes.** Dome tuning; the band keys added; the `horizon` block
   populated.
6. **H6 — perf + caps.** Measure before/after fps; set the caps from that measurement; recalibrate
   any browser wait budget the extra draw calls disturb (AGENTS §5.5).

## 6. Tests (watched-RED first)

**Unit** (`tests/unit/farfield.test.js`, pure): determinism per seed; different seeds → different
slots; the 240 m floor; count caps; scale bounds; no slot in the lane's x-range; spacing sanity.
Plus a **source guard** that `farfield.js`/`horizon.js` never import `worldgen.js`'s chunk builders
— §4.7's draw-order rule cannot be tested behaviourally, so it is tested at the source, the same
way `wave-port.test.js` guards the shader mirror.

**Browser** (`tests/browser/t23-horizon.mjs`, live-read): the live stack count equals the count
`debugInfo` reports from config (so the assertion carries no duplicated number); **every** live
stack is beyond the floor; `debugObstaclesNear()` contains **none** of them (non-collidable,
provably); stack y moves as the field moves (wave-riding, not a flat plane); the set recycles as
travel advances while z stays bounded; the horizon group is hidden when the sky world is showing;
console clean.

**Visual:** frozen-vantage before/after screenshots for the fog retune and each look stage — a
visual change verifies by eye, on stills (AGENTS §10).

**Performance:** before/after fps on this rig, same conditions, single workload (§10).

## 7. Failure handling

A rock load failure (or a missing FBX) is caught and degrades to drift + haze band; the group is
never left half-built and `update` never throws. This follows the existing precedent — `water.js`'s
fallback dome and `main.js`'s composer `try/catch`. The worst case is today's look, never a black
frame.

## 8. Non-goals / out of scope

- **Collidable content of any kind** — no hazard, no capsule, no obstacle registration (a user
  decision: purely visual).
- **Coins and scoring** — untouched.
- **Worldgen** — no change to `composeChunk`/`generateChunk`, no new draw inside slots 1–5, no
  layout change. The corpus pins are the guard.
- **The flight/sky world** — Phase 4's territory; `sky-world.js` is untouched and the horizon layer
  is ocean-only.
- **New assets** — none. The rock FBX reuse is a re-activation of files already shipped.
- **Reshaping the fog curve** (`FogExp2` or a custom falloff) — deliberately not proposed (§4.4).
- **The dome's sun-disc constants** — outside this document (§4.3).
- **HUD** — untouched.

## 9. Risks

1. **Software-GL cost.** Added draw calls on a rig already at 1.5–1.8 fps. Mitigation: pooled and
   instanced geometry, and caps set from a measurement (§5 / H6) rather than from hope.
2. **The fog retune washes the near field.** This is the one change here that alters an already
   approved look. Mitigation: its own stage, its own A/B, two numbers to revert.
3. **RNG contamination.** Mitigated by slot ≥ 90 plus the source guard; the corpus pins are the
   empirical check.
4. **Distant rock read as a hazard.** Mitigated by the 240 m floor, the haze, and the live
   "no obstacle discs" assertion.
5. **Register drift.** The parent spec's §2 binds: if the layer starts converging on a higher
   fidelity class than stylized-crafted, it has exceeded the approved register and should be pulled
   back.
