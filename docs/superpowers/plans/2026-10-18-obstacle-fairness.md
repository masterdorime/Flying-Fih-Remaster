# Obstacle Fairness — Execution Plan

**Design:** docs/superpowers/specs/2026-10-18-obstacle-fairness-design.md
**Budget:** approved in-session 2026-10-18 (1.2 s rows / 1.35 s walls, chain
validator 0.25 s reaction + 0.15 s margin, honest capsules 0.3/0.4 grace).
**Commit style:** `feat:|fix:|docs: <summary> (suite: X/X unit, Y/Y browser)` · zip rides feature commits (HANDOFF §7).

## Stage 1 — Fairness core (this series)

- [x] T1 RED: u-fairness-rows — window/bunching/jitter corpus tests (fail on current code)
- [x] T2 RED: u-fairness-reachability — zero unreachable chains corpus + transitTime math
- [x] T3 RED: u-honest-collision — capsule cases, rowClash capsule-awareness, variant determinism
- [x] T4 GREEN: config PATTERN (1.2/1.35/22/jitter 4, no ceiling) + cursor-based composeRows with cross-chunk cursor replay + chain validator + breather skip
- [x] T5 GREEN: variant binding in worldgen + capsule dims on specs; world.js renders the bound variant; world.js capsule hit test (depth pre-cull rz; discs feed rx); capsule-aware rowClash + rowIntervals
- [x] T6 GREEN: full unit suite green; t10/t18 regression check
- [x] T7 RED→GREEN: t19-fairness browser suite (row windows live, auto-driver zero-crash at 25/70, side-pass no-hit regression) — driver rebuilt as a positional servo (settle-cap bounded); NOTE: the earlier "MPC phase-2 pass" was a false positive: the driver's evaluate args omitted `cap` (undefined → NaN scores → setLateral(NaN) → fish x NaN → incollidable fish + NaN baked into the wake ribbon = the THREE computeBoundingSphere console warning). The NaN land is a driver artifact, not a game path.
- [x] T8: commit series (e8fda10 docs, b1e4bb9 feat) + rebuild flying-fish-momentum.zip (155 entries) riding the feature commit; update HANDOFF §3/§5/§6

## Stage 1b — Gate clearance ruling (2026-10-18 player report, injected before Stage 2)

- [x] T9 RED: unit ruling tests in timing.test.js (z-band by rz not radius-dot, mouth+margin acceptance bar 3.8, shift planes capsule-checked, capsule fuzz with shift-legality property, `GATE.clearanceMargin` pin) — 6 watched failures on the pre-fix build ("ring inside the hull body: x=0, z=100", "grazing plane … edge 3.4", "landed plane violates hull 108", fuzz shift-legality, margin undefined)
- [x] T10 RED: t19 phase 4 — live gate spawn sampling (servo segments, tier high): **5 real spawn overlaps reproduced live pre-fix** (gate 22 inside a cargo hull Δz 5.06 of ±6.9 with lat −1.14; gate 44 grazing dead-center lat 0.03; three more) across ≥ 25 observed spawns — exactly the reported "near/overlapping" defect
- [x] T11 GREEN: `GATE.clearanceMargin: 0.8` + capsule-aware `resolveGatePlacement` (band = rz + mouthRadius, bar = mouth + margin, same search staircase and fallback) — unit suite 82/82 (78 + 5 new − 1 replaced fuzz); t19-fairness standalone ALL PASS incl. phase 4 zero-overlap. **Sampler predicate aligned to the exact ruling band** after the first green corpus flagged two just-out-of-band neighbours (Δz 4.13–4.27 vs band rz+3 = 4.06 — 3+ m past 1 m hull tips, physically clear): the earlier RED-era `+0.25` fudge over-reached the contract the ruling guarantees; the phase now asserts bar ≥ 3.8 strictly inside `rz + mouthRadius` (+1e-6 float eps only)
- [x] T12: full unit + browser suites green (**82/82 unit; single-run 16/16 browser**); commit series `cc62821` (docs preflight) → `d6107b4` (feature fix; zip rebuilt 155 entries riding it); HANDOFF §4/§5/§6 updated in place

## Stage 2 — Formations & risk-reward (next)

- [ ] Formation library (offset turns, center forks, staggered chicanes, wide gates, coin-bearing risk lanes, breathers after hard walls)
- [ ] Difficulty = complexity, never impossible windows; coin trails re-aimed

## Stage 3 — Swimming physicality

- [ ] Wave contact/tail/fin/banking feel; directional wake; speed/turn-scaled foam+splashes

## Stage 4 — QTE feedback (rules untouched)

- [ ] perfect/good/miss + chain feedback across juice/audio/speedometer; feedback-only changes documented first

## Stage 5 — Camera + collision readability

- [ ] look-ahead ≥ budget at max speed; MISS/CRASH popup overlap fix; hitbox-vs-visual overlays

## Stage 6 — Max-speed verification

- [ ] automated 25/50/70/110 + boost-transient pass; report warning distance, reachability, dodge completion, overlay screenshots
