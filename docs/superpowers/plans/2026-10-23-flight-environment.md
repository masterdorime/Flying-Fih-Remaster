# Flight Environment Rebuild — Implementation Plan (Phase 4)

**Date:** 2026-10-23 · **Status:** approved in-session (user said "go") · **Method:** TDD, inline
**Spec:** `docs/superpowers/specs/2026-10-23-flight-environment-design.md` (`2ad7bdc`) — it owns the contract;
this owns the order and the ledger.

**The user's call:** *"show me both"* — the landmarks and the skybox are decided from **rendered pictures**,
so both are built behind switchable config/debug seams and the choice is made at the end, not guessed now.

## Contract (spec §2, in one screen)

| # | Guarantee | Proof |
|---|---|---|
| 1 | **No hollow** — no downward ray through the sea reaches the background | pure: bands are **contiguous in y** and the **deepest band is opaque and covers x/z** (size ≥ spacing). Browser: a frozen-vantage still looking down |
| 2 | **Not dark** — a bright skybox from the project's assets above the clouds | the swap reads a config key; stills at one vantage, four skies |
| 3 | **No isolated block props** | `debugSkyWorld().props === 0` |
| 4 | **Gameplay untouched** — rings, coins, collision, physics, the descent | the full suite; the sky world stays decorative |
| 5 | **Below the lane** — sea top ≤ 50 against `flyMin` 57 / gate band 63–104 | pure invariant, so a later tweak cannot quietly break it |
| 6 | **Cheap** — 60 fps in a normal browser, not worse on this software-GL rig | measured frame-time delta at a frozen vantage + a quad budget (≤ 600) |

## Tasks

- [ ] **T1** docs commit: this plan.
- [ ] **T2** RED: `tests/unit/sky-layers.test.js` — bands contiguous in y (no vertical gap); the deepest band
  is opaque **and** covers x/z (puff size ≥ mean spacing); the top band sits at or below 50; the recycle
  window extends past the haze; the quad budget holds. Watched RED: the module does not exist.
- [ ] **T3** GREEN: new pure `js/sky-layers.js` (the band table + `skyCoverageGaps()` +
  `bandCoversXZ()` + the budget) — THREE-free, the house pattern for measurable look rules.
- [ ] **T4** GREEN: `js/sky-world.js` — the soft-alpha slab and the ten Kenney props replaced by the four
  bands of `puffTexture()` quads (`depthWrite:false`, back-to-front, recycled in z around the player), the
  cloud towers behind `debugSetCloudTowers(on)`, and an inert `debugSkyWorld()` (props 0, band count, sea
  top, quad count).
- [ ] **T5** GREEN: `js/config.js` gains `ATMOSPHERE.flight.skybox` + `ATMOSPHERE.flight.fog`;
  `js/main.js`'s above-cloud branch reads them instead of hard-coding `skybox-space.png`.
- [ ] **T6** RED+GREEN: new `tests/browser/t24-skyworld.mjs` — sea top below `flyMin`, deepest band opaque,
  props 0, towers/sea present in flight and hidden in swim, bottle-visited console clean.
- [ ] **T7** acceptance: frozen-vantage stills — looking **down** (hollow gone), forward at altitude, the
  descend, a before/after pair — plus the measured frame-time delta and quad count.
- [ ] **T8** the picture decisions: render the sea **with and without towers**, and one sea under **all four
  skyboxes**, then bake the user's picks into config.
- [ ] **T9** closure: full unit + full browser gate, spec + HANDOFF, SDD ledger.

## Risks (spec §6)

Fill rate is the real one: large soft quads are cheap per quad and expensive per pixel, and this rig is
software-GL. Hence the budget and the measured delta are load-bearing rather than ceremony. Second:
transparent quads need a deliberate draw order — inherited from the ocean's existing cloud pattern.
