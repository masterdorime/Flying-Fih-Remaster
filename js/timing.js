// Ring-triggered QTE: pure core — gate placement, mouth geometry, and the
// press-window math. Node-testable; rendering lives in js/gate-view.js,
// lifecycle in js/game.js, cue in js/hud.js.
//
// Post-2026-10-15 the grade is press TIMING, not distance: crossing inside the
// mouth opens one SPACE window (QTE.perfectWindow / goodWindow) and the press
// time picks the grade (assist multiplies both windows, never the geometry).

import { GATE, ASSIST, QTE, WORLD } from './config.js';
import { surfaceHeight } from './wave.js';

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

let nextGateId = 1;

// One gate: a portal standing perpendicular to travel, placed ahead of the
// player. The lead distance scales with speed (~GATE.leadSeconds of reaction
// time) so a MinSpeed opener never crawls to the first gate. rng is injected
// so placement stays deterministic under test.
export function createGate(rng, { locomotion, playerPos, runTime, speed = 25 }) {
  const x = (rng() * 2 - 1) * GATE.corridorX;
  const lead = Math.min(GATE.spawnAhead, Math.max(GATE.spawnMin, speed * GATE.leadSeconds));
  const z = playerPos.z + lead;
  const flying = locomotion === 'fly' || locomotion === 'leap';
  // flight gates spawn within a reachable window of the fish so W/S alignment
  // is required but never impossible at speed (clamped into the flight band)
  const reach = (rng() * 2 - 1) * GATE.flightReach;
  const y = flying
    ? clamp(playerPos.y + reach, GATE.flightMin, GATE.flightMax)
    : surfaceHeight(x, z, runTime) + GATE.swimLift;
  return { id: nextGateId++, x, y, z, locomotion, resolved: false, result: null };
}

// Where the player crossed the gate's plane this frame, linearly interpolated
// so a big step (low fps at max speed) can't tunnel past the gate unseen.
// Returns null when the plane wasn't crossed between prevPos and pos.
export function crossingSample(prevPos, pos, gateZ) {
  if (!(prevPos.z < gateZ && pos.z >= gateZ)) return null;
  const span = Math.max(1e-6, pos.z - prevPos.z);
  const f = (gateZ - prevPos.z) / span;
  return { x: prevPos.x + (pos.x - prevPos.x) * f, y: prevPos.y + (pos.y - prevPos.y) * f, z: gateZ };
}

// Did the crossing sample land inside the ring mouth? Pure geometry on the
// 3 m torus radius — no assist scaling (assist widens timing, not geometry).
// 'miss' means a plain gate miss with no QTE (graded by js/game.js).
export function mouthHit(gate, sample) {
  return Math.hypot(sample.x - gate.x, sample.y - gate.y) <= GATE.mouthRadius ? 'inside' : 'miss';
}

// Open the one press window for this gate. `now` is state.runTime (never
// wall-clock, so pause/time-scale can't skew the deadline). Stamps
// gate.qteOpened so a gate can never open a second window.
export function createQte(gate, now, { assist = false } = {}) {
  const scale = assist ? ASSIST.windowScale : 1;
  gate.qteOpened = true;
  return {
    gateId: gate.id, startedAt: now,
    perfectWindow: QTE.perfectWindow * scale,
    goodWindow: QTE.goodWindow * scale,
    resolved: false, result: null,
  };
}

// Grade one press against the window. Idempotent — once resolved, the stored
// result wins, so mash-tapping can't double-grade. The 1e-9 slack keeps the
// inclusive boundaries exact in IEEE-754: (startedAt + perfectWindow) -
// startedAt can land one ULP past the window (e.g. 10.30 - 10), and a press
// that close to the boundary belongs to the nearer grade, not a whole grade
// down.
const WINDOW_SLACK = 1e-9;
export function evaluatePress(qte, pressAt) {
  if (qte.resolved) return qte.result;
  const elapsed = pressAt - qte.startedAt;
  const result = elapsed < -WINDOW_SLACK || elapsed > qte.goodWindow + WINDOW_SLACK ? 'miss'
    : elapsed <= qte.perfectWindow + WINDOW_SLACK ? 'perfect' : 'good';
  qte.resolved = true;
  qte.result = result;
  return result;
}

// Seconds left on the window at `now` (state.runTime). Shared with the HUD cue,
// so the overlay drains on exactly the deadline the auto-miss fires on.
export function qteRemaining(qte, now) {
  return Math.max(0, qte.startedAt + qte.goodWindow - now);
}

// Place a freshly spawned gate in clear water (Phase 3 + 2026-10-17 overlap
// fix + 2026-10-18 gate-clearance ruling). Pure geometry, best-effort, three
// stages:
//   1. clean water — the spawn clears every hull capsule whose z-band touches
//      the gate plane by the mouth radius, with a mouth+margin edge gap:
//      nothing moves (teleports and tests pin this)
//   2. blocked laterally — the clearest x at the ideal plane under the same
//      bar (the gap center, ties nearest), so the fish teleports onto the
//      gate with meters of margin
//   3. the mouth still clips a hull — walk FORWARD in 4 m steps (max +20) to
//      the first plane between rows where the bar clears. Forward only: the
//      ring never lands behind the fish.
// Discs are matched per-disc, capsule-honest: z-band = (rz ?? radius) +
// mouthRadius and lateral reach = (rx ?? radius). Honest capsules
// (config.HULLS) reach ±9.4 m in z while their rx is 2.0–3.6 — matching a
// hull by its radius read it as a ~2 m dot in z, which is exactly how rings
// used to spawn inside 16–18 m hulls (2026-10-18 player report, reproduced
// live in t19 phase 4 before the fix). Movers arrive as sweep-envelope discs
// (world.obstaclesNear): radius = rx + range already encodes worst-phase
// lateral reach.
// Hopeless water keeps the clearest x at the ideal plane — documented
// best-effort fallback (row-legality validation gives every row a true ≥3 m
// gap, so saturating water is rare in composed layouts).
const MIN_CLEAR = GATE.mouthRadius + GATE.clearanceMargin;

