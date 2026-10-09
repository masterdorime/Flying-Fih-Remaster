import * as THREE from 'three';
import { createGame } from './game.js';
import { createWater, createSky } from './water.js';
import { createFish } from './fish.js';
import { createCamera } from './camera.js';
import { defaultSettings, loadSettings, saveSettings } from './settings.js';
import { tierForGauge } from './gauge.js';
import { bus } from './event-bus.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdff3ff, 80, 380);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 4, -9);

createSky(scene);
const water = createWater(scene);
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x2a5a78, 1.25));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
sun.position.set(40, 80, 30);
scene.add(sun);

const settings = loadSettings(globalThis.localStorage ?? {
  getItem: () => null,
  setItem: () => {},
});

const game = createGame({ scene, camera, renderer, water, settings });
const cameraRig = createCamera(camera, settings);

// ---- input ----
const keys = new Set();
const input = { x: 0, y: 0 };
let timingPressAt = null; // performance.now timestamp of a press awaiting buffer evaluation

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') timingPressAt = performance.now() / 1000;
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
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  // gamepad
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    x += pad.axes[0] ?? 0;
    y -= pad.axes[1] ?? 0;
  }
  input.x = Math.max(-1, Math.min(1, x)) * settings.sensitivity;
  input.y = Math.max(-1, Math.min(1, y)) * settings.sensitivity;
}

// ---- loop with clamped dt (tab-switch guard) ----
let last = performance.now();
let frames = 0;
let fps = 60;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  frames++;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  if (game.state.phase === 'run') {
    readInput();
    game.update(dt, input);
    water.update(game.state.runTime);
    bus.emit('frame', { dt, now: now / 1000, input, fps, frames });
  }

  cameraRig.update(dt, game.player.state, game.profile().fov);
  renderer.render(scene, camera);

  window.__FFM = { ready: true, frames, fps: Math.round(fps) };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- debug/automation API (headless verification + F3 overlay) ----
window.__FFM_API = {
  start: (opts = {}) => game.restart(opts.assist ?? settings.assist),
  state: () => ({ ...game.state, position: game.player.state.position.toArray() }),
  setGauge: (v) => {
    game.state.gauge = v;
    game.state.tier = tierForGauge(v);
  },
  applyResult: (r) => game.applyResult(r),
};

document.getElementById('loading').classList.add('hidden');
