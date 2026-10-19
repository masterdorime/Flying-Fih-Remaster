import * as THREE from 'three';
import { createGame } from './game.js';
import { createWater, createSky } from './water.js';
import { createFish } from './fish.js';
import { createCamera } from './camera.js';
import { defaultSettings, loadSettings, saveSettings } from './settings.js';
import { tierForGauge } from './gauge.js';
import { createGateView } from './gate-view.js';
import { createJuice } from './juice.js';
import { createWake } from './wake.js';
import { createHud } from './hud.js';
import { createUi } from './ui.js';
import { createDebug } from './debug.js';
import { createAudio } from './audio.js';
import { createAdaptiveMusicController } from './adaptive-music.js';
import { normalizeSpeed } from './momentum.js';
import { loadSkyfinModel } from './fish.js';
import { MOMENTUM, FLIGHT, ATMOSPHERE } from './config.js';
import { QTE } from './config.js';
import { bus } from './event-bus.js';
import { createClouds } from './clouds.js';
import { createSkyWorld } from './sky-world.js';
import { createSkyDome } from './sky-dome.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral keeps the painted colors of Standard/Phong props without the ACES
// grey; water and sky are custom shaders that don't include the tonemap
// chunk, so their exact look is untouched.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// ONE fog owner (2026-10-19 spec §4.1/T4): the air is defined in config.ATMOSPHERE
// and read by the water shader, the sky dome and the props. createSky used to set a
// second, identical Fog — a silent last-writer-wins duplicate; it no longer does.
scene.fog = new THREE.Fog(ATMOSPHERE.fog.color, ATMOSPHERE.fog.near, ATMOSPHERE.fog.far);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 4, -9);

const sky = await createSky(scene);
const water = createWater(scene);

// painted props (fish/rocks/boats/shrimp) pick up soft sky reflections from the
// day skybox, so the Skyfin's Standard material reads with the ambient gloss
// the concept render has. Phong props and the custom water/sky shaders don't
// sample scene.environment — their look is unchanged.
try {
  if (scene.background) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromEquirectangular(scene.background);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }
} catch { /* environment optional: lights alone must carry the scene */ }

// The OCEAN's visible sky is the crafted dome (spec §4.5/T9), NOT the photograph. The day
// equirect stays the source of scene.environment above — props keep their sky reflections —
// but it is no longer what the camera sees, because that photo carries its own painted sea
// and its own horizon: the water could never meet it, which is the hard dark band on the
// horizon. The dome's horizon colour IS the fog colour, so sea and sky meet by construction.
const skyDome = createSkyDome(scene);
// beyond the dome there is nothing to photograph: a flat horizon-coloured background is the
// safe fallback and matches the dome and the water's far colour exactly
scene.background = new THREE.Color(ATMOSPHERE.fog.color);

// character lighting: a bright sky/ground hemisphere plus a warm key and a cool
// camera-side fill, so the Skyfin's painted skin reads from the chase camera.
// (Water and sky are a custom shader / background texture — these lights only
// touch Standard-material props: fish, rocks, boats, shrimp.)
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x2a5a78, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
sun.position.set(40, 80, 30);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfe3ff, 0.9);
fill.position.set(-30, 20, -40);
scene.add(fill);
// rim from behind the fish: separates the wings from the sky they fly toward
const rim = new THREE.DirectionalLight(0xd8ecff, 1.5);
rim.position.set(0, 45, -75);
scene.add(rim);

const settings = loadSettings(globalThis.localStorage ?? {
  getItem: () => null,
  setItem: () => {},
});

// load the player fish model (falls back to the procedural fish if missing)
const skyfinModel = await loadSkyfinModel();

const game = await createGame({ scene, camera, renderer, water, settings, storage: globalThis.localStorage ?? null, fishModel: skyfinModel });
const cameraRig = createCamera(camera, settings);
const juice = createJuice();
const wake = createWake(scene); // surface-contact ribbon + ripple pool (swim only)
const gateView = createGateView(scene);
const hud = createHud(document.body);
const ui = createUi(document.body, { storage: globalThis.localStorage ?? undefined });
const debug = createDebug(document.body);
const audio = createAudio(settings, bus);

// two environments: the ocean below the cloud curtain, the sky world above it
const clouds = createClouds(scene);
const skyWorld = createSkyWorld(scene, game.templates, game.coinTemplate);
skyWorld.group.visible = false; // the sky exists only above the clouds
bus.on('run:start', () => skyWorld.reset(game.player.state.position.z));
bus.on('run:start', () => wake.reset());
// takeoff + landing bursts originate at the body-water contact point
bus.on('launch:charge', () => wake.burst(game.player.state.position.x, game.player.state.position.z, 6));
bus.on('launch:blow', () => wake.burst(game.player.state.position.x, game.player.state.position.z, 8));
bus.on('plane:exit', () => wake.burst(game.player.state.position.x, game.player.state.position.z, 4));

