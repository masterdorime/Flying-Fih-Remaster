# Flying Fish Momentum — Web Design Spec

**Date:** 2026-10-09
**Status:** Approved for planning
**Source:** `FlyingFishMomentum_Master_PRD_v3.0` + player-requested additions

## 1. Goal

A shareable, browser-playable 3D endless momentum game where a flying fish builds speed exclusively through precision timed presses, filling a Flight Gauge that unlocks stronger flight tiers — ending in true plane-like flight at Max tier. Friends can play via a hosted link with no install.

## 2. Platform

- One folder: `index.html` + `js/` (ES modules) + `assets/` (GLB/FBX models).
- Three.js via CDN importmap. No build step, no bundler.
- Local testing via local static server; automated verification via headless Chromium.
- Ships as: static folder / zip / GitHub Pages / itch.io — open link, play.
- Keyboard primary (WASD/Space/Escape); Gamepad API support secondary.

## 3. Assets

| Asset | Use |
|---|---|
| `shrimp_low_poly.glb` | Coin model (spinning, bobbing pickup) |
| `kenney_watercraft-pack` (GLB) | Obstacles: buoys, speed boats, cargo containers, gates, cargo piles |
| `low-poly-rocks-fbx` (FBX) | Rock clusters (static hazards), water color accents |
| (procedural) | Player fish, water plane, gradient sky — no external assets |

FBX rocks load via three's `FBXLoader` (+ `fflate`); all else via `GLTFLoader`.
Asset scale/orientation is verified empirically in-browser; per-asset scale
factors live in a config table, not scattered in code.

## 4. Architecture (maps 1:1 to PRD §23)

| PRD system | Module | Responsibility |
|---|---|---|
| RunManager | `js/run-manager.js` | Game states Menu/Tutorial/Run/Pause/Results; distance & metrics; difficulty ramp |
| PlayerMomentumController | `js/momentum.js` | Speed/accel/drag; `ApplyTimingResult()` |
| PrecisionTimingSystem | `js/timing.js` | Prompt lifecycle; 70 ms input buffer; window shrinking |
| FlightGaugeSystem | `js/gauge.js` | Fill/drain; tier thresholds; events |
| FlightStateMachine | `js/flight-state.js` | Tier profiles (max speed, accel, turn rate, gravity scale, FOV, trail color) |
| PlayerMovementController | `js/player.js` | Swim/fly steering; plane mode |
| CameraSpeedReactor | `js/camera.js` | FOV/lag/tilt/shake/kick |
| JuiceFeedbackSystem | `js/juice.js` | Popups, squash-stretch, speed lines, particles |
| WorldGen | `js/world.js` | Chunked procedural generation; pooling; safety |
| Coins (new) | `js/coins.js` | Shrimp coin spawn/collect |
| Audio (new) | `js/audio.js` | WebAudio synth SFX + tier-reactive music |
| UI/HUD | `js/hud.js`, `js/ui.js` | HUD, menus, settings, tutorial, results |
| Config/settings | `js/config.js`, `js/settings.js` | Tunables (PRD §24) + persisted user settings |
| Debug overlay | `js/debug.js` | PRD §24.1 readouts |
| Scene bootstrap | `js/main.js`, `js/game.js` | Renderer scene, wiring, loop |

Inter-module communication via a small event bus + direct method calls on
well-defined interfaces; UI never mutates gameplay state directly.

## 5. Core systems

### 5.1 Momentum (`momentum.js`) — PRD §6

- `CurrentSpeed`, `TargetSpeed`; max speeds: Swim 25, Low 35, Med 50, High 70, Max 110; MinSpeed 8.
- Acceleration: 35–120/s by tier; drag always applies (swim 1.5/s, fly 0.6/s scaled by state).
- Speed gain ONLY from timing results: Perfect +12/+16/+22/+30 by tier; Good +6/+8/+11/+15; Miss −18/−28/−45/−70.
- Holding a direction never adds meaningful speed (PRD constraint 2).

### 5.2 Precision timing (`timing.js`) — PRD §7

- Prompt lifecycle: decide → spawn → present windows → press → evaluate → result → recycle → feedback.
- Perfect window 0.07s shrinking to 0.035s; Good window 0.18s → 0.09s, by `InverseLerp(MinSpeed, MaxSpeed_Flying_Max, CurrentSpeed)`.
- 70 ms late input buffer; press with no active prompt within its window = Miss against the closest active prompt; press with no prompt at all = no penalty (grace).
- Visual: shrinking ring — outer edge = Good limit, inner core = Perfect limit. Readable at Max speed. Prompt expires: fade + whoosh, no penalty for an expired prompt never pressed.

