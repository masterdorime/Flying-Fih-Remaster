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

- [ ] **T1** docs commit: this plan.
- [ ] **T2** RED: unit tests for the tick model — the target is `targetTicks × tick`; the window is
  constant width wherever the target lands; a per-trigger draw varies across triggers and reproduces under
  a seed; `tick` ≥ the aliasing floor.
- [ ] **T3** GREEN: `config.QTE` gains `tick` + `targetTicks`; `pickLead` becomes a tick-count draw;
  `createQte` derives `targetAt` from it. Unit suite green.
- [ ] **T4** RED: `t08` gains — a static target element exists and is visible before the moment; the beat
  fires (asserted through `debugAudioStats`, so it is deterministic and not a screenshot); `EARLY`/`LATE`
  reaches the popup; the target **varies across triggers**; both styles reachable from the first ring.
- [ ] **T5** GREEN: `hud.js` — the clock dial (ticking hand + gold target band), the closing ring's marked
  target, the key-as-surface fill, the beat, both styles from ring 1; the arc removed.
- [ ] **T6** GREEN: `audio.js` synth tick + target beat; `game.js` stamps the press sign; `juice.js` shows
  it on the popup.
- [ ] **T7** acceptance: a six-frame montage across one window; two rings side by side showing **different**
  targets. If the moment is not obvious in a still, it is not fixed.
- [ ] **T8** closure: full unit suite + full browser gate; HANDOFF; SDD ledger; throwaway screenshots.

## Risks

1. **Aliasing** — ticks finer than ~0.15 s become noise at ~11 fps. Enforced by T2.
2. **Semantics** — a clock ticking *down* means "press before it ends", which is now the opposite input.
   The notch carries the goal; nothing implies hurry.
3. **Audio as the only channel** — forbidden; the notch is the visual and the sound is additive.

## Out of scope

- The window widths, grades, scoring, `applyResult`, the chain rules.
- The tutorial (still cannot finish, deferred by the user).
- Stage B (ring spacing).
