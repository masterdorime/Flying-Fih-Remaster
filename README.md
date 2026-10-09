# Flying Fish Momentum

A cartoony 3D endless-runner where you're a flying fish. You build speed **only** by
pressing `SPACE` at the right moment — the timing ring shrinks to a gold core. Hit
Perfects to fill the Flight Gauge, climb through flight tiers (Low → Medium → High →
Max), and at a **full gauge you fly like a plane** — pitch, bank, and climb freely.
Collect shrimp for score. Crash into rocks and boats and you lose momentum.

Built from the *Flying Fish Momentum Master PRD v3.0* as a browser game (Three.js) —
no install, no build step, runs anywhere.

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

1. **Swim** — you always move forward at minimum speed.
2. **Timing ring appears** — press SPACE when it shrinks to the gold core.
   - Perfect (gold core) = big speed boost + gauge fill.
   - Good (outer blue edge) = smaller boost + fill.
   - Miss = speed loss + gauge drain; an untouched ring expires harmlessly.
3. **Gauge fills → flight tiers** — Low → Medium → High → Max. Each tier is faster,
   turns sharper, and pulls the camera wider.
4. **Full gauge = PLANE MODE** — MAX FLIGHT: free pitch and climb, banking turns.
   The gauge drains while flying, so chain Perfects to stay up. Drop below full and
   you POWER DOWN.
5. **Falling to the water isn't death** — swim, hit prompts, rebuild, relaunch.
6. **Shrimp** = score only (they never fill the gauge).
7. Settings include an **Assist mode** (wider timing windows, slower top speed) —
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
  player.js           movement: swim / fly / plane mode
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

## Tests

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