### 5.3 Flight gauge (`gauge.js`) — PRD §8

- Range 0–120 (may overfill past 100 to 120). Fills ONLY from Perfect (+12) / Good (+5). No passive fill.
- Flying drain 3.5/s without a recent Perfect; Miss applies extra drain ×1.8.
- Tiers: None 0 / Low ≤30 / Medium ≤70 / High <100 / Max ≥100. Thresholds configurable in `config.js`.

### 5.4 Flight state machine (`flight-state.js`) — PRD §9

- Tier profiles: Swim (max 25, accel 35, FOV 60), Low (35/45/65), Medium (50/60/72), High (70/80/80), Max (110/120/95); gravity scale 1.0 → 0.40; turn rate 120 → 200.
- Tier up fires on a Perfect crossing the threshold; tier down when gauge falls below threshold; transitions are obvious (popup, flash, sound, trail color change) and never obscure prompts.
- Max tier drains fastest relative to gain; staying in plane mode requires chained Perfects.

### 5.5 Movement (`player.js`) — PRD §4, §10

- Forward motion always ≥ MinSpeed feel; WASD steers (steering strength by tier).
- Swimming at/below surface (y ≈ 0.6); flying gains altitude with speed/tier; low momentum → sink back to water (recovery space, not death).
- Plane mode (new): gauge ≥ 100 → wings lock, roll-bank turning (A/D bank, turn rate 200), W/S pitch, free climb up to a soft ceiling, camera FOV 95, "MAX FLIGHT" burst, speed lines at full strength. Below 100 → "POWER DOWN", exit plane mode with a brief control damp (0.5s, no tier change churn).
- Player squash-stretch: stretch with accel, squash on water re-entry.

### 5.6 Camera (`camera.js`) — PRD §16

- Follow with lag 0.12s; FOV 60 → 95 by speed/tier; tilt on turning; kick +0.35s forward on Perfect/Tier Up; shake + pull-back on Miss/Tier Down (scaled by settings); never obscures prompts.

### 5.7 Obstacles & world (`world.js`) — PRD §11, §12

- Chunks ~120 m along +Z, pooled, spawn 3 ahead / recycle 2 behind.
- Chunk contract: difficulty rating, obstacle set, prompt set, coin set, guaranteed safe lane.
- Difficulty ramp: distance · run time · tier · prompts/s / window tightness / obstacle density / moving hazards.
- Static: rock clusters (FBX), cargo containers, house boats. Moving: speed boats and buoys drifting laterally. Gates: two props forming a timed opening.
- Collision: radius-overlap vs obstacle collider cage (deterministic, no physics engine). Minor → speed loss −8 + camera kick; Major (big rock/ship) → −20 + forced descent; catastrophic only if speed < MinSpeed while airborne and no recovery path.
- Safety: generation asserts each chunk keeps a passable corridor ≥ fish diameter +20%, prompts never inside geometry, recovery points every ≤ 3 chunks.

### 5.8 Coins (`coins.js`) — player addition

- Shrimp GLB, spinning + bobbing, spawned in arcs/lines along the safe corridor; magnet radius small (1.2 m).
- Collect: +250 × tier multiplier score, gauge-fill PROHIBITED (PRD §8.2), +1 coin counter, chime + pop + brief sparkle.
- Coins also mark the safe lane early on (teaches the route).

### 5.9 Scoring & chain — PRD §14, §15

- Score = distance points (1/m) + Perfect 500 / Good 150 + coins + tier multiplier applied to timing+coin gains + sustained-momentum bonus (per second ≥ Med tier without a Miss, +50/s).
- Miss resets the momentum multiplier to 1 and breaks the chain; never subtracts accumulated score.
- Chain counts consecutive Perfect/Good; best chain tracked for results.

## 6. Flow & UI

- **States:** Boot → Main Menu (Start/Settings/Quit + best distance) → Tutorial (first run only) → Run ⇄ Pause → Results → Restart / Menu. Quit on web → "Thanks for playing" screen + attempt `window.close()`.
- **Tutorial (PRD §3.2):** scripted 11 beats through live systems: swim → prompt #1 (exaggerated feedback) → gauge visibly fills → Low flight → prompt #2 chain → intentional Miss → speed/gauge visibly drop → normal run. Skippable (Skip button + Escape), completed state in localStorage.
- **HUD:** gauge bar with tier tick marks 30/70/100 + proximity glow to next tier; tier label; speed; distance; coins; chain; timing ring; minimal and grounded in the feedback hierarchy Prompt → player → gauge → juice → background.
- **Results:** distance, duration, highest tier, top speed, Perfect/Good/Miss, best chain, coins, score, best-distance comparison ("NEW BEST!"), Assist-mode badge if on.
- **Settings (localStorage):** master, music, SFX sliders; camera shake slider; post-FX intensity; input sensitivity; Assist toggle (Perfect/Good ×1.6 wider, top speed ×0.85 — flagged on results as non-record).
- **Pause:** stops simulation and timing progression, preserves state; Resume / Restart / Main Menu.
- **Debug overlay (F3):** speed, target, gauge, tier, state, last result, window sizes, chain, time, distance, difficulty, FPS.