// z-band scope (spec §7.1): a disc is in play when the gate plane sits inside its z-reach
// plus the mouth. Hoisted so the spawn-time resolver and the live re-check share ONE rule —
// two copies of this filter would be free to drift apart.
const inBand = (discs, z) => discs.filter(d => Math.abs(d.z - z) <= (d.rz ?? d.radius) + GATE.mouthRadius);

// worst lateral clearance at (z, x): distance to the nearest in-band hull's edge
function clearanceAt(z, x, discs) {
  let c = Infinity;
  for (const d of inBand(discs, z)) c = Math.min(c, Math.abs(x - d.x) - (d.rx ?? d.radius));
  return c;
}

// clearest legal x at a FIXED z: keep the caller's x when it is already clear, else search the
// lane in 0.5 m steps, preferring candidates closest to the caller's x
function clearestXAt(z, fromX, discs) {
  if (clearanceAt(z, fromX, discs) >= MIN_CLEAR) return fromX;
  const lane = WORLD.laneHalfWidth;
  const candidates = [];
  for (let x = -lane; x <= lane; x += 0.5) candidates.push(x);
  candidates.sort((a, b) => Math.abs(a - fromX) - Math.abs(b - fromX) || a - b);
  let best = fromX, bestScore = clearanceAt(z, fromX, discs);
  for (const x of candidates) {
    const s = clearanceAt(z, x, discs);
    if (s > bestScore + 1e-9) { bestScore = s; best = x; }
  }
  return best;
}

export function resolveGatePlacement(gateX, gateZ, discs) {
  if (clearanceAt(gateZ, gateX, discs) >= MIN_CLEAR) return { x: gateX, z: gateZ };
  const x = clearestXAt(gateZ, gateX, discs);
  if (clearanceAt(gateZ, x, discs) >= MIN_CLEAR) return { x, z: gateZ };
  for (let dz = 4; dz <= GATE.zShiftMax; dz += 4) {
    const z = gateZ + dz;
    if (clearanceAt(z, gateX, discs) >= MIN_CLEAR) return { x: gateX, z };
    const cx = clearestXAt(z, gateX, discs);
    if (clearanceAt(z, cx, discs) >= MIN_CLEAR) return { x: cx, z };
  }
  // dense water: clearest x at the ideal plane — the fish still fits the mouth
  return { x, z: gateZ };
}

// STRUCTURAL INVARIANT (2026-10-20, §4 row 4). A gate's clearance used to be checked ONCE, at
// spawn, against the discs visible then. world.js's ensureChunks composes ahead and REMOVES
// chunks behind, so that is not the disc set the gate goes on to live in — a legally placed
// gate can end up with a hull underneath it. Observed live twice: a 16 m liner dead-centre
// under a gate (lat -0.08) with 125 legal planes available.
//
// Re-checking the LIVE gate makes the invariant unconditional. It is idempotent (a clear gate
// returns its own x, so a legal ring never moves). It repairs X ONLY and never z: a live gate's
// z is committed, because the QTE window origin and gateBehind both read it — shifting z would
// move the objective in time as well as space.
//
// It deliberately takes the NEAREST legal x, NOT the clearest (which is what the spawn-time
// resolver wants, spec §7: there it is free to choose the best water). A live repair wants the
// SMALLEST disturbance instead — the clearest x is often the far lane edge, so a repair could
// drag a ring 13 m sideways while the player is lining it up. (t08-gates caught exactly that
// shape from the first version of this fix: it parks the fish 2 m in front of a ring and then
// crossed it, and the ring slid out from under the mouth.)
export function clearGateX(gateX, gateZ, discs) {
  if (clearanceAt(gateZ, gateX, discs) >= MIN_CLEAR) return gateX;
  const lane = WORLD.laneHalfWidth;
  // search OUTWARD from the caller's x in the resolver's own 0.5 m grid: the first legal
  // candidate found is by construction the smallest correction
  for (let i = 1; i <= Math.ceil((lane * 2) / 0.5); i++) {
    for (const cand of [gateX - i * 0.5, gateX + i * 0.5]) {
      if (cand < -lane || cand > lane) continue;
      if (clearanceAt(gateZ, cand, discs) >= MIN_CLEAR) return cand;
    }
  }
  // nowhere legal on this plane: best effort, the clearest x (the gate still fits the mouth)
  return clearestXAt(gateZ, gateX, discs);
}

// The player sailed past the gate without entering it.
export function gateBehind(gate, playerPos) {
  return playerPos.z - gate.z >= GATE.behindMiss;
}

// Re-glue a swim gate to the live wave every frame: the renderer draws the
// portal on the moving surface, so the graded center must read the same value
// (wave amplitude reaches ±0.93 m — more than the whole perfect window).
export function reseatSwimGate(gate, runTime) {
  gate.y = surfaceHeight(gate.x, gate.z, runTime) + GATE.swimLift;
}

// A new gate may spawn only once the previous one resolved and cooled down.
export function gateCadence(gate, cooldownLeft) {
  return gate === null || (gate.resolved && cooldownLeft <= 0);
}
