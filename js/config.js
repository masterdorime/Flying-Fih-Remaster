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
  swimLift: 0.95,        // portal center above the wave surface while swimming
                         // (0.8 -> 0.95 with the 2026-10-19 steeper field: the analytic
                         // bound on surface deviation across the 3 m mouth is 0.825 m, so
                         // the old lift no longer cleared it — measured, not guessed.
                         // tests/unit/wave-offsets.test.js pins the constraint.)
  flightMin: 63,        // gate Y band while flying (inside the 57-110 flight band)
  flightMax: 104,
  flightReach: 8,       // max altitude offset from the fish at spawn (W/S-alignable)
  corridorX: 4,         // |x| bound for placement (inside the old safe corridor)
  zShiftMax: 20,        // max forward z-shift when the mouth clips a wall row
  placementRange: 30,   // obstacle query window around the gate z (zShiftMax 20 + biggest hull reach 9.4 + margin)
  // 2026-10-18 gate-clearance ruling: an accepted ring keeps a mouth+margin
  // edge gap to every hull in its z-band — never grazes a hull at mouth
  // distance (the old bar accepted exactly mouth-radius edges: ring grazing
  // the hull edge, reported as "really near").
  clearanceMargin: 0.8,
};

// Obstacle patterns (Phase 3): freeform rows with a validated gap — see
// js/worldgen.js. Rows scale with speed; shapes never unlock by tier.
// 2026-10-18 fairness budget (approved): rows sit ≥1.2 s apart at every speed
// (walls ≥1.35 s — extra read time for multi-gap rows), spacing = speed ×
// seconds with a 22 m floor; z-jitter only ever ADDS time; the generator
// validates the steering-reachable chain between consecutive rows.
export const PATTERN = {
  minGap: 3.0,          // minimum lateral gap per row (2 x 1.1 fish + 0.8 margin)
  rowBand: 5,           // validator z-grouping window (members stay within ±2)
  rowWindowSeconds: 1.2,     // window between rows (was spacingSeconds 0.35)
  wallWindowSeconds: 1.35,   // window after wall-type rows
  spacingMin: 22,       // meters between rows at the slowest swim
  zJitterMax: 4,        // add-only nominal-row jitter (never subtracts time)
  rowZ0: 20,            // first row (chunk 0, absolute)
  wallMax: 6,           // max obstacles per wall row
  maxAttempts: 8,       // validation re-rolls before a breather skip
  reaction: 0.25,       // human reaction allowance in the chain check
  chainMargin: 0.15,    // chain-check safety margin
};

// Formation library (2026-10-18 §9 stage B): weighted, difficulty-gated
// roster; the pick tilt rises with compose speed toward wide paths. Roster
// and weight/gating values live here; the mechanics (pick, locked
// continuation roles, no-repeat guard) live in js/worldgen.js.
export const FORMATIONS = {
  tiltMinSpeed: 25,     // speed where the tilt bias is zero
  tiltMaxSpeed: 110,    // speed where the tilt bias is fully applied
  // id -> { weight, minD, tilt, windows }. `minD` is the difficulty gate;
  // `tilt` is how strongly the compose speed favours it (wide paths and
  // intentional breathers rise with speed); `windows` > 1 means the formation
  // locks a continuation sequence (retries re-jitter, they never re-pick).
  roster: {
    slalom:     { weight: 1.0, minD: 0.00, tilt: 0.0, windows: 1 },
    wall:       { weight: 1.0, minD: 0.00, tilt: 0.0, windows: 1 },
    center:     { weight: 1.0, minD: 0.00, tilt: 0.0, windows: 1 },
    cluster:    { weight: 0.9, minD: 0.25, tilt: 0.4, windows: 1 },
    breather:   { weight: 0.5, minD: 0.15, tilt: 1.4, windows: 1 },
    wideGate:   { weight: 0.8, minD: 0.35, tilt: 1.6, windows: 1 },
    offsetTurn: { weight: 0.8, minD: 0.40, tilt: 0.6, windows: 2 },
    fork:       { weight: 0.8, minD: 0.55, tilt: 1.0, windows: 2 },
    chicane:    { weight: 0.7, minD: 0.55, tilt: 0.4, windows: 2 },
    riskLane:   { weight: 0.6, minD: 0.70, tilt: 0.0, windows: 1 },
  },
};