## 7. Audio (`audio.js`) — PRD §19

- All synthesized (no audio assets): Perfect (bright arpeggio), Good (soft blip), Miss (dull thud), tier up (rising sweep), power down (falling sweep), coin (chime), collision (noise burst), splash, UI click.
- Music: layered synth pad + pulse whose intensity follows tier (Low calm → Max extreme).
- Master/music/SFX split; all volumes from settings.

## 8. Failure & recovery — PRD §10

- Run ends when speed < MinSpeed while airborne and unable to reach water.
- Sinking to water is a recovery state, not death: swim caps speed at 25, prompts remain, rebuild gauge, relaunch to Low flight when gauge > 0 and speed > 12 near surface.
- Being dropped to water by a big hit = Major collision logic, always survivable.

## 9. Performance — PRD §26

- Prompt/obstacle/coin/VFX object pooling; no per-frame allocations in gameplay systems (preallocated vectors, ring buffers for trails).
- Target: stable 60 fps at 1080p on a mid PC; adaptive: if FPS < 50 for 3s, halve particle counts and disable the speed-line layer.

## 10. Testing — automated, per phase (headless Chromium via Playwright)

Acceptance gates mapped from PRD §28.1 (plus player additions):

1. Fish moves forward with visible momentum; WASD steers without granting speed.
2. Prompts appear; Perfect gives +speed/+gauge; Good moderate; Miss negative.
3. Gauge fills only from Perfect/Good; drains while flying; caps at 120.
4. Tier changes at 30/70/100; tier-specific speed caps and FOV apply.
5. Plane mode engages at gauge 100 (roll/pitch/climb active, FOV 95) and disengages below 100.
6. Camera FOV reacts to speed/tier; shake respects settings.
7. Popups PERFECT/GOOD/MISS/MAX FLIGHT/POWER DOWN fire on their events.
8. Pause stops simulation + timing; Resume restores exactly.
9. Coins: collect increments score/coins and does NOT change gauge.
10. Collision: minor = speed loss + camera kick; major = forced descent; run survives.
11. 90-second scripted run (simulated perfect presses) reaches Med+ tier and stays alive.
12. Results screen shows all metrics; best distance persists across reload.
13. Zero console errors during all of the above.

## 11. Out of scope (v1)

Multiplayer, story/dialogue, cosmetic shops, achievements, leaderboards,
mobile touch controls (designed to not break, but not optimized), VR.

## 12. Deliberate divergences from PRD §32 (resolved here)

| Open decision | Resolution |
|---|---|
| Engine | Web/Three.js (player decision) — hostable link for friends |
| Flight-entry trigger | Gauge crosses Low tier (>0) while speed > 12 near surface |
| Run-failure | Speed < MinSpeed while airborne with water unreachable within dive time |
| Obstacle penalties | Minor −8 / Major −20 + forced descent (deterministic overlap tests) |
| Scoring formula | §5.9 above |
| Combo | Chain affects score multiplier only, never gauge |
| Procedural strategy | Hand-authored chunk templates mixed procedurally with validity constraints |
| Camera FOV per tier | §5.4 profile table |
| UI layout | §6 above |

## 13. Milestones (plan phases)

1. **Bootstrap** — folder, importmap, renderer/scene/loop, placeholder world, debug overlay, smoke test.
2. **Movement** — swim + fly + steering + momentum constants (PRD M1).
3. **Timing** — prompts, windows, buffer, results, juice popups (M2).
4. **Gauge & tiers** — fill/drain, thresholds, tier profiles, transitions (M3).
5. **Camera** — FOV/tilt/kick/shake reacting to speed & tier.
6. **World & obstacles** — chunks, Kenney boats, rock FBX, gates, collisions, difficulty ramp, coins (M4).
7. **Plane mode** — Max-tier flight (player request).
8. **HUD + flow** — menus, pause, results, settings, tutorial (M5).
9. **Audio** — SFX + tier music.
10. **Polish & ship** — perf pass, juice tuning, README, final verification.
