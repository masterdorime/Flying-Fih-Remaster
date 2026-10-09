import * as THREE from 'three';
import { MOMENTUM, GAUGE, RECOVERY, PLANE, DIFFICULTY, SCORING, TIER_ORDER } from './config.js';
import { applyTimingResult, integrateSpeed } from './momentum.js';
import { tierForGauge, applyFill, applyMissDrain, drainFlying, tierTransition } from './gauge.js';
import { profileFor, planeModeAllowed } from './flight-state.js';
import { createPlayer } from './player.js';
import { bus } from './event-bus.js';
import { createFish, animateFish, setTrailColor } from './fish.js';

// RunManager + wiring of all gameplay systems (PRD §22, §23).
export function createGame({ scene, camera, renderer, water, settings }) {
  const fish = createFish();
  scene.add(fish.group);

  const state = {
    phase: 'run', // 'menu' | 'tutorial' | 'run' | 'paused' | 'results'
    prevPhase: null,
    speed: MOMENTUM.minSpeed,
    gauge: 0,
    tier: 'none',
    prevTier: 'none',
    flying: false,
    planeMode: false,
    distance: 0,
    runTime: 0,
    difficulty: 0,
    coins: 0,
    score: 0,
    chain: 0,
    bestChain: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
    lastResult: null,
    lastPerfectAt: -99,
    sustainedTime: 0,
    assist: settings.assist,
    ended: false,
  };

  const player = createPlayer(scene, fish);
  player.state.speed = state.speed;

  function profile() { return profileFor(state.tier); }

  function update(dt, input) {
    if (state.phase === 'paused' || state.phase === 'results') return;

    state.runTime += dt;
    state.distance += state.speed * dt;
    state.difficulty = Math.min(1, Math.max(
      state.distance / DIFFICULTY.rampMeters,
      state.runTime / DIFFICULTY.rampSeconds,
    ));

    // player movement
    player.update(dt, input, gameApi);
    state.speed = player.state.speed;
    state.flying = state.tier !== 'none';

    // gauge drain while flying without a recent perfect
    const recentPerfect = (state.runTime - state.lastPerfectAt) < 2;
    const before = state.gauge;
    state.gauge = state.flying ? drainFlying(state.gauge, dt, recentPerfect) : state.gauge;
    if (before !== state.gauge) checkTierChange();

    // plane mode entry/exit (player request: full gauge = plane)
    if (!state.planeMode && planeModeAllowed(state.tier)) enterPlaneMode();
    if (state.planeMode && !planeModeAllowed(state.tier)) exitPlaneMode();

    if (player.state.planeExitDamp > 0) player.state.planeExitDamp -= dt;

    // sustained momentum bonus (PRD §14.2)
    if (TIER_ORDER.indexOf(state.tier) >= TIER_ORDER.indexOf(SCORING.sustainedTier)) {
      state.sustainedTime += dt;
      state.score += SCORING.sustainedPerSecond * dt;
    } else {
      state.sustainedTime = 0;
    }
    state.score += SCORING.perMeter * state.speed * dt;

    // failure: stuck at min speed in the air
    if (!state.ended && player.state.airborneTimeAtMin > RECOVERY.failureAirborneSeconds) {
      endRun();
    }

    // animate character
    setTrailColor(fish, profile().trailColor);
    animateFish(fish, {
      time: state.runTime,
      speed: state.speed,
      wingScale: profile().wingScale,
      stretch: player.state.stretch - player.state.squashDip,
      banking: player.state.banking,
    });
  }

  function checkTierChange() {
    const next = tierForGauge(state.gauge);
    if (next !== state.tier) {
      state.prevTier = state.tier;
      state.tier = next;
      const dir = tierTransition(state.prevTier, state.tier);
      if (dir === 'up') bus.emit('tier:up', state.tier);
      if (dir === 'down') bus.emit('tier:down', state.tier);
    }
  }

  // Apply a timing result end-to-end (PRD core event contract).
  function applyResult(result) {
    if (state.phase !== 'run') return null;
    state.lastResult = result;
    state.prevTier = state.tier;
    state.speed = applyTimingResult(state.speed, state.tier, result);
    player.state.speed = state.speed;
    if (result === 'miss') {
      state.gauge = applyMissDrain(state.gauge);
      state.chain = 0;
      state.counts.miss += 1;
    } else {
      state.gauge = applyFill(state.gauge, result);
      state.lastPerfectAt = result === 'perfect' ? state.runTime : state.lastPerfectAt;
      state.chain += 1;
      state.bestChain = Math.max(state.bestChain, state.chain);
      state.counts[result] += 1;
    }
    checkTierChange();
    bus.emit('timing:result', { result, tier: state.tier, speed: state.speed, gauge: state.gauge });
    return result;
  }

  function enterPlaneMode() {
    state.planeMode = true;
    bus.emit('plane:enter', null);
  }

  function exitPlaneMode() {
    state.planeMode = false;
    player.state.planeExitDamp = PLANE.exitDampSeconds;
    bus.emit('plane:exit', null);
  }

  function endRun() {
    state.ended = true;
    state.phase = 'results';
    bus.emit('run:end', { ...state });
  }

  function restart(assist = state.assist) {
    Object.assign(state, {
      phase: 'run', speed: MOMENTUM.minSpeed, gauge: 0, tier: 'none', prevTier: 'none',
      flying: false, planeMode: false, distance: 0, runTime: 0, difficulty: 0,
      coins: 0, score: 0, chain: 0, bestChain: 0,
      counts: { perfect: 0, good: 0, miss: 0 }, lastResult: null,
      lastPerfectAt: -99, sustainedTime: 0, assist, ended: false,
    });
    Object.assign(player.state, {
      position: new THREE.Vector3(0, RECOVERY.waterY, 0), lateralVel: 0, verticalVel: 0,
      speed: MOMENTUM.minSpeed, planeExitDamp: 0,
      airborneTimeAtMin: 0, squashDip: 0,
    });
    camera.position.set(0, RECOVERY.waterY + 3.6, -9);
    bus.emit('run:start', null);
  }

  const gameApi = {
    state,
    profile,
    update,
    applyResult,
    restart,
    endRun,
    player,
    MOMENTUM,
    onWaterEntry: null,
  };

  return gameApi;
}
