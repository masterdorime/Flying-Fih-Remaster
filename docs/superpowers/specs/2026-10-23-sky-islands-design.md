# Sky Islands — Design (Phase 4b)

**Date:** 2026-10-23 · **Status:** design, awaiting user review · **Depends on:** phase 4 (the cloud sea, `f8cc442`)
**User references:** *"i would like something similar to avatar sky island"* · *"you can still see water
environment here"* (a screenshot with ships circled in the sky) · *"scenery close to the lane"* ·
*"sparse and vast"* · *"fbx island as single mesh"* (their asset sheet: islands with vegetation, waterfalls
and bioluminescent vines, plus cloud masses).

## 1. Problem

Two separate things, both real:

1. **The ocean leaks into the sky.** `game.setOceanVisible(false)` is a **one-shot poke**: it hides the
   chunks and coins that exist at the moment the fish crosses the curtain. But `world.js` keeps streaming —
   line 38 does `chunks.set(nextIndex, buildChunk(...))` — and a fresh `THREE.Group` defaults to
   `visible: true`. **Nothing in the spawner knows the ocean is hidden**, so every chunk, coin, and probably
   decal created *after* the crossing is drawn in the sky. That is the ships in the user's screenshot: the
   ocean's obstacles are ship hulls. It also explains why the leak looks partial — everything older is
   correctly hidden.
2. **The flight view repeats the water level's composition.** A flat surface below and a horizon line — the
   same *shape* as the ocean, in white. This is why the sky doesn't read as a different place, and it is the
   deeper half of "the water level should not be visible".

## 2. Contract

| # | Guarantee | Proof |
|---|---|---|
| 1 | **No ocean content above the curtain** — no chunk, coin or decal is ever visible in the sky, **including those created while flying** | browser: fly far enough to force new spawns, then assert every ocean group is hidden. **This fails today** |
| 2 | Islands are **scenery only** — never in the collision set, never a hazard | they are not added to `world`'s obstacle discs; a browser assert that the flight has no collision candidates |
| 3 | **Sparse and vast** — 2–4 islands in view, most of the frame open sky | island count + a still |
| 4 | **Vertical space 40 → ~260**, with `cloudY` 45 still the floor | config + a still at both extremes |
| 5 | **Rings spawn far and are glide-reachable** — every flight ring lies inside the energy budget of a plausible current state | pure: a reachability helper, tested over many generated states (the analogue of the ocean's chain-reachability rule) |
| 6 | **No island blocks the ring lane** — rings never spawn inside or behind an island | pure: an island-clearance check on every ring placement |
| 7 | **Cheap** — a draw budget and a measured frame-time delta | frozen-vantage measurement on this software-GL rig |

## 3. Design

**3.1 The leak fix — a state the spawner honours, not a poke.** `world` and `coins` gain a persistent
`visible` flag; `buildChunk` and the coin spawner apply it at creation, and `setOceanVisible` sets it. The
decal system gets the same treatment. Deliberately *not* the alternative ("stop updating the ocean while
flying"): that would stop composing the water the fish descends into, and that re-entry is
fairness-critical.

**3.2 Assets — a slot, not a dependency.** Islands load from `assets/models/islands/*.fbx` as **single meshes**
(vegetation and waterfalls baked in, per the user's answer) through the existing `models.js` pipeline, which
already handles FBX and normalisation for the rocks. Until those files exist, the same module builds
placeholder islands from the 12 rock FBX scaled up plus procedural puffs, so nothing blocks. The user's cloud
masses become the mist layer; the phase-4 cloud sea stays as the mid-ground so `js/sky-world.js` is extended
rather than replaced.

**3.3 Placement.** 2–4 landable-scale islands (roughly 200–600 m across) at 300–1500 m, spread across
heights so some sit *above* the flight line (you fly under them — the money shot), some beside, some far.
**Close to the lane** so passing one is a near-miss, **never in it** so nothing can be hit. They drift slowly
(a few m/s, recycled on the same wrap discipline the sea uses).

**3.4 Vertical space.** The flight band widens from 57–110 to roughly **40–260**. The curtain at 45 remains
the floor, so the transition discipline and `updateEnvironment`'s hysteresis stay valid. The camera's
`lookAhead` and height need retuning for the taller range.

**3.5 Rings spawn far, and must be reachable.** Flight rings are placed at a distance that reads as a
destination (several hundred metres) rather than a prompt appearing overhead. Because a glide has a finite
energy budget, this creates a fairness obligation: every ring must be reachable from a plausible state. The
rule is pure and testable, and it is the flight's version of the project's existing arrival-speed discipline.

**3.6 Islands never block rings.** A ring spawning inside or directly behind an island would look broken and
be unfair. Ring placement gains an island-clearance check alongside its existing hull check.

## 4. Tests

- **Unit**, new `js/sky-islands.js` + `tests/unit/sky-islands.test.js`: island placement never enters the
  lane corridor; drift keeps a minimum spacing; rings are reachable (property test over generated states);
  rings clear every island (property test).
- **Browser**, new `t24-skyworld.mjs`: **the leak assertion** (fly ~500 m, then every ocean chunk/coin/decal
  is hidden — the assertion that fails today), islands present in flight and absent in swim, the flight has no
  collision candidates, console clean.
- **Stills**, frozen vantage: under an island, between two, the wide view, and the descent back through the
  curtain. The user's eye is the acceptance for the look.

## 5. Non-goals

Collision in the sky, the glide and its camera (spec B), the ocean's own look, the ring grading, the
tutorial, and any new asset authoring — the islands are the user's to make, and this spec only defines where
they drop in.

## 6. Risks

1. **Fill rate.** Island meshes at 600 m across cover a lot of screen. Mitigated by count, distance, fog, and
   a measured delta — the same discipline the cloud sea got.
2. **Other spawners that default to visible.** The leak is a *class* of bug, not one instance. The sweep must
   cover every system that creates objects during flight: chunks, coins, decals — and it must *not* touch the
   gates, which are supposed to be visible up there.
3. **The glide-reachability tuning.** Too strict and rings cluster near you; too loose and a ring is
   unreachable. It is pure maths with a property test, so it can be tuned without guesswork.
4. **Asset format risk.** FBX scale and material conventions differ per exporter; `models.js` proves the
   pipeline works for FBX, but the first island will need a scale/normalisation check.

## 7. Decisions still open

None blocking. Island count, size and drift speed are engineering calls inside "sparse and vast"; the asset
list is the user's to deliver.
