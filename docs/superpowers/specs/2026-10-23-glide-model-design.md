# The Glide — Design (Phase 5)

**Date:** 2026-10-23 · **Status:** design, awaiting user review
**User references:** *"maybe making flying like gliding is more reliable?"* · *"do you know the gliding when
you use elytra in minecraft, i need something like that"* · *"i want the flying level feel more peaceful"* ·
*"does the boost come from rings only? it also come from diving"*

**User's answers on the six decisions (2026-10-23):** airborne death **removed entirely** · gauge
**drifts slowly** in flight · ring boost **Perfect beats Good** · climb too hard → **a real stall** ·
the "ascending" camera work is **the launch into the sky** · islands arrive as **single FBX meshes**.

## 1. Problem

**Climbing is free.** `FLIGHT.climbRate: 18` lets the fish move anywhere in the 57–110 band at no cost and
with no consequence, so flight is a corridor with a ceiling rather than something you *fly*. There is no
trade, so there is no flying.

On top of that, flight carries **two pressures that both read as punishment**, and one of them is invisible:

1. **The gauge drains at 2.2/s** and a Perfect only pauses it for 2.5 s. A flight ring arrives about every
   4.5 s and returns +8, so **a flawless chain still loses altitude** — the arithmetic makes flight an
   unwinnable countdown. Worse, that drain is also the *only* way down: `startDescent()` fires when
   `gauge <= 0.01`, so the ending is a timer expiring, not a choice.
2. **A stall kills you.** `RECOVERY.failureAirborneSeconds: 1.5` — minimum speed while airborne for 1.5 s
   ends the run. After the phase-4 work removed the floating props, the sky contains **nothing to collide
   with**, so this rule is the *only* thing in flight that can end a run, and it punishes the one state a
   glider is supposed to have.

The user's reference is the Minecraft elytra: pitch trades speed against altitude, speed persists, and a stall
is a *recoverable drop* you fix by diving.

## 2. Contract

| # | Guarantee | Proof |
|---|---|---|
| 1 | **Pitch trades speed for altitude**: diving gains speed and spends height; climbing spends speed for height. The trade is the mechanic | pure: dive → speed up and descend; climb → slow and rise; the totals are conserved within drag |
| 2 | **A real stall exists and is recoverable**: climbing too hard collapses lift into a fast drop, and diving restores it | pure: a stall state entered by pitch/speed and exited only by diving; a test that a stall is always recoverable |
| 3 | **Nothing in the sky can end a run** — no stall death, no hazard. A run ends by crash-landing in the ocean, or by never being able to launch again | the airborne-failure rule is gone from the flight path; the suite plus a browser assert that no flight state ends a run |
| 4 | **The tier is the glide's envelope**: a lower tier means a draggier, slower, earlier-stalling glide. The user's "drift slowly" is what makes staying up cost you | pure: the same dive from a low tier and a max tier produces different speeds and stall thresholds |
| 5 | **The gauge drifts slowly in flight** — materially slower than today's 2.2/s — and rings still bank it | config + a pure test on the rate |
| 6 | **Rings pay score and lift, and the grade scales the lift**: Perfect > Good > Miss (nothing) | pure: lift per grade; a Perfect nets more altitude than the drift between rings takes, a Miss nets less |
| 7 | **The descent is falling out of the ring band**, and the auto-descend takes you home smoothly | pure: below the band floor the descent transition is eligible |
| 8 | **The launch is a rise, not an orbit, and input always wins** | the camera specs below; the scripted arc yields to any steering input |

## 3. Design

**3.1 A pure glide model.** New `js/glide.js`, THREE-free, the same discipline as `momentum.js` and
`wave.js`:

- `glideStep(state, input, dt, envelope)` → the next speed and vertical rate, from pitch, gravity, drag and
  the lift curve.
- `stallState(speed, pitch, envelope)` → flying | stalling, with the entry and recovery thresholds.
- `glideReach(from, to, envelope)` → whether a target (a ring) is reachable, and the best altitude profile
  to get there. This is what Spec A's ring placement uses, and it is the flight's fairness rule.
- `envelopeFor(tier)` → max dive speed, stall speed, drag and lift for a tier. The tier stops being a cruise
  speed and becomes the *quality of the glider*.

