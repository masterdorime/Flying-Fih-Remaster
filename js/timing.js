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

// Nudge a freshly spawned gate to clear nearby water (Phase 3: the center is
// occupiable now). Pure geometry: a spawn that already clears every live
// obstacle disc near the gate plane by GATE.nudgeMargin never moves
// (open-water gates stay exactly put — teleports and tests rely on it).
// Otherwise take the CLEAREST available x, not merely the nearest passable
// one: the fish teleports onto the gate and swims its departure line from
// there, so the gap center (meters of margin) is the only safe target — a
// margin-edge point clips the neighbor rock on the way out. Ties keep the
// nearest candidate. Best-effort throughout: dense water may have no fully
// clear point, but crossing the mouth always stays possible.
export function resolveGateOverlap(gateX, gateZ, discs) {
  const near = discs.filter(d => Math.abs(d.z - gateZ) <= GATE.nudgeHalfRange);
  const clearance = (x) => {
    let c = Infinity;
    for (const d of near) c = Math.min(c, Math.abs(x - d.x) - d.radius);
    return c;
  };
  if (clearance(gateX) >= GATE.nudgeMargin) return gateX;
  const lane = WORLD.laneHalfWidth;
  const candidates = [];
  for (let x = -lane; x <= lane; x += 0.5) candidates.push(x);
  candidates.sort((a, b) => Math.abs(a - gateX) - Math.abs(b - gateX) || a - b);
  let best = gateX, bestScore = clearance(gateX);
  for (const x of candidates) {
    const s = clearance(x);
    if (s > bestScore + 1e-9) { bestScore = s; best = x; }
  }
  return best;
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
