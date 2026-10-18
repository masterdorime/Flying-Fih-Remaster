# Obstacle Fairness & Honest Collision — Design

**Date:** 2026-10-18 · **Status:** approved (budget approved in-session; stages execute TDD)
**Supersedes:** nothing; extends the 2026-10-16 obstacle-patterns design.
**Scope:** swimming-phase obstacle fairness only (stages 1–2 of the approved
program; water feel, QTE feedback, camera, audio follow in later stages).
Flight code is untouched.

## 1. Problem (Stage 0 evidence, measured 2026-10-18)

All figures come from the real generator (45 deterministic chunk-sequences)
and live browser probes (`analyze-chains.mjs`, `probe-browser.mjs` — both
session-local, not committed).

1. **Rows are 0.35 s apart at every speed** (`PATTERN.spacingSeconds 0.35`).
   82–95% of consecutive-row transitions sit below a 1.2 s window; at 110 u/s
   the worst measured window is 0.19 s.
2. **Two structural bunching bugs**: the `rowZ1=115` clamp jams the chunk tail
   (rows 10 m apart measured) and chunk boundaries guarantee only 25 m
   (0.23 s at 110 u/s). z-jitter (`rng()*6`) can also subtract spacing.
3. **No cross-row validation**: 23% (25 u/s) → 69% (110 u/s) of consecutive-row
   transitions are physically unreachable even before human reaction time
   (steering-sim spaceproofed + validated in-browser: full 27 m lane-cross
   takes 0.5–0.8 s at every tier, so recognition time — not steering — is the
   binding constraint).
4. **Collision spheres reach meters past visible hulls** (measured normalized
   bounds): giant ship visible half-beam 3.3 m vs gameplay reach 7.6 m
   (4.3 m invisible per side); liner-class 2.7–3.3 m; boat ~2.0 m; container
   2.2 m; buoy ~1 m. Longitudinally spheres are approximately correct, which
   is why head-ons feel fair and side grazes feel like cheating. Renderers
   also pick a random variant per spawn, decoupled from the gameplay radius.
5. **Visibility is not a constraint**: fog far 480 m ≫ the largest budget
   distance (~98 m at 82 u/s). Screenshots confirm rows read at range.

## 2. Approved fairness budget

| Quantity | Value |
|---|---|
| Min window between consecutive rows | **1.2 s** at every speed (distance = speed × 1.2) |
| Min window after a wall-type row | **1.35 s** |
| Row spacing floor | 22 m |
| z-jitter | may only add time (`0..4 m`), never subtract |
| Chunk-tail clamp | removed (cursor-based placement; no bunching) |
| Chunk boundary | held to the same window (sequence-aware generation) |
| Human reaction allowance in the chain check | 0.25 s |
| Chain check margin | 0.15 s |
| Hitbox model | axis-aligned z-capsule per obstacle |
| Hitbox grace | +0.3 m on half-beam radius, +0.4 m tip slack |
| Fish collision radius | unchanged (1.1) |

## 3. Design

### 3.1 Cursor-based rows (worldgen.js + config PATTERN)

`PATTERN`: `spacingSeconds 1.2`, `wallExtraSeconds 0.15`, `spacingMin 22`
(ceiling removed), `zJitterMax 4`.

Rows are placed by a **global cursor**: row z = cursor + jitter(0..4);
cursor += max(window·speed, spacingMin) (+ wallExtraSeconds·speed after wall
rows). The cursor carries across chunks: `cursorFor(index, seed, speed)`
replays cursor arithmetic only (pure, O(index) per call, no obstacle work),
so `generateChunk(index, difficulty, seed, speed)` keeps its exact signature,
determinism and callers. Row count per chunk is whatever the cursor visits —
chunk tails and boundaries can no longer bunch. When the cursor leaves a
chunk's span, the row lands in the next chunk's span (the generator places it
with the chunk-local mapping unchanged).

