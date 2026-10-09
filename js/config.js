// All tunable gameplay values (PRD §24, §33). Nothing gameplay-critical is hard-coded elsewhere.

export const TIER_ORDER = ['none', 'low', 'medium', 'high', 'max'];

export const MOMENTUM = {
  minSpeed: 8,
  maxSpeed:    { none: 25, low: 35, medium: 50, high: 70, max: 110 },
  acceleration:{ none: 35, low: 45, medium: 60, high: 80, max: 120 },
  dragSwim: 1.5,
  dragFly: 0.6,
  overshootHeadroom: 12, // speed may exceed tier cap by this much after a boost before drag pulls back
};

export const TIMING = {
  perfectWindow: 0.07,
  goodWindow: 0.18,
  minPerfectWindow: 0.035,
  minGoodWindow: 0.09,
  promptLifetime: 2.2,
  recentPerfectSeconds: 2, // "recent perfect" stops the flying drain
};

export const GAUGE = {
  max: 120,
  fillPerfect: 12,
  fillGood: 5,
  drainFlying: 3.5,          // per second while flying without a recent perfect
  missDrainMultiplier: 1.8,  // instant extra drain on miss
  lowMax: 30,
  mediumMax: 70,
  highMax: 99.9,
  maxThreshold: 100,
};

export const SPEED_BOOST = {
  perfect: { none: 12, low: 12, medium: 16, high: 22, max: 30 },
  good:    { none: 6,  low: 6,  medium: 8,  high: 11, max: 15 },
  miss:    { none: -18, low: -18, medium: -28, high: -45, max: -70 },
};

export const TIER_PROFILE = {
  none:   { maxSpeed: 25,  accel: 35,  turnRate: 120, gravityScale: 1.0,  fov: 60, airControl: 0.6,  trailColor: '#8fd3ff', wingScale: 0.0 },
  low:    { maxSpeed: 35,  accel: 45,  turnRate: 140, gravityScale: 0.85, fov: 65, airControl: 0.75, trailColor: '#9dff7a', wingScale: 0.6 },
  medium: { maxSpeed: 50,  accel: 60,  turnRate: 160, gravityScale: 0.7,  fov: 72, airControl: 0.9,  trailColor: '#ffd54a', wingScale: 0.8 },
  high:   { maxSpeed: 70,  accel: 80,  turnRate: 180, gravityScale: 0.55, fov: 80, airControl: 1.0,  trailColor: '#ff9430', wingScale: 1.0 },
  max:    { maxSpeed: 110, accel: 120, turnRate: 200, gravityScale: 0.4,  fov: 95, airControl: 1.0,  trailColor: '#ff4d6d', wingScale: 1.3 },
};

export const PLANE = {
  climbCeiling: 120,        // soft max altitude in plane mode
  climbRate: 26,            // m/s with pitch input
  exitDampSeconds: 0.5,     // brief control damp after powering down from plane mode
};

export const RECOVERY = {
  relaunchGauge: 8,   // gauge needed to launch from water back to flight
  relaunchSpeed: 15,  // forward speed needed to launch
  waterY: 0.6,        // swimming ride height
  failureAirborneSeconds: 1.5, // speed at min while airborne this long = run over
};

export const WORLD = {
  chunkLength: 120,
  chunksAhead: 3,
  chunksBehind: 2,
  laneHalfWidth: 14,   // playable lateral bounds
  corridorHalfWidth: 5 // obstacles never enter this central corridor (safety, PRD §12.4)
};

export const DIFFICULTY = {
  rampMeters: 3500,          // distance over which difficulty reaches 1.0
  rampSeconds: 90,           // time over which difficulty reaches 1.0 (whichever comes first)
  promptIntervalStart: 2.4,
  promptIntervalEnd: 1.1,
  obstacleDensityStart: 0.12,
  obstacleDensityEnd: 0.85,
};

export const COLLISION = {
  minorSpeedLoss: 8,
  majorSpeedLoss: 20,
  graceSeconds: 0.5, // same obstacle can't re-hit within this window
};

export const COINS = {
  scoreValue: 250,
  magnetRadius: 1.2,
};

export const SCORING = {
  perMeter: 1,
  perfect: 500,
  good: 150,
  sustainedPerSecond: 50,
  sustainedTier: 'medium',   // bonus accrues at medium tier or above
};

export const CAMERA = {
  baseFov: 60,
  maxFov: 100,
  fovSpeedResponse: 0.15,
  positionLag: 0.12,
  tierUpKick: 0.35,
  missShake: 0.4,
  distance: 9,
  height: 3.6,
  lookAhead: 12,
};

export const ASSIST = {
  windowScale: 1.6,    // timing windows wider
  speedScale: 0.85,    // top speed multiplier
};

export const INPUT = {
  bufferMs: 70,        // late-input buffer (PRD §7.3)
};