**3.2 Integration.** In flight, `game.js` takes speed and vertical position from the glide instead of
`profileFor(tier)`'s cruise band. The gauge still selects the tier and still drains, slowly, per the user's
choice. `startDescent()`'s trigger moves from `gauge <= 0.01` to **falling out of the ring band** — the
band's floor (57 today, ~40 with Spec A's range) becomes the point of no return, and the rings visibly drift
above you as a warning. The leap keeps its role as the burst that buys entry altitude, with the launch's
height scaled by the chain.

**3.3 Rings in flight** keep their QTE untouched (grades, windows, `applyResult`, the chain — all frozen
territory) and gain a physical payoff: threading one gives score and **lift**, scaled by the grade, with a
Perfect enough to gain altitude and a Miss worth nothing. Spec A places them far and reachable.

**3.4 The ascent camera — the launch into the sky.** Today it is a 162° orbit at a 6.5→11 m radius with a
60→95 FOV swell, lasting `leapSeconds: 2.6`, during which the camera owns itself. Rebuilt as:

1. **A rise, not an orbit.** Camera below and behind, looking up the fish's back, watching it climb away,
   then catching up. An orbit is the tier-up shot; a launch needs thrust.
2. **Mark the breakthrough.** Crossing the curtain at y 45 is the beat of the game and nothing marks it: a
   soft white-out overlay (not bloom — it is disabled), a puff burst, and the audio swell, timed so the sky
   opens as the fish emerges.
3. **Camera lag scales with speed.** `CAMERA.positionLag` is a constant; make the lag grow with speed so the
   camera *trails* during the burst and settles as the glide begins. This is what makes speed readable, and
   it is the single largest flight-feel win available.
4. **Short, blended, and mirrored.** Cut the scripted arc to ~1.0–1.2 s and blend (never cut) into a wider,
   slower follow — the camera decelerating *is* the transition into the calm. Mirror it for the descent: dive,
   white-out, the sea reopens.
5. **Input always wins**, and a reduced-motion setting calms the FOV swell, the lag and any roll.

**3.5 Docs this changes.** The stated failure mode ("runs end by OUT OF MOMENTUM", AGENTS §1 and HANDOFF),
the flight band, and the flight ring lead. Each is contract-adjacent and lands with this phase, not before.

## 4. Tests

- **Unit**, `tests/unit/glide.test.js`: the trade (dive gains speed and loses height, climb the reverse);
  the totals conserve within drag; a stall is entered by hard climbing and **always recoverable by diving**;
  `envelopeFor` scales speed and stall threshold with the tier; `glideReach` is true for reachable targets
  and false for impossible ones (property test over generated states); lift per grade satisfies the
  Perfect > Good > Miss contract and a Miss cannot sustain flight.
- **Browser**: the camera cannot be unit-tested, so the launch is accepted from **stills at a frozen
  vantage** before/during/after the curtain crossing, plus a probe asserting the FOV and lag respond to speed
  and that steering cancels the scripted arc. The suite's existing flight tests (t08's flight gate band, t12,
  t15, t17, t19) must stay green — the flight band change touches them.
- **The full browser gate**, because this changes the flight path that several files exercise.

## 5. Non-goals

The water's momentum loop and its rules, the ring grading and QTE (frozen territory), the island look
(Spec A), the tutorial (still broken, still deferred), and phase 5's remaining "peaceful" polish beyond the
camera — audio and palette can follow if the feel needs them.

## 6. Risks

1. **A fast dive versus ring approach.** At 150+ u/s a ring 45 m ahead is unaimable. Spec A's answer — rings
   far away and glide-reachable — is what makes a fast dive safe, so the two specs are coupled: the glide
   should not ship before the far-ring placement does.
2. **The vertical range touches the camera and the ring band.** Several browser tests assert flight altitudes;
   widening 57–110 to 40–260 will need them recalculated, and the gate band (63–104) becomes relative to the
   player rather than fixed.
3. **Run length.** With no airborne death and a slow drift, a skilled pilot can stay up a long time. The
   tier's decay is the intended soft cap — it makes the glider progressively worse — but the score economy
   should be watched in play, and the drift rate is the knob.
4. **This is a rules change in contract territory**: the drain rate, the airborne failure rule, the flight
   band, and the documented ending. The user has approved the shape; the numbers land with watched-RED tests.

## 7. Decisions still open

None blocking. The glide constants (lift curve, drag, stall thresholds, the slow drift rate and the launch
height bonus) are engineering calls to be tuned against the tests and the stills.
