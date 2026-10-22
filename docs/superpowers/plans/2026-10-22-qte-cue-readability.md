# QTE Cue Readability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-10-22 · **Status:** approved in-session (user-directed) · **Method:** TDD, native execution

**Spec:** `docs/superpowers/specs/2026-10-22-ring-system-design.md` §8 (the centred-timing model this
re-cues). **This plan changes presentation only** — the window, the grades, the chain, `applyResult`,
scoring and every fairness floor are untouched.

## Goal

Make "when do I press" readable. The player's report: **"the qte visual still confusing for player"**,
narrowed to **"can't tell when to press"**. Root cause, against `better-ui`'s rule *"every animated state
change also needs a static cue — motion is never the only feedback channel"*: the moment exists **only**
as motion converging, with no static target and no beat, while a second moving element (the drain arc)
says "hurry" against the cue's "wait".

## Contract

| Quantity | Contract |
|---|---|
| Opportunity | **Constant** — the good window is 0.76 s wide at every ring (Perfect ±0.16 s, Good ±0.38 s around the target). Randomising the *window* would randomly change difficulty; the *target* moves instead |
| Target | **Drawn per trigger**: `targetTicks` ∈ {4,5,6} × `tick` 0.16 s after the crossing ⇒ the moment lands 0.64–0.96 s out. A different question every ring, the same opportunity every ring |
| Ticks | The clock's step AND the unit the target is drawn in, so *Perfect = within one tick of the notch* is literally true. Hard floor ≥ 0.15 s: below that ticks alias on this rig (~11 fps) |
| Static target | Both styles mark the moment **before anything moves**: a gold band one tick wide on the clock dial; a marked ring where the closing ring will land |
| Beat | At the moment: the target flashes, the SPACE key fills solid, a synth tick sounds. Motion is never the only channel |
| Early/late | The press sign (`EARLY` / `LATE`) rides the existing grade popup — no new HUD element, and the popup's own text keeps its substring contract |
| Deleted | The drain arc, and with it `dataset.progress`. It said "hurry" while the cue said "wait", and it existed only so older assertions stayed valid |
| Untouched | Grades, chain, `applyResult`, scoring, collision, all §4 fairness floors, and the window widths |

## Tasks

- [x] **T1** docs commit: this plan (`139b3a2`).
- [x] **T2** RED: unit tests for the tick model — the target is `targetTicks × tick`; the window is
  constant width wherever the target lands; a per-trigger draw varies across triggers; `tick` ≥ the
  aliasing floor; no drawn target can let a fresh press score. Watched RED (`QTE.tick` undefined, roster
  still `sweeping`).
- [x] **T3** GREEN: `config.QTE` gains `tick` + `targetTicks`; `pickLead` becomes a tick-count draw;
  `createQte` derives `targetAt` from it and carries `ticks`/`beat`/`tick`. Unit suite green.
- [x] **T4** RED: `t08` gains — a static target element visible before the moment; the beat fires (asserted
  through `debugAudioStats`, deterministic and not a screenshot); `dataset.phase` reaches both `now` and
  `late`; the clock's angles are **discrete**; both styles grade the moment as Perfect. **The target's
  variation is proved where it is a question of the draw** (unit) **and behaviourally** (triggers drew tick
  5 and tick 6 in the probe) — a still cannot show a different *question*, only a different answer.
  *Carried over from T2's RED instead of a second browser RED, and ledgered.*
- [x] **T5** GREEN: `hud.js` — the clock dial (ticking hand + gold target band), the closing ring's marked
  target, the key-as-surface fill, the beat, and the tail dim; both styles from ring 1; the arc removed.
- [x] **T6** GREEN (with one deviation): `audio.js` synthesises the tick + beat and subscribes to
  `qte:tick` / `qte:beat`; `game.js` owns the clock and edge-triggers both. **Deviation: the `EARLY`/`LATE`
  popup sign was dropped in favour of `dataset.phase = 'late'` dimming the mark.** Same defect (a cue
  claiming "now" while grading late), reached without a new text channel and without touching the popup's
  substring contract; ledgered in the SDD.
- [x] **T7** acceptance: a six-frame montage across one window (by PAUSING — the only way on this rig); the
  world ring for both styles; the variation seen as tick counts. If the moment is not obvious in a still, it
  is not fixed. **It was not obvious in a still: three defects came out of this step and none of them from a
  failing assertion** (the hand at 9 o'clock, the band a tick clockwise, the frozen post-moment mark).
- [x] **T8** closure: unit 139/139 + the FULL browser gate (ALL PASS, 19 checks); spec §9 + §8 banner; SDD
  ledger with 12 rulings; scratch stills in `%TEMP%\opencode\qte-final` and `%TEMP%\opencode\band2`.
  Zip not rebuilt (§6: no plan span adopted it, and this is not a release point).

## Risks

1. **Aliasing** — ticks finer than ~0.15 s become noise at ~11 fps. Enforced by T2.
2. **Semantics** — a clock ticking *down* means "press before it ends", which is now the opposite input.
   The notch carries the goal; nothing implies hurry.
3. **Audio as the only channel** — forbidden; the notch is the visual and the sound is additive.

## Out of scope

- The window widths, grades, scoring, `applyResult`, the chain rules.
- The tutorial (still cannot finish, deferred by the user).
- Stage B (ring spacing).
