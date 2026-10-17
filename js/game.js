import * as THREE from 'three';
import { MOMENTUM, GAUGE, RECOVERY, DIFFICULTY, SCORING, TIER_ORDER, TIMING, COINS, GAMEOVER, FLIGHT, GATE, WORLD } from './config.js';
import { applyTimingResult, integrateSpeed } from './momentum.js';
import { tierForGauge, applyFill, applyMissDrain, drainFlying, tierTransition } from './gauge.js';
import { profileFor } from './flight-state.js';
import { timingScore, coinScore } from './scoring.js';
import { createGate, crossingSample, mouthHit, createQte, evaluatePress, qteRemaining, gateBehind, gateCadence, reseatSwimGate, resolveGatePlacement } from './timing.js';
import { mulberry32 } from './worldgen.js';
import { createPlayer } from './player.js';
import { bus } from './event-bus.js';
import { createFish, animateFish, setTrailColor } from './fish.js';

const PLAYER_RADIUS = 1.1;

// RunManager + wiring of all gameplay systems (PRD §22, §23).
export async function createGame({ scene, camera, renderer, water, settings, storage = null, fishModel = null }) {
  const fish = createFish(fishModel);
  scene.add(fish.group);

  const { loadModels } = await import('./models.js');
  const { createWorld } = await import('./world.js');
  const { templates, failures } = await loadModels();
  const world = createWorld(scene, templates);
  const { loadCoinModel, createCoins } = await import('./coins.js');
  const coinTemplate = await loadCoinModel();
  const coins = createCoins(scene, coinTemplate);

  const state = {
    phase: 'menu', // 'menu' | 'tutorial' | 'run' | 'paused' | 'results'
    prevPhase: null,
    speed: MOMENTUM.minSpeed,
    gauge: 0,
    tier: 'none',
    prevTier: 'none',
    flying: false,
    locomotion: 'swim',
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
    wings: GAMEOVER.wings,
    endReason: null,
    firstFlightDone: false,
    chargeTime: 0,
  };

  const player = createPlayer(scene, fish);
  player.state.speed = state.speed;

  // ---- phase flow + tutorial script (PRD §2, §3) ----
  let tutorialStep = 0;
    const TUTORIAL_STEPS = [
      { on: 'gate:spawn', text: 'Cross the ring, then hit SPACE inside the window!' },
      { on: 'timing:result', match: 'perfect', text: 'PERFECT! Right inside the window — speed and gauge jump up.' },
      { on: 'tier:up', text: 'Gauge fills! Keep going — at a FULL gauge you launch into the sky.' },
      { on: 'timing:result', match: 'miss', text: 'Window missed? Chain resets — cross the next ring and time your press!' },
      { on: 'timeout', seconds: 5, text: 'Full gauge? Mash SPACE to overfill it — then you fly!' },
    ];

  function startTutorial() {
    restart(state.assist);
    state.phase = 'tutorial';
    tutorialStep = 0;
    bus.emit('tutorial:step', TUTORIAL_STEPS[0]);
  }

  function startRun() {
    restart(state.assist);
    state.phase = 'run';
  }

  function markTutorialDone() { storageSet('ffm.tutorialDone', '1'); }

  function pause() {
    if (state.phase !== 'run' && state.phase !== 'tutorial') return;
    state.prevPhase = state.phase;
    state.phase = 'paused';
    bus.emit('ui:paused', null);
  }

  function resume() {
    if (state.phase !== 'paused') return;
    state.phase = state.prevPhase ?? 'run';
    bus.emit('ui:resumed', null);
  }

  function toMenu() {
    // the menu is not a run: no live gate/QTE may outlive it, or Escape mid-
    // window leaves a phantom applyResult on the menu screen (SPACE there)
    clearGate();
    state.phase = 'menu';
    bus.emit('ui:menu', null);
  }

  function advanceTutorial(type, payload) {
    if (state.phase !== 'tutorial') return;
    const step = TUTORIAL_STEPS[tutorialStep];
    if (!step) return;
    if (step.on === type && (!step.match || step.match === payload)) {
      tutorialStep += 1;
      if (tutorialStep >= TUTORIAL_STEPS.length) {
        state.phase = 'run';
        storageSet('ffm.tutorialDone', '1');
        bus.emit('tutorial:end', null);
        return;
      }
      bus.emit('tutorial:step', TUTORIAL_STEPS[tutorialStep]);
    }
  }

  function storageSet(key, value) {
    try { storage.setItem(key, value); } catch { /* storage disabled */ }
  }
  function storageGet(key) {
    try { return storage.getItem(key); } catch { return null; }
  }

  // ---- ring-triggered QTE lifecycle (2026-10-15) ----
  // one live gate; crossing inside the mouth opens exactly one SPACE window and
  // the press time picks the grade. While a window is pending the gate stays
  // unresolved — the deadline is its only expiry — so every result still feeds
  // applyResult exactly once.
  let activeGate = null;
  let activeQte = null;
  let gateCooldown = 0;
  let gateRng = mulberry32(0x9a7e);

  function trySpawnGate() {
    if (activeGate || state.ended) return;
    // no gates during cinematics/lock-in, and none while sinking: a descending
    // fish has no vertical control, so a portal would be an unavoidable miss
    const loco = player.state.locomotion;
    if (loco === 'charge' || loco === 'leap' || loco === 'descend') return;
    if (!gateCadence(activeGate, gateCooldown)) return;
    activeGate = createGate(gateRng, {
      locomotion: player.state.locomotion,
      playerPos: player.state.position,
      runTime: state.runTime,
      speed: state.speed,
    });
    // place the gate in clear water: clean spawns stay exactly put, mouths a
    // wall row would clip shift forward to the first plane between rows
    // (best-effort — dense water keeps today's clearest-x nudge)
    const placed = resolveGatePlacement(activeGate.x, activeGate.z, world.obstaclesNear(activeGate.z, GATE.placementRange));
    activeGate.x = placed.x;
    activeGate.z = placed.z;
    bus.emit('gate:spawn', activeGate);
    advanceTutorial('gate:spawn');
  }

  function resolveGateResult(result) {
    activeGate.resolved = true;
    applyResult(result);
    bus.emit('gate:resolved', { result, gate: activeGate });
    advanceTutorial('timing:result', result);
    activeGate = null;
    gateCooldown = GATE.cooldown;
  }

  // A press grades the pending window, then everything downstream runs through
  // the shared resolve path (one gate, one result, one cooldown).
  function resolveQte(result) {
    activeQte = null;
    resolveGateResult(result);
  }

  // Launch/descent transitions drop any live gate WITHOUT scoring it. In real
  // play the gauge only fills through applyResult (which runs inside
  // updateGates and nulls the gate in the same call), so a transition never
  // sees a live gate; clearing here keeps that invariant true for debug
  // hooks (debugForceFlight) and future refactors alike.
  function clearGate() { activeGate = null; activeQte = null; }

  function updateGates(prevPos, dt) {
    if (state.ended) return;
    const pos = player.state.position;
    if (activeGate) {
      // swim gates ride the wave: grade and draw read the same center
      if (activeGate.locomotion !== 'fly' && activeGate.locomotion !== 'leap') {
        reseatSwimGate(activeGate, state.runTime);
      }
      const sample = crossingSample(prevPos, pos, activeGate.z);
      if (sample && !activeGate.qteOpened) {
        if (mouthHit(activeGate, sample) === 'inside') {
          activeQte = createQte(activeGate, state.runTime, { assist: state.assist });
          bus.emit('qte:open', activeQte);
        } else {
          resolveGateResult('miss'); // crossed outside the mouth: plain miss, no QTE
          return; // the gate is gone this frame: nothing below may touch it
        }
      }
      if (activeQte && !activeQte.resolved) {
        // a pending QTE owns the gate: no behind-miss until the window expires,
        // or a fast fish (6 m behind < 0.70 s) would double-resolve
        if (qteRemaining(activeQte, state.runTime) <= 0) {
          resolveQte('miss'); // auto-miss on expiry (shared helper — same math as the HUD)
        }
      } else if (gateBehind(activeGate, pos)) {
        resolveGateResult('miss'); // sailed past the portal without entering it
      }
    } else {
      gateCooldown = Math.max(0, gateCooldown - dt);
      trySpawnGate();
    }
  }

  function queuePress() {
    // paused freezes runTime, so a press must not read the window at a frozen
    // clock (it would grade a moment that never happened). It lives here, not
    // in the keydown, because debug hooks press through queuePress too.
    if (state.phase === 'paused') return;
    // a pending window grades on the first press: mash-tapping can't score twice
    // (evaluatePress is idempotent, and the gate resolves in the same call)
    if (activeQte && !activeQte.resolved) {
      resolveQte(evaluatePress(activeQte, state.runTime));
      return;
    }
    // SPACE keeps exactly one job outside a window: the launch spam lever
    if (player.state.locomotion === 'charge') { spamPress(); }
  }

  function profile() { return profileFor(state.tier); }

  function update(dt, input) {
    if (state.phase !== 'run' && state.phase !== 'tutorial') return;

    state.runTime += dt;
    state.distance += state.speed * dt;
    state.difficulty = Math.min(1, Math.max(
      state.distance / DIFFICULTY.rampMeters,
      state.runTime / DIFFICULTY.rampSeconds,
    ));

    // player movement (gate resolution needs the pre-move position to sample
    // the crossing plane without tunneling through it at speed)
    const prevPos = player.state.position.clone();
    player.update(dt, input, gameApi);
    state.speed = player.state.speed;

    // ---- locomotion phase machine (PRD §10: full gauge = flight) ----
    const loco = player.state.locomotion;
    state.locomotion = loco; // mirror for HUD/tests: player state is the source of truth
    state.flying = loco === 'fly' || loco === 'leap';

    // gauge drains only while actually flying, without a recent perfect
    const recentPerfect = (state.runTime - state.lastPerfectAt) < TIMING.recentPerfectSeconds;
    const before = state.gauge;
    state.gauge = loco === 'fly' ? drainFlying(state.gauge, dt, recentPerfect) : state.gauge;
    if (before !== state.gauge) checkTierChange();

    if (player.state.planeExitDamp > 0) player.state.planeExitDamp -= dt;

    switch (loco) {
      case 'charge': {
        // SPAM-QTE: mash to overfill the gauge; the timer forces the blow
        state.chargeTime += dt;
        if (!state.ended && (state.gauge >= GAUGE.max || state.chargeTime >= FLIGHT.launchChargeSeconds)) {
          blowUp();
        }
        break;
      }
      case 'leap': {
        if (player.state.leapT >= 1) enterFlight();
        break;
      }
      case 'fly': {
        if (!state.ended && state.gauge <= 0.01) startDescent();
        break;
      }
      default: {
        // swim: the gauge is full — unlock flight
        if (!state.ended && state.gauge >= GAUGE.maxThreshold) {
          if (!state.firstFlightDone && state.chain >= FLIGHT.gateChain) startCharge();
          else if (state.firstFlightDone) startLeap();
        }
      }
    }

    // momentum gate: resolve the crossing (or a sailed-past miss), then spawn
    // the next gate once the resolved one has cooled down. Gates freeze while
    // the fish is locked in a launch/cinematic.
    const locked = loco === 'charge' || loco === 'leap';
    if (!locked) updateGates(prevPos, dt);

    // obstacle collisions: minor speed loss / major forced descent (PRD §11.3)
    world.update(dt, player.state.position, PLAYER_RADIUS, state.difficulty, state.speed, (hit) => {
      if (hit.major) {
        state.speed = Math.max(MOMENTUM.minSpeed, state.speed - 20);
        state.gauge = Math.min(state.gauge, 25); // forced descent toward water
        player.state.speed = state.speed;
        player.state.squashDip = Math.min(1, player.state.squashDip + 0.6);
        bus.emit('collision:major', hit);
        // a big crash while fragile costs a wing; three and the run is over
        if (TIER_ORDER.indexOf(state.tier) <= GAMEOVER.fragileTierIndex) {
          state.wings -= 1;
          bus.emit('life:lost', state.wings);
          if (state.wings <= 0 && !state.ended) endRun('CRASHED');
        }
      } else {
        state.speed = Math.max(MOMENTUM.minSpeed, state.speed - 8);
        player.state.speed = state.speed;
        bus.emit('collision:minor', hit);
      }
      checkTierChange();
    });

    // shrimp coins: score only, NEVER gauge (PRD §8.2).
    // high trails spawn only when airborne — swimming sees low trails only.
    const airborne = loco !== 'swim' && loco !== 'charge';
    coins.update(dt, player.state.position, () => {
      state.coins += 1;
      state.score += coinValue();
      bus.emit('coin:collect', { coins: state.coins, x: player.state.position.x });
    }, airborne, state.runTime, // runTime phase-locks shrimp to the water shader
      (z, half) => world.obstaclesNear(z, half)); // trails ride the clear lane

    // sustained momentum bonus (PRD §14.2)
    if (TIER_ORDER.indexOf(state.tier) >= TIER_ORDER.indexOf(SCORING.sustainedTier)) {
      state.sustainedTime += dt;
      state.score += SCORING.sustainedPerSecond * dt;
    } else {
      state.sustainedTime = 0;
    }
    state.score += SCORING.perMeter * state.speed * dt;

    // failure: pinned at MinSpeed while airborne (tumbling, not flying) = run over.
    // In the water there's no accumulation — it's the recovery zone.
    const stalled = state.speed <= MOMENTUM.minSpeed + 0.01
      && player.state.position.y > RECOVERY.waterY + 2;
    if (stalled) player.state.airborneTimeAtMin += dt;
    else player.state.airborneTimeAtMin = 0;
    if (!state.ended && player.state.airborneTimeAtMin > RECOVERY.failureAirborneSeconds) {
      endRun('OUT OF MOMENTUM');
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

  function coinValue() {
    return coinScore(state.tier);
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
      state.score += timingScore(result, state.tier, state.chain);
    }
    checkTierChange();
    bus.emit('timing:result', { result, tier: state.tier, speed: state.speed, gauge: state.gauge });
    advanceTutorial('timing:result', result);
    return result;
  }

  // ---- launch sequence: SPAM-QTE -> blow-up -> cinematic leap -> flight ----
  function startCharge() {
    clearGate();
    player.setLocomotion('charge');
    state.chargeTime = 0;
    state.gauge = GAUGE.maxThreshold; // lock at full — overfilling to 120 comes only from spamming
    bus.emit('launch:charge', { first: true });
  }

  function spamPress() {
    if (player.state.locomotion !== 'charge') return;
    state.gauge = Math.min(GAUGE.max, state.gauge + FLIGHT.spamFill);
    state.chargeTime = Math.max(0, state.chargeTime - 0.05); // mashing slightly extends the window
    bus.emit('launch:spam', { gauge: state.gauge });
  }

  function blowUp() {
    clearGate();
    state.gauge = GAUGE.max;
    player.setLocomotion('leap');
    bus.emit('launch:blow', null);
  }

  function startLeap() {
    clearGate();
    player.setLocomotion('leap');
    bus.emit('launch:blow', { instant: true });
  }

  function enterFlight() {
    clearGate();
    player.setLocomotion('fly');
    state.firstFlightDone = true;
    bus.emit('plane:enter', null);
  }

  function startDescent() {
    clearGate();
    player.setLocomotion('descend');
    bus.emit('plane:exit', null);
  }

  function endRun(reason = 'OUT OF MOMENTUM') {
    if (state.ended) return;
    state.ended = true;
    state.endReason = reason;
    state.phase = 'results';
    activeQte = null; // no window outlives a run: no stuck cue, no stale grade
    bus.emit('run:end', { ...state, endReason: reason });
  }

  function restart(assist = state.assist) {
    Object.assign(state, {
      phase: 'run', speed: MOMENTUM.minSpeed, gauge: 0, tier: 'none', prevTier: 'none',
      flying: false, distance: 0, runTime: 0, difficulty: 0,
      coins: 0, score: 0, chain: 0, bestChain: 0,
      counts: { perfect: 0, good: 0, miss: 0 }, lastResult: null,
      lastPerfectAt: -99, sustainedTime: 0, assist, ended: false,
      wings: GAMEOVER.wings, endReason: null,
      locomotion: 'swim', firstFlightDone: false, chargeTime: 0,
    });
    activeGate = null;
    activeQte = null;
    gateCooldown = 0;
    world.reset();
    coins.reset();
    player.setLocomotion('swim');
    Object.assign(player.state, {
      position: new THREE.Vector3(0, RECOVERY.waterY, 0), lateralVel: 0, verticalVel: 0,
      speed: MOMENTUM.minSpeed, planeExitDamp: 0, leapT: 0, chargeShake: 0,
      airborneTimeAtMin: 0, squashDip: 0, pitch: 0, waveRoll: 0,
      launchBaseY: RECOVERY.waterY,
    });
    camera.position.set(0, RECOVERY.waterY + 3.6, -9);
    bus.emit('run:start', null);
  }

  const gameApi = {
    state,
    profile,
    update,
    templates,        // normalized model templates (obstacle kinds), for the sky world
    coinTemplate,     // shrimp model, for sky coin trails
    applyResult,
    restart,
    endRun,
    startRun,
    startTutorial,
    tutorialDone: () => storageGet('ffm.tutorialDone') === '1',
    markTutorialDone,
    pause,
    resume,
    toMenu,
    queuePress,
    gate: () => activeGate,
    qte: () => activeQte,
    debugPress: () => queuePress(),
    // a press evaluated at an explicit run-time, so browser tests read the
    // grade deterministically instead of racing frame pacing. Pause-guarded
    // for the same reason as queuePress: a frozen runTime must not grade.
    debugPressAt: (t) => {
      if (state.phase === 'paused') return null;
      return (activeQte && !activeQte.resolved ? resolveQte(evaluatePress(activeQte, t)) : null);
    },
    // test hook: park the fish on the live gate's plane at ±offsets from its
    // center, so the next crossing resolves deterministically
    debugTeleportToRing: (offX = 0, offY = 0) => {
      if (!activeGate) return null;
      player.state.position.set(activeGate.x + offX, activeGate.y + offY, activeGate.z - 2);
      return { x: player.state.position.x, y: player.state.position.y, z: player.state.position.z };
    },
    player,
    MOMENTUM,
    onWaterEntry: null,
    // landing always returns the fish to the swim phase; main.js wraps this for view swaps
    onLanded: () => player.setLocomotion('swim'),
    debugObstacleCount: () => world.debugCount(),
    debugModelFailures: () => failures,
    debugTeleportToObstacle: () => world.debugTeleport(player),
    debugChunksValid: () => world.debugChunksValid(),
    // test-driver visibility + steering for patterned water: read live hazard
    // discs (movers included), and hold a lateral line. t15/t17/t19 drive
    // these — an unsteered fish is SUPPOSED to wreck itself now.
    debugObstaclesNear: (z, halfRange) => world.obstaclesNear(z, halfRange),
    debugSetLateral: (x) => {
      player.state.position.x = Math.min(WORLD.laneHalfWidth, Math.max(-WORLD.laneHalfWidth, x));
      return player.state.position.x;
    },
    debugTeleportToCoin: () => coins.debugTeleport(player),
    debugCoins: () => coins.debugInfo(),
    debugFish: () => ({ skyfin: !fish.procedural }),
    debugLoseWing: () => {
      state.wings -= 1;
      bus.emit('life:lost', state.wings);
      if (state.wings <= 0 && !state.ended) endRun('CRASHED');
      return state.wings;
    },
    debugSetSpeed: (v) => { state.speed = v; player.state.speed = v; },
    debugSetAltitude: (y) => { player.state.position.y = y; },
    debugForceFlight: () => enterFlight(), // the real transition: also fires plane:enter
    debugSpam: () => spamPress(),
    // hide the ocean world (obstacles + ocean shrimp) while the fish is in the sky
    setOceanVisible: (v) => {
      for (const chunk of world.chunks.values()) chunk.group.visible = v;
      for (const coin of coins.active) coin.group.visible = v;
    },
  };

  return gameApi;
}
