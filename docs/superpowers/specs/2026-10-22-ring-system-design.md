# Ring System — Design

**Date:** 2026-10-22 · **Status:** stage A specified and approved in-session; stages B and C are
**direction only** (their numbers and rules are not settled and need their own approval).
**Scope:** how rings are placed and (later) how their QTEs read. Obstacle composition, row fairness,
scoring, `applyResult`, chain rules and the QTE *grades* are untouched.

## 1. Problem (measured live, 2026-10-22)

The user's report: *"it can be inside the obstacle, it can be very in front of the obstacle, and it
can be right behind the obstacle"* — and *"hard to catch the ring when it's directly in front of or
behind obstacle"*.

Measured with `.superpowers/sdd/2026-10-22-ring-system/probe-ring-clearance.mjs` (25 freshly spawned
rings, live, 45 u/s), which separates the three readings:

| case | measured |
|---|---|
| ring **inside / too close to** a hull — the existing 2026-10-18 clearance bar | **0 / 25** |
| a hull standing in the ring's own lane window **behind** it, under 18 m | **7 / 25 (28%)** |
| a hull standing in the ring's lane window **ahead** of it, under 12 m | 1 / 25 |

Clear water **before** the plane: `min 2.7 m · p25 10.6 m · median 45.4 m`.
Clear water **after**: `min 6.0 m · p25 33.7 m · median 47.5 m`.

**So the "inside a hull" fix holds, and what remains is the corridor.** A quarter of rings hand the
player under 18 m to line up (0.7 s at 25 u/s), and one in the sample gave **2.7 m**.

Is a corridor rule satisfiable at all? Measured with `probe-ring-achievable.mjs` (20 rings, sliding
the plane anywhere in z −12…+48 and choosing the clearest legal lane position):

| | min | p25 | median |
|---|---|---|---|
| corridor as placed | **2.4 m** | 10.6 m | 31.9 m |
| corridor available nearby | **25.2 m** | 38.4 m | 80.0 m |

**18 of 20 rings could gain more than 5 m.** The rule is satisfiable with headroom, so this is a
placement fix rather than a row-composition rewrite.

### 1.1 Result (2026-10-22, after stage A shipped)

Same probe, same conditions, 25 fresh rings at 45 u/s:

| | before | after |
|---|---|---|
| ring inside / too close to a hull | 0 / 25 | **0 / 25** |
| clear water **behind** the ring — worst | **2.7 m** | **14.6 m** |
| rings with under 18 m to line up | **7 / 25** | **1 / 25** |
| clear water **ahead** — worst | 6.0 m | **10.8 m** |
| clear water ahead — median | 47.5 m | 57.8 m |

The single remaining 14.6 m ring is the run's FIRST ring, which spawns when the player is barely
moving: its ideal plane already sits at `minZ` (the minimum lead), so it has forward room but almost
no backward room. That is the intended behaviour of the bound, not a miss.

**One defect the measurement caught in this stage's own design:** the first version bounded the search
to the spawn lead band `[spawnMin, spawnAhead]`, which above ~22 u/s leaves **no forward room at all**
— the lead clamp already places the ideal plane at `spawnAhead` — so the ring could only slide
backwards and the *exit* corridor got worse (worst ahead 4.7 m, down from 6.0). Re-measured after
bounding forward room from the ideal plane instead: worst ahead 10.8 m. Recorded because it is the
second time in this project that a placement change looked right on paper and had to be measured.

## 2. Contract (stage A)