// Honest hull collision dims (2026-10-18): measured from the live normalized
// templates (Box3 after models.js normalize GAME-sized geometry), wrapped
// with the approved grace — rx = half-beam + 0.3 m, rz = half-length + 0.4 m
// tip slack. Watercraft sail bow-forward along z, so the long axis is z.
// The giant-ship mast (sky 13.7 m) is vertical; horizontal collision is what
// the capsule governs.
export const HULLS = {
  'ship-liner':   { rx: 3.58 / 2 + 0.3, rz: 16 / 2 + 0.4, beam: 3.58, length: 16 },
  'ship-cargo-b': { rx: 3.34 / 2 + 0.3, rz: 9 / 2 + 0.4,  beam: 3.34, length: 9 },
  'ship-cargo-c': { rx: 4.83 / 2 + 0.3, rz: 13 / 2 + 0.4, beam: 4.83, length: 13 },
  buoy:           { rx: 1.31 / 2 + 0.3, rz: 1.31 / 2 + 0.4, beam: 1.31, length: 1.31 },
  'buoy-flag':    { rx: 1.09 / 2 + 0.3, rz: 1.52 / 2 + 0.4, beam: 1.09, length: 1.52 },
  'boat-speed':   { rx: 4.77 / 2 + 0.3, rz: 9 / 2 + 0.4,  beam: 4.77, length: 9 },
  'boat-speed-b': { rx: 4.88 / 2 + 0.3, rz: 9 / 2 + 0.4,  beam: 4.88, length: 9 },
  'boat-speed-c': { rx: 5.07 / 2 + 0.3, rz: 9 / 2 + 0.4,  beam: 5.07, length: 9 },
  'boat-sail':    { rx: 3.01 / 2 + 0.3, rz: 6.36 / 2 + 0.4, beam: 3.01, length: 6.36 },
  'boat-sail-b':  { rx: 3.19 / 2 + 0.3, rz: 7.27 / 2 + 0.4, beam: 3.19, length: 7.27 },
  'boat-tug':     { rx: 3.6 / 2 + 0.3,  rz: 7 / 2 + 0.4,  beam: 3.6,  length: 7 },
  'boat-tug-b':   { rx: 4.35 / 2 + 0.3, rz: 7 / 2 + 0.4,  beam: 4.35, length: 7 },
  'boat-fishing': { rx: 3.23 / 2 + 0.3, rz: 7 / 2 + 0.4,  beam: 3.23, length: 7 },
  ship:           { rx: 6.6 / 2 + 0.3,  rz: 18 / 2 + 0.4, beam: 6.6,  length: 18 },
  container:      { rx: 2.3 / 2 + 0.3,  rz: 4.6 / 2 + 0.4, beam: 2.3, length: 4.6 },
};

// Gameplay kind -> visual variant roster (single source of truth; models.js
// renders from this and worldgen binds the variant deterministically per
// spawn so collision and silhouette are provably the same object).
export const KIND_VARIANTS = {
  rock: ['ship-liner', 'ship-cargo-b', 'ship-cargo-c'],
  buoy: ['buoy', 'buoy-flag'],
  boat: ['boat-speed', 'boat-speed-b', 'boat-speed-c', 'boat-sail', 'boat-sail-b', 'boat-tug', 'boat-tug-b', 'boat-fishing'],
  container: ['container'],
  ship: ['ship'],
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
  corridorHalfWidth: 5 // legacy width constant (the corridor is occupiable since Phase 3; reused as a measuring stick)
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
  graceSeconds: 0.5, // global crash grace (2026-10-17, was per-obstacle): i-frames + fish invisibility share this window
  blinkPeriod: 0.1,  // recovery-flash on/off period while the grace window is open
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

// The atmosphere (2026-10-19 ocean-cohesion spec §4.1): ONE home for the air, read
// by js/atmosphere.js and every visual layer from it — water shader, sky dome,
// scene fog, prop tint. Values are the pre-existing literals relocated here
// (main.js fog/sun, water.js palette, wake.js FADE) so nothing changes by default
// and the AGENTS §3 "every number, one home" rule holds.
export const ATMOSPHERE = {
  // key light: the sun direction is shared by the direction light, the water's
  // specular term and the sky dome's sun glow, so all three agree on where it is
  sun: { dir: [40, 80, 30], color: 0xfff2dd, intensity: 2.3 },
  // horizon IS the fog colour — that is the seam: the dome paints the fog colour
  // at the horizon and the sea fades to it, so they meet by construction
  sky: { zenith: 0x2f8fc4, horizon: 0xcfe8f5 },
  // one fade curve, matching three's linear fog: smoothstep(near, far, depth)
  fog: { color: 0xcfe8f5, near: 120, far: 480 },
  // water palette + sun response. The wave AMPLITUDE is not a knob here: it is derived
  // from WAVE_TERMS in js/wave.js and asserted into the contracted 1.2-1.6 m band.
  water: { deep: 0x063a7a, ocean: 0x0d5cb0, aqua: 0x3ec3f0, foam: 0xffffff, specular: 1.0, crestFoam: 0.5 },
  // wake foam dissolve colour (formerly js/wake.js:14)
  wake: { fade: 0x0a3f7a },
  // prop grounding (T11, cohesion): the sea paints a foam collar around nearby hulls and a
  // pooled sprite darkens the water under them, so props sit IN the water rather than on it.
  contact: { radius: 2.2, opacity: 0.45, hullRange: 70, count: 6, collarWidth: 1.8 },
  // horizon depth layer (T12) — inert until then
  horizon: { layers: 0, scaleRange: 0, hazeStrength: 0, spacing: 0 },
  // per-frame prop surface-sampling radius (T10) — inert until then
  props: { sampleRange: 200 },
};
