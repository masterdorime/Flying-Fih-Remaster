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
  recentPerfectSeconds: 2.5, // "recent perfect" stops the flying drain
};

// Ring portals the fish passes through — see js/timing.js + js/gate-view.js.
// The mouth is geometry only; the press-timing QTE block below decides the grade.
export const GATE = {
  mouthRadius: 3.0,   // the ring mouth (torus radius): inside = QTE eligible, outside = Miss
  outerRadius: 3.0,   // visual torus radius (matches the mouth)
  spawnAhead: 90,       // max meters ahead of the fish
  spawnMin: 45,         // min lead, so a stall doesn't mean dead air
  leadSeconds: 4,       // target reaction time; lead = clamp(speed*this, min, max)
  cooldown: 0.6,        // seconds between resolve and the next spawn
  behindMiss: 6,        // meters past the plane unresolved = forced miss
  swimLift: 0.8,        // portal center above the wave surface while swimming
  flightMin: 63,        // gate Y band while flying (inside the 57-110 flight band)
  flightMax: 104,
  flightReach: 8,       // max altitude offset from the fish at spawn (W/S-alignable)
  corridorX: 4,         // |x| bound for placement (inside the old safe corridor)
  nudgeMargin: 1.6,    // gate-center clearance from obstacle centers (fish 1.1 + 0.5)
  nudgeHalfRange: 6,   // obstacle query window around the gate z at spawn
};

// Obstacle patterns (Phase 3): freeform rows with a validated gap — see
// js/worldgen.js. Rows scale with speed; shapes never unlock by tier.
export const PATTERN = {
  minGap: 3.0,        // minimum lateral gap per row (2 x 1.1 fish + 0.8 margin)
  rowBand: 5,         // validator z-grouping window (generator keeps intra-row spread <= 4)
  spacingSeconds: 0.35, // row spacing = clamp(speed * this, min, max)
  spacingMin: 18,     // meters between rows (slow swim)
  spacingMax: 40,     // meters between rows (fast arrival)
  rowZ0: 20,          // rows placed within chunk-local z
  rowZ1: 115,
  wallMax: 6,         // max obstacles per wall row
  maxAttempts: 8,     // validation re-rolls before the fallback row
};

// Ring-triggered QTE: crossing the mouth opens one SPACE window; the press
// times the grade (js/timing.js + js/game.js; see the 2026-10-15 spec).
export const QTE = {
  perfectWindow: 0.30, // seconds after crossing: Perfect
  goodWindow: 0.70,    // seconds after crossing: Good; beyond / no press = Miss
};

export const GAUGE = {
  max: 120,
  fillPerfect: 8,
  fillGood: 4,
  drainFlying: 2.2,          // per second while flying without a recent perfect
  missDrainMultiplier: 1.4,  // instant extra drain on miss
  lowMax: 30,
  mediumMax: 70,
  highMax: 99.9,
  maxThreshold: 100,
};

// Two-phase locomotion: swim on the ocean until the gauge is full, then launch
// into the sky. Flight is locked while swimming; the sky world is a separate
// environment above the cloud curtain (placeholder for now).
export const FLIGHT = {
  altitude: 85,              // fixed flight height (above the clouds)
  cloudY: 45,                // cloud curtain altitude — hides one world from the other
  launchChargeSeconds: 5,    // SPAM-QTE length (first flight only)
  spamFill: 6,               // gauge added per spam press during the charge
  gateChain: 5,              // consecutive hits required before the first launch
  leapSeconds: 2.6,          // cinematic leap duration
  descendSpeed: 30,          // sink rate when the gauge empties in flight
  firstFlightOnly: true,     // later launches skip the spam ritual
  flyMin: 57,                // W/S cruise band: never back down through the curtain
  flyMax: 110,               // ceiling for the climb
  climbRate: 18,             // m/s of cruise-altitude change with pitch input
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
  waterY: 0.6,        // legacy still-water ride height (kept for charge/leap base, landings, stall checks)
  failureAirborneSeconds: 1.5, // speed at min while airborne this long = run over
};

// Swim feel: the fish rides the live wave field (js/wave.js, same math as the
// water shader) instead of a flat altitude line. Visual/physical only —
// speed, timing, gauge, and launch rules are untouched.
export const WATER = {
  draftFraction: 0.25,   // of measured model height sits BELOW the surface: belly and
                          // lower sides intersect the water, back/dorsal/wings stay
                          // visible (verified against trough occlusion 2026-10-13)
  buoyancyRate: 4,       // spring rate toward the waterline (per second)
  pitchFromSlope: 0.8,   // nose follows the wave tilt this strongly
  rollFromSlope: 0.5,    // body rolls onto the lateral slope this strongly
};

// Run failure (PRD §10.4). Two reachable endings:
//  1. major crash while fragile (medium tier or below) costs a wing; 3 = run over
//  2. speed pinned at MinSpeed for collapsedSpeedSeconds = "out of momentum"
export const GAMEOVER = {
  wings: 3,
  fragileTierIndex: 2,        // TIER_ORDER index: medium and below are fragile
  collapsedSpeedSeconds: 3,
};

export const WORLD = {
  chunkLength: 120,
  chunksAhead: 3,
  chunksBehind: 2,
  laneHalfWidth: 14,   // playable lateral bounds
  corridorHalfWidth: 5 // obstacles never enter this central corridor (safety, PRD §12.4)
};

export const DIFFICULTY = {
  rampMeters: 5000,          // distance over which difficulty reaches 1.0
  rampSeconds: 120,          // time over which difficulty reaches 1.0 (whichever comes first)
  promptIntervalStart: 2.4,
  promptIntervalEnd: 1.35,
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
  windowScale: 1.6,    // widens the QTE press windows (perfect 0.48, good 1.12)
  speedScale: 0.85,    // top speed multiplier
};