| Quantity | Contract |
|---|---|
| Corridor | An accepted ring plane must leave `GATE.corridorBefore` clear metres BEHIND it and `GATE.corridorAfter` clear AHEAD of it, inside the ring's own **lane window** — the corridor the player must physically occupy: `x` within `mouthRadius + fish radius` of the ring's x |
| "Blocked" | A hull whose lateral extent crosses that window (`|hull.x − ring.x| − rx < window`) counts wherever it stands in z, INCLUDING a hull that does not clip the ring's circle — which is exactly the case the current bar cannot see |
| Existing bar | Unchanged and still required: `clearanceAt(z, x) ≥ mouthRadius + clearanceMargin` at the plane |
| Search window | The plane may move **forward up to `zShiftMax` beyond the ideal plane**, and **backward** down to `spawnMin` ahead of the player (never behind the fish: asserted). Forward room is measured from the IDEAL plane, not from `spawnAhead`: at any speed above ~22 u/s the lead clamp already puts the ideal plane at `spawnAhead`, so a band-only window would leave no forward room at all — found by measurement 2026-10-22, the first version of this stage had exactly that bug and the exit corridor got worse |
| Fallback | Unchanged best-effort — clear water saturating the window keeps the clearest x at the ideal plane, so a spawn is never blocked |
| Untouched | Rows, spacing, chain reachability, the QTE (windows, grades, `applyResult`), scoring, `spec §4` rows 1–3 and 5–8 |

## 3. Design (stage A)

`js/timing.js`:
- `corridorGapAt(x, z, discs) -> { before, after }` — pure; mirrors the probe's geometry so the test
  and the measurement cannot disagree.
- `resolveGatePlacement(gateX, gateZ, discs, { minZ })` gains a corridor acceptance test and a
  bidirectional ladder: the existing stages stay in order (clean plane → clearest x at the plane),
  then a z-ladder that walks **forward and backward in 4 m steps** for the best legal plane, stopping
  at `minZ` (never behind the player) — preferring the smallest move, ties forward.
- The stage-3 fallback is unchanged.

`js/config.js`: `GATE.corridorBefore: 18`, `GATE.corridorAfter: 10`, with the measurement in the
comment. **Starting values from the data above; tuned by re-running the probe and comparing the
"as placed" distribution.**

## 4. Tests (watched-RED first)

**Unit** (`tests/unit/timing.test.js`, extending the existing placement block):
- a plane with clear water but a hull inside the corridor **behind** it is rejected and moves
  (the 2.7 m case, as a fixture);
- the same **ahead**;
- a hull that clears the ring's circle but stands in its lane window is still a blocker (the case the
  old bar could not see);
- a backward move is taken when it is the only legal plane, and never when it would put the plane
  closer than `minZ` to the player;
- the existing guarantees still hold: a clean plane does not move at all, the two existing stages keep
  their order, and the fallback still returns a legal-ish x.
- a **non-vacuity** guard: the fixture set must contain at least one ring that moves and one that
  does not.

**Measurement (the real acceptance):** re-run `probe-ring-clearance.mjs` after the change and report
the new distribution beside the old one. A test asserts the *rule*; the probe shows the *effect*.

**Browser:** `t08-gates` and `t19-fairness` must stay green (they pin placement, repair, and the live
clearance sampler).

## 5. Non-goals / out of scope

- Rows, obstacle spacing, fairness floors, chain reachability — untouched.
- The QTE rules, windows, grades, scoring, `applyResult` — untouched here (stage C).
- Ring cadence — untouched here (stage B).
- No new assets.

## 6. Risks

1. **Moving rings changes the run's rhythm.** A ring that slides 20 m may land closer to (or further
   from) the next row. Mitigated: the probe compares the before/after distribution, and the spawn lead
   window bounds every move.
2. **A backward move could feel like the ring retreating.** Bounded to the lead window and to the
   smallest legal move; ties prefer forward.
3. **Cost.** The corridor test is O(discs) per candidate plane on a ~16-candidate ladder, at spawn
   time only. Negligible, but measured before and after on the rig anyway.
4. **Placement churn against the live repair.** `clearGateX` (the 2026-10-20 live re-clear) is
   X-only and stays X-only; the corridor is a spawn-time rule. If a live chunk change breaks a
   corridor, that is stage A's follow-up, recorded not assumed.