// adaptive music: ladder tracks crossfaded by normalized momentum (game speed)
const music = createAdaptiveMusicController({
  ctx: audio.getContext(),
  destination: audio.musicBus(),
});
const musicLoad = await music.load();
await audio.loadFiles();
console.info(`[music] ${musicLoad.loaded} tracks loaded, ${audio.stats.filesLoaded} audio files`, musicLoad.failed.length ? `(missing: ${musicLoad.failed.join(', ')})` : '');
// if a run started before the tracks finished decoding, retire the synth bed now
if (musicLoad.loaded > 0 && game.state.phase === 'run') audio.stopMusic();

// ---- input ----
const keys = new Set();
const input = { x: 0, y: 0 };

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  audio.resume();
  if (e.code === 'Space') game.queuePress();
  if (e.code === 'Escape') bus.emit('ui:pause', null);
  if (e.code === 'F3') bus.emit('ui:debug', null);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function readInput() {
  let x = 0, y = 0;
  // Camera sits behind the fish looking down +Z, so world -X is screen RIGHT.
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x += 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x -= 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  // gamepad
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    x -= pad.axes[0] ?? 0;
    y -= pad.axes[1] ?? 0;
  }
  input.x = Math.max(-1, Math.min(1, x)) * settings.sensitivity;
  input.y = Math.max(-1, Math.min(1, y)) * settings.sensitivity;
}

// ---- two-environment swap: day sky below the clouds, space sky above ----
let environment = 'ocean';
const dayBg = scene.background;
let spaceBg = null;
new THREE.TextureLoader()
  .loadAsync('assets/models/skyboxes/skybox-space.png')
  .then(t => { t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; spaceBg = t; })
  .catch(() => { /* placeholder missing: the day sky simply stays */ });

function updateEnvironment(y) {
  // hysteresis so the swap doesn't flicker right at the curtain
  const above = environment === 'sky' ? y > FLIGHT.cloudY - 6 : y > FLIGHT.cloudY + 6;
  if (above === (environment === 'sky')) return;
  environment = above ? 'sky' : 'ocean';
  if (above && spaceBg) scene.background = spaceBg;
  if (!above) scene.background = dayBg;
  water.mesh.visible = !above;
  skyWorld.group.visible = above;
  skyDome.setVisible(!above); // the crafted dome is the OCEAN's sky only (T9)
  // the curtain also hides the ocean world itself: obstacles + ocean shrimp
  game.setOceanVisible(!above);
}