At 110 u/s a window is 132 m > one chunk (120 m): some chunks contain no new
row and the next row arrives from cross-chunk cursor state — correct by
construction and asserted by tests.

### 3.2 Chain reachability validator (worldgen.js, pure)

- `steerCap(speed)` → nearest tier cap (turnRate × airControl × 0.55).
- `transitTime(dx, cap)` — first-order settle sim identical to
  `player.js` (`v += (T−v)·min(1,dt·6)`, `x += v·dt`, dt=1/60), exported for
  unit tests.
- `chainReachable(prevArcs, nextArcs, dz, speed)` — the widest ≥minGap free
  span of each row; requires
  `transitTime(|Δcenter|, cap) ≤ dz/speed − 0.25 − 0.15`.
- Every newly composed row is checked against the previous row's arcs
  (including the previous chunk's tail row). On validator failure the row is
  re-rolled (≤ `maxAttempts`); on exhaustion the generator skips one window —
  an enforced breather band, which also satisfies "recovery sections after
  difficult patterns".

### 3.3 Honest hull collisions (worldgen.js spec + world.js hit test)

- `variant` is chosen **deterministically per spawn** (seeded rng) and stored
  on the obstacle spec; `world.js` renders exactly that variant (removes the
  random-variant/gameplay-radius mismatch; `models.js:templateFor` keeps its
  signature but receives the variant).
- Per-variant dims are baked from the Stage 0 measured normalized bounds:
  `rx = halfBeam + 0.3`, `rz = halfLength + 0.4` (capsule half-length
  including tip slack; `mov` sweeps along x as before).
- Hit test (`world.js:update`): 2D point-to-capsule-segment distance
  `dist((px,pz), seg) < rx + playerRadius`, with the existing per-obstacle
  `hit` flag, global grace, and major classification unchanged. Vertical
  `dy` guard kept as-is. AABB pre-cull becomes `dz > rz + 6`.
- Coin-lane disc queries (`findClearLane` callers) feed `rx` instead of the
  old sphere radius.
- `rowClash` becomes capsule-aware: hulls need
  `hypot(max(0, Δx−sweeps), max(0, |Δz| − (rzA+rzB))) ≥ rx+rx+margin`.
- `rowIntervals` uses `rx` (+ sweep) for gap math; `minGap` stays 3.0.

Difficulty compensation: honest hitboxes and the longer window shrink the
effective obstacle footprint; difficulty returns via pattern/formation
complexity (Stage 2), never via invisible reach.

### 3.4 Debug/API surface

- Obstacle specs expose `rx`, `rz`, `variant` (visible via
  `debugObstaclesNear`). No existing debug API signature changes; the crash
  observability counters (`debugAudioStats().calls.collision*`) keep working.

## 4. Tests (watched-RED first)

**Unit** (`tests/unit/`, pure worldgen + collision math):
- u-fairness-rows: across 10 seeds × speeds {25,35,50,70,110} ×
  difficulties {0.3,0.6,1.0}: every consecutive-row pair (chunk-local and
  cross-chunk) has `dz/speed ≥ 1.2 − ε` (walls ≥ 1.35), min row separation ≥
  22 m at slow tier, zero rows generated beyond a chunk span without cursor
  accounting, jitter never subtracts.
- u-fairness-reachability: the same corpus yields **zero** unreachable
  chains (regression fixture: old seed 21 / d 0.3 / 25 u/s 10 m/16 m pair is
  now rejected or skipped); transitTime matches closed-form settle values.
- u-honest-collision: point-to-capsule cases — side pass at half-beam + 0.2
  misses (was a hit under spheres); head-on into the bow inside tip slack
  hits; capsule-capsule `rowClash` no-tangle cases; variant determinism per
  seed.

**Browser** (`tests/browser/t19-fairness.mjs`):
- Seeded layout at 25 and 70 u/s: consecutive-row windows via
  `debugObstaclesNear` ≥ budget; an auto-driver stepping `debugSetLateral`
  through widest-gap centers crosses ≥ 10 rows with **zero** collision
  counter increments (`debugAudioStats().calls.collision`).
- Side-pass geometry: teleport alongside a liner hull just outside its
  capsule → crossing produces no collision (regression vs the old sphere).
- Existing suites keep passing (t10 crash choreography unaffected: same
  flags/grace; t18 wing rule untouched).

## 5. Non-goals / out of scope

- No new gameplay mechanics; ring→QTE→boost/penalty loop, timing windows,
  speed values, scoring and chain rules untouched.
- Flight systems unchanged (Phase-4 rebuild remains queued after this phase).
- No global difficulty knob changes (PATTERN complexity rebalance is Stage 2).
- Music-silence debugging stays blocked pending the user's `debugMusicTest`
  run (HANDOFF §8).

## 6. Risks

- Cursor replay cost is O(index) per chunk generation — capped by
  chunksAhead/Behind windowed generation; memoized when needed.
- Widest-span-center chain check is conservative (players can weave more
  cleverly) — acceptable: the budget explicitly buys recognition time.
- Smaller hitboxes widen every gap; wall rows re-assemble with more cursor
  spacing — visual density shifts are a Stage 2 formation task.

## 7. Gate clearance ruling (2026-10-18 follow-up -- ring QTE spawns inside/near hulls)

### 7.1 Report and root cause (audited, not guessed)

Player report: rings appear "really near obstacles or overlapping them".

`resolveGatePlacement` (js/timing.js) z-scoped discs by
`|d.z - plane| <= d.radius + 1.2 (MOUTH_PLANE_SLACK)`. Since Stage 1,
`world.obstaclesNear` reports honest capsules: `radius = rx` (lateral
half-beam 2.0--3.6) and `rz` (z half-length up to 9.4). The filter therefore
read a 16--18 m hull as a ~2 m dot in z: any gate plane landing 4.8--12.4 m
off a hull anchor (body actually spanning +-9.4 m) passed the clearance check
and spawned the ring inside the hull, or accepted a plane at exactly
mouth-radius edge distance (ring grazing the hull edge). Two audited
non-causes: the compose horizon (~360 m ahead) always covers gate lead
(clamped 45--90 m), and `GATE.placementRange 30` sizing is correct. The latent
defect predates Stage 1 (legacy sphere radii 4.0/6.5 accidentally covered
more band); honest capsules exposed it.

### 7.2 The ruling (contract)

A placed ring is legal only if, evaluated for the clean spawn, every
clearest-x slide, and every z-shift candidate (<= zShiftMax 20, 4 m steps):

1. **Z-band scope:** a disc is in scope iff
   `|d.z - plane.z| <= (d.rz ?? d.radius) + GATE.mouthRadius` -- the ring's
   plane may never sit inside a hull's z-capsule reach.
2. **Acceptance bar:** for every in-scope disc,
   `|gate.x - d.x| - (d.rx ?? d.radius) >= GATE.mouthRadius + GATE.clearanceMargin`
   (margin 0.8, new config key). Rings never graze at mouth distance.
3. **Fallback stays best-effort:** when no in-scope position satisfies the
   bar anywhere in [ideal, ideal + 20], the resolver holds the clearest x at
   the ideal plane (documented in-code). Composed water rarely saturates:
   row legality (>= one true 3 m gap per row) plus stage-1 spacing gives the
   4 m shift grid a legal between-rows plane.

Movers keep the sweep-envelope encoding (`radius = rx + range` at
world.obstaclesNear); the corrected z-band and bar close their side too.

### 7.3 Guard rails preserved

No QTE loop, timing, speed, scoring, or chain rule changes: placement is a
spawn-time nudge with the same corridor, lead, and zShiftMax. Unit ruling
tests use numeric fixtures mirroring real hulls (rx 3.6 / rz 9.4 ship);
browser t19 phase 4 samples every live spawn for zero footprint-overlaps.
