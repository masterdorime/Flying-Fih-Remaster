# Flight Environment Rebuild — Design (Phase 4)

**Date:** 2026-10-23 · **Status:** design, awaiting user approval · **Phase:** 4 of the 6-phase request
(§9.2 of HANDOFF owns the sky requirements; this spec is its implementation authority)

**User's requirements, recorded 2026-10-15 (§9.2), and still unshipped:**

- *"The sky should be a **vast sea of cloud with no hollow on it**."*
- *"The sky also **looked dark** in the current state of the game."*
- *"**Use skyboxes assets instead**"* — i.e. prefer `assets/models/skyboxes/*` over the dark space equirect.

## 1. Problem (confirmed in code and in the live build, 2026-10-23)

The flight world today is a **placeholder** (`js/sky-world.js` says so in its own header: *"Placeholder sky
world above the cloud curtain (HANDOFF step 4)"*). Three defects, each with a named mechanism:

1. **The hollow.** The cloud floor is ONE `PlaneGeometry(340, 1500)` carrying a **soft-alpha** texture
   (`slabTexture()`), `transparent: true, opacity: 0.9`. Its gaps are see-through, so any downward view
   reveals the background through the sea. The user's own screenshot
   (`OneDrive/Gambar/Screenshots/Screenshot 2026-10-15 151359.png`) shows a large dark hole in the cloud
   field — *"with no hollow on it"* is pointing at exactly that.
2. **The dark.** `js/main.js` swaps the background to **`skybox-space.png`** (dark starfield) above
   `FLIGHT.cloudY` — its own comment calls it *"space sky above"*. That is the *"looked dark"* the user
   asked to eliminate, and four brighter skyboxes (`day`, `morning`, `night`, `alien`) sit unused in
   `assets/models/skyboxes/`.
3. **The isolated block objects.** Ten Kenney props (`buoy`, `buoy-flag`, `container`, `boat-speed`) float
   in the sky, **decorative only** — they are not in the collision set and carry no gameplay. At altitude
   they read as junk (the red container and blue boat in the user's screenshot).

Everything else in the flight world is sound and stays: the z-recycling discipline, the shrimp trails (the
coin-path cue), the environment swap, and the descend transition.

## 2. Contract

| # | Guarantee | How it is proven |
|---|---|---|
| 1 | **No hollow**: no downward view through the sea reaches the background | structurally — the sea is layered and its **lowest band is fully opaque** across its whole extent; plus a frozen-vantage still looking down |
| 2 | **Not dark**: the flight background is a bright skybox from the project's own assets | the swap points at the chosen skybox; stills at the same vantage before/after |
| 3 | **No isolated block props** in the flight world | `debugSkyWorld().props === 0` |
| 4 | **Gameplay untouched**: rings, coins, collision, flight physics, the descent | the full suite; the sky world stays decorative (never in the collision set) |
| 5 | **Below the lane**: the sea's top surface stays under the lowest flight altitude so it can never occlude a ring or a coin | sea top ≤ **50** against `flyMin` 57 and the gate band 63–104 |
| 6 | **Cheap enough to keep 60 fps in a normal browser**, and not worse on this software-GL rig | before/after frame time at a frozen vantage, plus a quad-count budget |

## 3. Design

**3.1 The cloud sea — layered, closed, and deep.** Replace the single soft-alpha plane with **four altitude
bands** of puffs, all reusing the project's own `puffTexture()` (no new assets):

| band | y | size | opacity | role |
|---|---|---|---|---|
| surface | 45–50 | 30–80 m | 1.0 | the closed top of the sea — **opaque**, so the hollow cannot exist |
| upper | 30–44 | 20–55 m | 0.75 | parallax and scale variety |
| mid | 12–29 | 30–70 m | 0.6 | the depth you see into |
| deep | −20–11 | 60–140 m | 0.95 | the distant floor that blocks any residual ray |

Puffs are **quads with `puffTexture()`**, `depthWrite: false`, drawn back-to-front by band (the project's
existing cloud pattern), recycled in z around the player exactly as the props are today. The bands overlap in
altitude and size so the eye reads one continuous sea rather than four layers, which is what *"soft puffs at
many scales/heights"* means.

**3.2 The sky.** The swap's above-cloud branch points at a **bright** skybox (choice in §7) instead of
`skybox-space.png`. `space` stays reachable in config so the choice is one line, not a code change.

**3.3 Flight haze.** A new `ATMOSPHERE.flight.fog` (colour matched to the chosen skybox, near/far tuned so
the sea's far edge dissolves into the sky). This is what removes the *horizon* seam: the sea has to end
somewhere, and haze is how it should end — not with an edge.

**3.4 Landmarks (proposed, veto-able).** Replace the ten block props with a handful of **distant cloud
towers** — tall stacks of the same puffs, 400–900 m away, recycled. They give the parallax that tells you
you are moving, which the props were doing, without reading as objects. This serves phase 5's *"peaceful
flight feel"* rather than fighting it: few, far, and soft.

**3.5 Kept as-is.** Shrimp trails, `setOceanVisible` and the two-environment swap, the curtain at
`cloudY` 45, the descend transition, the ocean's own sky dome and horizon field (they belong to the ocean
and are already good).

## 4. Tests

- **New browser file `t24-skyworld.mjs`** (the house pattern for a new subsystem): `debugSkyWorld()` reports
  the band count and that the lowest band is opaque; `props === 0`; the sea's top is below `flyMin`; the
  group is visible in flight and hidden in swim; console-clean.
- **Unit** for the pure part: a `skyLayers()` helper in a pure module giving each band's y/size/opacity range
  and the recycled z-window, so the "top stays under 50" and "a band is opaque" guarantees are contract
  tests, not eyeballing.
- **Stills** at a frozen vantage (the `probe-water-look.mjs` technique — bit-identical camera) for: looking
  down (the hollow is gone), looking forward at altitude (the sea reads as a sea), the descend, and the
  same vantage before/after for a straight comparison. The user's eye is the acceptance for the *look*.
- **The full browser gate** — the sky world is switched by `main.js`, which every browser file boots.

## 5. Non-goals

The ocean's sky and horizon, obstacles, coin placement, flight physics, the descend feel, phase 5's
"peaceful" tuning, the cloud curtain, and any new asset (the skyboxes already exist).

## 6. Risks

1. **Fill rate.** Puffs are cheap quads but large ones cost fill; software-GL is unforgiving. Mitigated by a
   quad budget (target ≤ 600), band-level size caps, and a measured before/after at a frozen vantage.
2. **Layering artifacts.** Transparent quads with `depthWrite: false` need a deliberate draw order; the
   project already does this for the ocean's clouds, so it inherits a proven pattern.
3. **Ring readability.** The sea must never rise into the lane — guarantee 5 is the hard constraint, and it
   is tested at the pure layer so a later tweak cannot quietly break it.
4. **A bright sky washing out the rings.** Rings are cyan/violet with a black-hoop history; the stills will
   show whether contrast holds against the new sky, and the ring's own outline is the fallback.

## 7. The user's decisions

1. **Which skybox** for above the clouds: `day` (recommended — the reference is a bright blue cloudscape),
   `morning`, `night`, or `alien`.
2. **Cloud towers**: keep the proposal in §3.4, or drop the landmarks entirely for a purely peaceful sea.

Everything else in this spec is an engineering call and is marked as such.
