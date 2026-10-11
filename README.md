# Flying Fish Momentum

A cartoony 3D endless-runner where you're a flying fish. You build speed **only** by
pressing `SPACE` at the right moment — the timing ring shrinks to a gold core. Hit
Perfects to fill the Flight Gauge, and at a **full gauge you take flight**: the first
launch is a SPAM quick-time-event that blows the gauge, then a cinematic leap punches
through the cloud layer into a sky world where you **fly like a plane**. Later flights
skip the ritual. Collect shrimp for score. Crash into rocks and boats and you lose momentum.

Built from the *Flying Fish Momentum Master PRD v3.0* as a browser game (Three.js) —
no install, no build step, runs anywhere.

The game has **two environments**: the ocean below and a sky world above the cloud
curtain. Flight is a gated, cinematic event - see *How it plays* below.

## Run it

The game loads models, so it needs a tiny local server — you can't just double-click
the HTML file:

```bash
# Option A: Node (if you have Node installed)
npm run serve
# then open http://localhost:8123

# Option B: Python
python -m http.server 8123
# then open http://localhost:8123

# Option C: VS Code → install "Live Server" → right-click index.html → "Open with Live Server"
```

## Share it with friends

The whole game is just static files — `index.html`, `js/`, `vendor/`, `assets/`.

- **Easiest:** drag this folder onto [netlify.com/drop](https://app.netlify.com/drop) —
  you get a public link in seconds.
- **GitHub Pages:** push the folder to a GitHub repo → Settings → Pages → serve from
  `main` branch. Your link is `https://<you>.github.io/<repo>/`.
- **itch.io:** zip the folder and upload as an HTML5 game.

Friends click the link and play in any modern browser. No install.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D | Left stick |
| Pitch (plane mode) | W / S | Left stick |
| **Timing press** | **SPACE** | A / South button |
| Pause | ESC | Start |
| Debug overlay | F3 | — |

## How it plays

1. **Swim** — the ocean is home. You always move forward at minimum speed, and
   flight is **locked** until the gauge is full.
2. **Timing ring appears** — press SPACE when it shrinks to the gold core.
   - Perfect (gold core) = big speed boost + gauge fill.
   - Good (outer blue edge) = smaller boost + fill.
   - Miss = speed loss + gauge drain; an untouched ring expires harmlessly.
3. **Gauge full = the gate opens** — Perfects and Goods fill the Flight Gauge
   (0-120). At a full gauge with a chain of hits, the launch sequence starts.
   Flight is no longer a passive tier; it is an event you trigger.
4. **First flight: SPAM-QTE** — the fish locks and trembles at the surface.
   **Mash SPACE** to overfill the gauge past its max - then it **blows**. Four
   presses do it; if you stop mashing, the gauge blows on its own after 5 s.
5. **Cinematic leap** — slow-mo, the camera orbits and rises as the fish punches
   through the cloud layer to a fixed altitude, **above the clouds**.
6. **Fly like a plane** — in the sky you hold altitude and steer freely. Perfect
   hits **refill the gauge** (skill sustains flight); misses drain it. Gauge empty
   means you descend back through the clouds into a swim recovery.
7. **Later flights skip the spam** — a full gauge auto-launches straight into the leap.
8. **Two ways the run ends:**
   - **CRASHED** — a big crash (boat/container/large rock) while at Low or Medium
     tier costs a wing; lose all 3 and the run is over (HUD shows remaining wings)
   - **OUT OF MOMENTUM** — pinned at minimum speed while airborne for 1.5s
     (e.g. two Max-tier misses in flight: no thrust, you plummet)
   Being low over the water is survivable - it is the recovery zone, not death.
9. **Shrimp** = score only (they never fill the gauge) and come as continuous
   trails so there are always coins ahead to collect - on the ocean *and* in the sky.
10. Settings include an **Assist mode** (wider timing windows, slower top speed) -
    runs made with it are flagged on the results screen, not counted as records.

## Project layout

```
index.html            entry point + importmap
js/
  config.js           all tunable values (mirrors the PRD's tuning table)
  momentum.js         speed / boost / penalty math (pure)
  gauge.js            fill / drain / tier thresholds (pure)
  timing.js           window math + press evaluation (pure)
  flight-state.js     tier profiles, plane-mode rules (pure)
  worldgen.js         chunk layout + safety constraints (pure)
  scoring.js          score formulas (pure)
  player.js           movement: swim / charge / leap / fly / descend (phase machine)
  clouds.js           cloud curtain between the ocean and the sky world
  sky-world.js        placeholder sky environment above the clouds
  fish.js             procedural cartoony fish
  world.js            chunk pool, obstacle spawn, collisions
  coins.js            shrimp coins (score-only)
  camera.js           follow, FOV, kick, shake
  juice.js            popups + speed lines
  hud.js / ui.js / debug.js   HUD, menus, F3 overlay
  audio.js            synthesized SFX + tier-reactive music
vendor/three/         vendored Three.js 0.170.0 (offline-safe)
assets/models/        your GLB/FBX assets (Kenney packs + shrimp)
tests/unit/           Node test runner tests (pure systems)
tests/browser/        automated in-browser checks (Playwright)
docs/                 design spec, implementation plan, previews
```

## Sound & music

Real audio files live in `assets/audio/`:

```
assets/audio/
  music/    calm.mp3 -> mid.mp3 -> high.m4a -> max.m4a   (adaptive ladder)
            menu.mp3 (menu music), game-over.m4a (results song, reserved)
  sfx/      perfect, good, miss, power-up/down, coin, crash, crash-big,
            splash, ui, game-over stings
  ambient/  waves.mp3, wind.mp3 (wind volume follows your speed)
```

**Adaptive soundtrack** (`js/adaptive-music.js`): one full track plays at a
time; as your momentum (normalized speed, 8-110 -> 0-1) rises, the engine
crossfades to the next rung at 30% / 60% / 85% and back down. Thresholds,
volumes, and crossfade time are config in the file; nothing restarts mid-loop
(long songs get a tail->head crossfade baked in at load so they loop cleanly).
If a file is missing, that rung is skipped and the rest still play.

**Music test panel (temporary)**: open `index.html?musicdebug=1` or press F4
in-game to get a momentum slider + play/pause/mute/volume controls so the
soundtrack can be auditioned without playing. Remove `js/music-test-panel.js`
and its import before release.

Music starts on your first keypress/click (browser autoplay rule). Volumes
live in Settings (Master / Music / SFX).

## Tests

```bash
npm test             # pure-system unit tests (no browser needed)
npm run test:browser # in-browser gameplay checks
npm run test:all     # everything
```

```bash
npm test            # pure-system unit tests (no browser needed)
npm run test:browser # in-browser gameplay checks
npm run test:all     # everything
```

The browser suite plays the game headlessly and verifies the PRD's acceptance
criteria: timing results, gauge rules, tier transitions, plane mode, coins,
collisions, pause, results, persistence, and a scripted 90-second chained run
that must reach Medium+ tier without dying.

## Credits

- Game design: *Flying Fish Momentum Master PRD v3.0*
- Obstacles & boats: [Kenney Watercraft Pack](https://kenney.nl) (CC0)
- Rocks: Kenney low-poly rocks (CC0)
- Coins: `shrimp_low_poly.glb` (your asset)
- Engine: [Three.js](https://threejs.org) (vendored, r170)
- Audio: synthesized in-browser with WebAudio (no audio files)
