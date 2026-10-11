import * as THREE from 'three';
import { createGame } from './game.js';
import { createWater, createSky } from './water.js';
import { createFish } from './fish.js';
import { createCamera } from './camera.js';
import { defaultSettings, loadSettings, saveSettings } from './settings.js';
import { tierForGauge } from './gauge.js';
import { createTimingRing } from './timing-view.js';
import { createJuice } from './juice.js';
import { createHud } from './hud.js';
import { createUi } from './ui.js';
import { createDebug } from './debug.js';
import { createAudio } from './audio.js';
import { createAdaptiveMusicController } from './adaptive-music.js';
import { normalizeSpeed } from './momentum.js';
import { loadSkyfinModel } from './fish.js';
import { MOMENTUM } from './config.js';
import { currentWindows } from './timing.js';
import { bus } from './event-bus.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe8f5, 120, 480);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 4, -9);

const sky = await createSky(scene);
const water = createWater(scene);
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x2a5a78, 1.25));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
sun.position.set(40, 80, 30);
scene.add(sun);

const settings = loadSettings(globalThis.localStorage ?? {
  getItem: () => null,
  setItem: () => {},
});

// load the player fish model (falls back to the procedural fish if missing)
const skyfinModel = await loadSkyfinModel();

const game = await createGame({ scene, camera, renderer, water, settings, storage: globalThis.localStorage ?? null, fishModel: skyfinModel });
const cameraRig = createCamera(camera, settings);
const juice = createJuice();
const ring = createTimingRing();
scene.add(ring.group);
const hud = createHud(document.body);
const ui = createUi(document.body, { storage: globalThis.localStorage ?? undefined });
const debug = createDebug(document.body);
const audio = createAudio(settings, bus);

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
    water.update(game.state.runTime, game.player.state.position);
    // adaptive soundtrack rides the same speed value the game uses (single source of truth)
    const momentum = normalizeSpeed(game.state.speed, MOMENTUM.minSpeed, 110);
    music.setMomentum(momentum);
    audio.setWind(momentum);
  }

  // timing ring follows the fish and faces the camera
  const prompt = game.getActivePrompt();
  if (prompt && (game.state.phase === 'run' || game.state.phase === 'tutorial')) {
    ring.group.visible = true;
    const p = game.player.state.position;
    ring.group.position.set(p.x, p.y + 2.8, p.z + 7);
    ring.group.quaternion.copy(camera.quaternion);
    ring.setProgress((game.state.runTime - prompt.spawnTime) / (prompt.expiresAt - prompt.spawnTime));
  } else {
    ring.group.visible = false;
  }

  hud.update(game.state);
  debug.update(game.state, { windows: currentWindows(game.state.speed, { assist: game.state.assist }) }, Math.round(fps));

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
bus.on('timing:result', ({ result }) => {
  if (result === 'perfect') {
    juice.popup('PERFECT', '#ffd54a');
    cameraRig.kick(0.35);
  } else if (result === 'good') {
    juice.popup('GOOD', '#7dff9a', true);
    cameraRig.kick(0.15);
  } else {
    juice.popup('MISS', '#ff5e5b');
    cameraRig.shake(0.4);
  }
});
bus.on('prompt:expired', () => juice.popup('MISSED', '#9fb3c8', true));
bus.on('prompt:spawn', () => ring.resetColors());
bus.on('tier:up', () => juice.popup('TIER UP', '#9dff7a', true));
bus.on('tier:down', () => {
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
  prompt: () => {
    const p = game.getActivePrompt();
    return p ? { spawnTime: p.spawnTime, perfectAt: p.perfectAt, expiresAt: p.expiresAt } : null;
  },
  pressAt: (t) => game.pressAt(t),
  debugObstacleCount: () => game.debugObstacleCount(),
  debugModelFailures: () => game.debugModelFailures(),
  debugTeleportToObstacle: () => game.debugTeleportToObstacle(),
  debugCorridorClear: () => game.debugCorridorClear(),
  debugCoins: () => game.debugCoins(),
  debugFish: () => game.debugFish(),
  debugLoseWing: () => game.debugLoseWing(),
  debugSetSpeed: (v) => game.debugSetSpeed(v),
  debugSetAltitude: (y) => game.debugSetAltitude(y),
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
  debugMusicMissing: async () => {
    await music.load([{ id: '__bogus__', file: 'does-not-exist.mp3', at: 0, rungIndex: -1, volume: 0 }]);
    return 'ok';
  },
  setTimeScale: (n) => { timeScale = Math.max(0.25, Math.min(8, n)); },
  setSettingsShake: (v) => { settings.cameraShake = v; },
};

document.getElementById('loading').classList.add('hidden');