// ---- loop with clamped dt (tab-switch guard) ----
let last = performance.now();
let frames = 0;
let fps = 60;
let timeScale = 1;
let lowFpsFor = 0;
function loop(now) {
  const realDt = (now - last) / 1000;            // true frame time (never clamped)
  const dt = Math.min(realDt, 0.05) * timeScale; // sim step: clamped against tab-switch jumps
  last = now;
  frames++;
  fps = fps * 0.95 + (1 / Math.max(realDt, 1e-3)) * 0.05;

  // adaptive quality: sustained low fps -> drop resolution (PRD §26.3)
  if (fps < 45) { lowFpsFor += dt; } else { lowFpsFor = Math.max(0, lowFpsFor - dt * 2); }
  if (lowFpsFor > 3 && renderer.getPixelRatio() > 1) renderer.setPixelRatio(1);

  if (game.state.phase === 'run' || game.state.phase === 'tutorial') {
    readInput();
    game.update(dt, input);
    // wake churn follows the fish only while it touches water; airborne the
    // water stays undisturbed (strength floor 0.12 keeps faint contact at rest)
    const loco = game.player.state.locomotion;
    const swimming = loco === 'swim' || loco === 'charge';
    const ps = game.player.state;
    let wakeU = null;
    if (swimming) {
      const len = Math.hypot(ps.lateralVel, ps.speed) || 1;
      wakeU = {
        dirX: ps.lateralVel / len, dirZ: ps.speed / len,
        strength: Math.min(1, Math.max(0.12, (ps.speed - 8) / 60)),
      };
    }
    water.update(game.state.runTime, game.player.state.position, wakeU, game.nearHulls());
    wake.update(dt, game.player.state, game.player.state.locomotion, game.state.runTime);
    // sky/curtain ride along with the fish; the swap is altitude-driven
    const p = game.player.state.position;
    clouds.update(dt, p);
    skyDome.update(game.state.runTime, p);
    updateEnvironment(p.y);
    if (skyWorld.group.visible) skyWorld.update(dt, p);
    // the camera owns itself during the cinematic leap
    cameraRig.setCinematic(game.player.state.locomotion === 'leap', game.player.state.leapT);
    // adaptive soundtrack rides the same speed value the game uses (single source of truth)
    const momentum = normalizeSpeed(game.state.speed, MOMENTUM.minSpeed, 110);
    music.setMomentum(momentum);
    audio.setWind(momentum);
  } else {
    cameraRig.setCinematic(false, 0);
  }

  // momentum gate: rendered in world space ahead of the fish — no overlay
  // covers the chase view, and swim gates ride the wave via surfaceHeight
  gateView.update(dt, game.gate(), game.player.state.position, game.state.runTime, game.player.state.locomotion);

  hud.update(game.state);
  hud.updateQte(game.qte(), game.state.runTime); // press window cue (drains on runTime)
  const musicDbg = music.debugState();
  // full audio chain on one line: transport + rung, files, music slider,
  // controller bus, context state, master/sfx sliders — a silence report is
  // settled by reading this line, no guessing
  const musicLine = `music      ${musicDbg.playing ? (musicDbg.rung ?? 'starting') + (musicDbg.menuActive ? ' (menu)' : '') : 'off'}`
    + ` t${musicDbg.tracksLoaded}/${musicDbg.tracksLoaded + musicDbg.failed.length}`
    + (musicDbg.failed.length ? ` missing:${musicDbg.failed.join(',')}` : '')
    + ` vol:${settings.music}${musicDbg.muted ? ' MUTED' : ''}`
    + ` ctx:${musicDbg.contextState ?? '?'} bus:${musicDbg.busGain ?? '?'} m:${settings.master}/s:${settings.sfx}`;
  debug.update(game.state, { windows: { perfect: QTE.perfectWindow, good: QTE.goodWindow } }, Math.round(fps), musicLine);

  // speed lines scale with speed and the post-FX setting (PRD §18.2)
  const sim = game.state;
  juice.setSpeedLines(Math.min(1, Math.max(0, (sim.speed - 30) / 80)) * settings.postFx *
    (sim.phase === 'run' || sim.phase === 'tutorial' ? 1 : 0));

  cameraRig.update(dt, game.player.state, game.profile().fov);
  renderer.render(scene, camera);

  window.__FFM = { ready: true, frames, fps: Math.round(fps) };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- UI wiring: UI calls commands, never mutates game state directly ----
ui.commands.onStart = (s) => {
  Object.assign(settings, s);
  saveSettings(localStorageSafe(), settings);
  game.state.assist = settings.assist;
  ui.hideTutorial();
  ui.show(null);
  if (!game.tutorialDone() && !settings.assist) game.startTutorial();
  else game.startRun();
};
ui.commands.onResume = () => { ui.show(null); game.resume(); };
ui.commands.onPause = () => { game.pause(); };
ui.commands.onRestart = (s) => {
  Object.assign(settings, s);
  saveSettings(localStorageSafe(), settings);
  game.state.assist = settings.assist;
  ui.hideTutorial();
  ui.show(null);
  game.startRun();
};
ui.commands.onMenu = () => { game.toMenu(); };
ui.commands.onSkipTutorial = () => {
  ui.hideTutorial();
  game.markTutorialDone();
  game.startRun();
};
ui.commands.onSettingsChange = (s) => {
  Object.assign(settings, s);
  game.state.assist = settings.assist;
  juice.setSpeedLines(settings.postFx);
  audio.applySettings(s);
};

function localStorageSafe() {
  return globalThis.localStorage ?? { getItem: () => null, setItem: () => {} };
}

bus.on('ui:paused', () => ui.show('pause'));
bus.on('ui:menu', () => { ui.show('menu'); ui.refreshBest(); music.setMenuMode(true); });
bus.on('run:end', () => { music.pause(); ui.showResults(game.state); });

// ---- adaptive music + ambience transport ----
let musicStarted = false;
function startMusicAfterGesture() {
  audio.resume(); // safe to call repeatedly; unlocks audio inside the gesture
  if (musicStarted) return;
  musicStarted = true;
  if (!music.debugState().playing) music.play();
  music.setMenuMode(true);    // menu song until a run begins
}
window.addEventListener('keydown', startMusicAfterGesture, { once: false });
window.addEventListener('pointerdown', startMusicAfterGesture, { once: false });

function enterRunMusic() {
  startMusicAfterGesture();
  music.setMenuMode(false);
  if (music.hasFiles()) audio.stopMusic(); // real soundtrack replaces the synth bed
  else audio.startMusic();                 // no files -> keep the synth fallback
  music.setMomentum(0);
  music.play();
}
bus.on('run:start', enterRunMusic);

// UI click sound on every menu/screen button
document.querySelectorAll('.ffm-buttons button, #ffm-tutorial-skip').forEach(btn => {
  btn.addEventListener('click', () => audio.sfx.ui());
});
bus.on('tutorial:step', (step) => ui.showTutorial(step.text));
bus.on('tutorial:end', () => ui.hideTutorial());
bus.on('ui:pause', () => { if (game.state.phase === 'run' || game.state.phase === 'tutorial') game.pause(); });
bus.on('ui:debug', () => debug.toggle());

// TEMPORARY music test panel: ?musicdebug=1 in the URL or press F4. Remove before release.
let musicPanel = null;
async function toggleMusicPanel() {
  if (musicPanel) {
    musicPanel.remove();
    musicPanel = null;
    music.setMenuMode(true); // back to menu song outside the panel
    return;
  }
  const { createMusicTestPanel } = await import('./music-test-panel.js');
  startMusicAfterGesture();
  music.setMenuMode(false); // panel drives the ladder directly
  musicPanel = createMusicTestPanel(music);
}
if (new URLSearchParams(location.search).has('musicdebug')) {
  toggleMusicPanel(); // starts audio inside the call chain, panel drives the ladder
}
window.addEventListener('keydown', e => { if (e.code === 'F4') { e.preventDefault(); toggleMusicPanel(); } });
bus.on('collision:minor', () => {
  juice.popup('CRASH', '#ff9f43', true);
  cameraRig.shake(0.25);
});
bus.on('life:lost', (wings) => {
  juice.popup(wings > 0 ? `WING LOST — ${wings} LEFT` : 'NO WINGS LEFT', wings > 0 ? '#ff8fa3' : '#ff4d4d');
  if (wings > 0) cameraRig.shake(0.5);
});
bus.on('coin:collect', () => {
  juice.popup('COIN', '#ffd54a', true);
});
bus.on('collision:major', () => {
  juice.popup('BIG CRASH', '#ff4d4d');
  cameraRig.shake(0.6);
});
// result feedback lives on gate:resolved (one popup, one flash); timing:result
// only does the camera reaction
bus.on('timing:result', ({ result }) => {
  if (result === 'perfect') cameraRig.kick(0.35);
  else if (result === 'good') cameraRig.kick(0.15);
  else cameraRig.shake(0.4);
});
bus.on('gate:resolved', ({ result }) => {
  const map = { perfect: ['PERFECT', '#ffd54a'], good: ['GOOD', '#7dff9a'], miss: ['MISS', '#ff5e5b'] };
  const [text, color] = map[result] ?? [result, '#9fb3c8'];
  juice.popup(text, color);
  gateView.flash(result); // flash lifetime owned by the view
});
bus.on('tier:up', () => juice.popup('TIER UP', '#9dff7a', true));
bus.on('tier:down', () => {
  // draining in the sky is the flight timer, not a power-down: don't spam the popup
  if (game.state.flying) return;
  juice.popup('POWER DOWN', '#ff9f43');
  cameraRig.shake(0.3);
});
bus.on('tier:up', () => audio.setMusicIntensity(game.state.tier));
bus.on('tier:down', () => audio.setMusicIntensity(game.state.tier));
bus.on('plane:enter', () => {
  juice.popup('MAX FLIGHT', '#ff4d6d');
  cameraRig.kick(0.6);
});
bus.on('plane:exit', () => juice.popup('POWER DOWN', '#ff9f43'));

// ---- launch ritual announcements + slow-mo punch through the clouds ----
bus.on('launch:charge', () => juice.popup('SPAM SPACE!', '#7dff9a', true));
let scaleBeforeLeap = 1;
bus.on('launch:blow', () => {
  juice.popup('LIFTOFF!', '#ffd54a', true);
  scaleBeforeLeap = timeScale; // restore what the player/debug had, not a hard 1
  timeScale = 0.35;            // ~0.8s of slow-mo through the curtain (HANDOFF spec)
  setTimeout(() => { timeScale = scaleBeforeLeap; }, 800);
  cameraRig.shake(0.4);
});

// boot state: main menu
game.state.assist = settings.assist;
ui.show('menu');

// ---- debug/automation API (headless verification + F3 overlay) ----
window.__FFM_API = {
  start: (opts = {}) => {
    game.state.assist = opts.assist ?? settings.assist;
    ui.show(null); ui.hideTutorial();
    if (opts.tutorial) game.startTutorial(); else game.startRun();
  },
  pause: () => game.pause(),
  resume: () => { ui.show(null); game.resume(); },
  menu: () => game.toMenu(),
  tutorialDone: () => game.tutorialDone(),
  endRun: () => game.endRun(),
  state: () => ({ ...game.state, position: game.player.state.position.toArray() }),
  setGauge: (v) => {
    game.state.gauge = v;
    game.state.tier = tierForGauge(v);
  },
  applyResult: (r) => game.applyResult(r),
  gate: () => game.gate(),
  qte: () => game.qte(),
  debugPress: () => game.debugPress(),
  debugPressAt: (t) => game.debugPressAt(t),
  debugGateFlash: () => gateView.debugInfo(),
  debugTeleportToRing: (offX = 0, offY = 0) => game.debugTeleportToRing(offX, offY),
  debugObstacleCount: () => game.debugObstacleCount(),
  debugModelFailures: () => game.debugModelFailures(),
  debugTeleportToObstacle: (nth) => game.debugTeleportToObstacle(nth),
  debugChunksValid: () => game.debugChunksValid(),
  debugObstaclesNear: (z, halfRange) => game.debugObstaclesNear(z, halfRange),
  debugSetLateral: (x) => game.debugSetLateral(x),
  debugCoins: () => game.debugCoins(),
  debugFish: () => game.debugFish(),
  seed: () => game.state.runSeed ?? 0,
  debugWake: () => wake.debugInfo(),
  debugLoseWing: () => game.debugLoseWing(),
  debugRestart: () => game.restart(),
  debugSetSpeed: (v) => game.debugSetSpeed(v),
  debugSetAltitude: (y) => game.debugSetAltitude(y),
  debugSetDistance: (m) => game.debugSetDistance(m),
  debugForceFlight: () => game.debugForceFlight(),
  debugSpam: () => game.debugSpam(),
  debugEnvironment: () => environment,
  // live fog vs the config it must come from (T4): reported together so a browser
  // test can prove the ONE owner without duplicating the numbers in the test.
  debugFog: () => ({
    scene: scene.fog
      ? { color: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far }
      : null,
    config: { color: ATMOSPHERE.fog.color, near: ATMOSPHERE.fog.near, far: ATMOSPHERE.fog.far },
  }),
  debugVisibility: () => ({
    sky: skyWorld.group.visible,
    water: water.mesh.visible,
    skyInfo: skyWorld.debugInfo(game.player.state.position.z),
  }),
  debugTeleportToCoin: () => game.debugTeleportToCoin(),
  debugTeleportFar: (z) => { game.player.state.position.z = z; },
  debugCameraPos: () => camera.position.toArray(),
  debugCameraFov: () => camera.fov,
  debugScene: () => scene,
  debugShakeOffset: () => cameraRig.shakeOffset(),
  debugBanking: () => game.player.state.banking,
  debugInput: () => ({ ...input, keys: [...keys] }),
  debugAudioStats: () => audio.stats,
  debugResumeAudio: () => audio.resume(),
  debugMusic: () => music.debugState(),
  // 1.5s test tone through the SAME destination node the music ladder uses.
  // Silence triage: tone audible -> path to speakers works, fault is inside
  // the controller (track gains/sources); tone silent while SFX sound ->
  // the musicGain node/wiring; both silent -> system output.
  debugMusicTest: () => {
    const ctx = audio.getContext();
    if (!ctx) return { ok: false, reason: 'no audio context' };
    try {
      const dest = audio.musicBus();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05);
      g.gain.setValueAtTime(0.5, t0 + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      osc.connect(g);
      g.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 1.6);
      const m = music.debugState();
      return {
        ok: true, ctxState: ctx.state, destGain: dest?.gain?.value ?? null,
        settings: { master: settings.master, music: settings.music, sfx: settings.sfx },
        music: { playing: m.playing, rung: m.rung, busGain: m.busGain, muted: m.muted, targets: m.targets },
      };
    } catch (e) { return { ok: false, reason: e.message }; }
  },
  debugMusicMissing: async () => {
    await music.load([{ id: '__bogus__', file: 'does-not-exist.mp3', at: 0, rungIndex: -1, volume: 0 }]);
    return 'ok';
  },
  setTimeScale: (n) => { timeScale = Math.max(0.25, Math.min(8, n)); },
  setSettingsShake: (v) => { settings.cameraShake = v; },
};

document.getElementById('loading').classList.add('hidden');