## 7. Stages B and C — direction only, NOT settled

Recorded so the intent is not lost; neither has approved numbers and neither may be implemented from
this document. **C has since shipped — see §8, which is its authority.**

- **B — spacing that is not a metronome.** Today: next ring spawns 0.6 s after the previous resolves,
  45–90 m ahead ⇒ at a steady speed a ~4.5 s metronome, which the user noticed unprompted. Direction:
  jitter the lead (×0.85–1.15) and the cooldown (0.4–1.0 s) while keeping the 45 m minimum, so two
  rings can never stack. Fairness floors untouched.

## 8. Stage C — two timing styles, SHIPPED 2026-10-22 (`c7734de`, replacing `b05fcdf`)

**The anchoring rule: the grade vocabulary and everything downstream are UNCHANGED.** Perfect / Good /
Miss, +8 / +4, the chain rules, the speed cuts, `applyResult` and scoring are exactly as they were.
Only **how** a grade is earned differs.

**The mechanic changed shape.** The user first asked for a smash (mash SPACE) and then, on seeing it,
rejected it: *"i dont want smash space qte, i want another type of timing qte."* Both styles are now
**centred timing** — the cue resolves at a moment and the window sits *around* it, so **pressing the
instant you cross is a Miss**. The skill inverted: it is no longer "press as fast as you can".

| | closing ring | sweeping marker |
|---|---|---|
| the cue | an inner ring shrinks onto the track and **meets it exactly at the moment** | a marker orbits and **enters a lit zone exactly at the moment** |
| in the world | the plain cyan ring | a violet ring with a second inner ring |
| your input | press as they meet | press as it enters the zone |

Both use the **same window**, so the style is presentation, not difficulty:

- the moment is **`targetLead` 0.62 s ± `targetJitter` 0.16 s** after the crossing — jittered **per ring**
  so a fixed rhythm cannot be memorised (the user's "so its not predictable")
- **Perfect** = within `perfectHalf` 0.16 s either side (a 0.32 s window)
- **Good** = within `goodHalf` 0.38 s (0.76 s), then the QTE expires as a Miss
- **assist** widens the two halves ×1.6 — timing, never geometry, and never the moment itself

**Widths are deliberately comparable to what they replace** (0.32 / 0.76 s against the old 0.30 / 0.70
measured from the crossing), so the change is *when* the window sits, not how forgiving it is.

**The zone is the window, by construction:** the lit arc's width is derived from `perfectHalf` and the
marker's speed from the same clock, so "dot in the zone" and "Perfect" cannot disagree. Likewise the
closing ring's radius reaches exactly the track radius at `targetAt`.

**Roster:** `QTE.styles` — `closing { weight 1.0, minD 0 }`, `sweeping { weight 1.0, minD 0.2 }` —
weighted, difficulty-gated, never twice in a row while a second is unlocked. Same shape as
`FORMATIONS`. The style AND the per-gate lead are drawn LAST in `createGate`, so no existing draw moves.

**Verification:** unit **136/136**; the **full browser gate 19/19** (a change to the QTE core earns the
whole gate, not a slice). `t08` gained live checks for both styles: `closing` starts outside the track
and **meets** it at the moment (sampled), `sweeping`'s marker **arrives in the lit zone** at the moment
(sampled), pressing at the moment is Perfect, ±0.24 s is Good, an instant press is a Miss, an un-pressed
moment is a Miss, and each style draws only its own cue. `t15`/`t17` press at `targetAt`.

**Trap found while wiring it (recorded because only a browser boot catches this class):** renaming the
config keys left the F3 debug overlay reading `QTE.perfectWindow`, which no longer existed —
`undefined.toFixed()` threw during boot and the page never became ready. `probe-boot2.mjs` named it
immediately.

**Known limits:** the numbers are starting values, not playtested; the tutorial still teaches the old
mechanic (and still cannot finish — deferred by the user); and the smash's code was removed rather than
left dormant.
