// Ring-triggered QTE: pure core — gate placement, mouth geometry, and the
// press-window math. Node-testable; rendering lives in js/gate-view.js,
// lifecycle in js/game.js, cue in js/hud.js.
//
// Post-2026-10-15 the grade is press TIMING, not distance: crossing inside the
// mouth opens one SPACE window (QTE.perfectWindow / goodWindow) and the press
// time picks the grade (assist multiplies both windows, never the geometry).

import { GATE, ASSIST, QTE, WORLD, COLLISION } from './config.js';
import { surfaceHeight } from './wave.js';
import { mulberry32 } from './worldgen.js';

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

let nextGateId = 1;

// One gate: a portal standing perpendicular to travel, placed ahead of the
// player. The lead distance scales with speed (~GATE.leadSeconds of reaction
// time) so a MinSpeed opener never crawls to the first gate. rng is injected
// so placement stays deterministic under test.
export function createGate(rng, { locomotion, playerPos, runTime, speed = 25, difficulty = 0, lastStyle = null, forceStyle = null }) {
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
  // The style and the QTE lead are drawn LAST so every existing draw keeps its position — reordering
  // them would move gate layouts for a given seed (AGENTS §3). `forceStyle` overrides the PICK but the
  // draw still happens, so a forced-style test run sees the same stream as a normal one.
  const picked = pickStyle(rng, difficulty, lastStyle);
  const qteLead = pickLead(rng);
  return { id: nextGateId++, x, y, z, locomotion, style: forceStyle ?? picked, qteLead, resolved: false, result: null };
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

// Open the one QTE for this gate. `now` is state.runTime (never wall-clock, so pause/time-scale
// can't skew the deadline). Stamps gate.qteOpened so a gate can never open a second window.
//
// CENTRED (2026-10-22, user-directed): the cue resolves at `targetAt` and the window is centred on it,
// so the grade is how close to that MOMENT the press lands. `deadline` is when the QTE gives up
// (target + the good half); `qteRemaining` reads it, so the HUD and the auto-miss share one clock.
//
// `closing` (an inner ring shrinks onto a marked target) and `clock` (a hand ticks around a dial, and the
// gold band one tick wide IS the Perfect window) use the SAME window — the style is presentation, not
// difficulty. The lead is per-gate (`gate.qteLead`, a whole tick count drawn at spawn) so the MOMENT
// varies ring to ring while the opportunity never does; assist widens the two HALVES, never the geometry.
export function createQte(gate, now, { assist = false } = {}) {
  const scale = assist ? ASSIST.windowScale : 1;
  const style = gate.style ?? 'closing';
  gate.qteOpened = true;
  const lead = gate.qteLead ?? QTE.targetTicks.min * QTE.tick;
  return {
    gateId: gate.id, startedAt: now, style,
    targetAt: now + lead,
    perfectHalf: QTE.perfectHalf * scale,
    goodHalf: QTE.goodHalf * scale,
    deadline: now + lead + QTE.goodHalf * scale,
    resolved: false, result: null,
    // the clock's own counters, so the tick and the beat are edge-triggered exactly once each
    ticks: 0, beat: false,
    // and its own tick unit: the cue's clock step. Consumers read it HERE rather than re-reading
    // config.QTE, so the drawn tick count, the hand's steps and the beat window can never disagree.
    tick: QTE.tick,
  };
}

// Grade one press against the CENTRED window. Idempotent — once resolved, the stored result wins, so
// mash-tapping can't double-grade. The 1e-9 slack keeps the inclusive boundaries exact in IEEE-754.
const WINDOW_SLACK = 1e-9;
export function evaluatePress(qte, pressAt) {
  if (qte.resolved) return qte.result;
  const err = Math.abs(pressAt - qte.targetAt);
  const result = err <= qte.perfectHalf + WINDOW_SLACK ? 'perfect'
    : err <= qte.goodHalf + WINDOW_SLACK ? 'good' : 'miss';
  qte.resolved = true;
  qte.result = result;
  return result;;
}

// Seconds left before the QTE gives up at `now` (state.runTime). Shared with the HUD cue, so the
// overlay's clock and the auto-miss fire on exactly the same deadline.
export function qteRemaining(qte, now) {
  return Math.max(0, qte.deadline - now);
}

// THE PAINTED DIAL (2026-10-22, user-directed: "red area(perfect, small) yellow area(good, medium) white
// area(miss, large)").
//
// Pure geometry, so the cue cannot lie about the window: the zones are DERIVED from the same two numbers
// the grading uses (`perfectHalf` / `goodHalf`, assist already folded in), converted at ONE rate — degrees
// per second of window time. Two consequences, both deliberate:
//
//   * the zones keep their SIZE at every ring (sizes are the fairness contract; randomising them would
//     randomise difficulty, which the user explicitly did not choose), and
//   * the needle runs at a CONSTANT speed, so what varies per trigger is where the moment SITS on the
//     dial. The previous cue did the opposite — bands pinned at 12 o'clock, needle speed varying — so
//     every ring looked identical and the drawn variation was invisible.
//
// Convention, stated once: 0° is 12 o'clock and positive degrees run CLOCKWISE (SVG's own rotate
// direction). Anything drawn from this must use that one convention — the band that sat a full tick
// clockwise of the hand was a second convention for the same point on the dial.
export function dialAngles(qte, elapsed) {
  const degPerSec = 360 / QTE.dialSeconds;
  const target = qte.targetAt - qte.startedAt; // the drawn moment, in seconds after the crossing
  return {
    degPerSec,
    needle: Math.max(0, elapsed) * degPerSec,
    centre: target * degPerSec,
    perfectHalfDeg: qte.perfectHalf * degPerSec,
    goodHalfDeg: qte.goodHalf * degPerSec,
  };
}

// The gate stream, seeded from the RUN seed. It was the fixed literal 0x9a7e, so within a run the gates
// varied but EVERY RUN PLAYED THE SAME SEQUENCE — which is what the user noticed ("the game called random
// seed"). The xor keeps the old stream's character while making it run-specific; a `?seed=` run still
// reproduces exactly, which the suite depends on.
export function gateRngFor(runSeed) {
  return mulberry32(((runSeed >>> 0) ^ 0x9a7e) >>> 0);
}

// Pick a style for a newly spawned gate: weighted, difficulty-gated, and never the same as the
// previous one while a second style is unlocked. Pure and rng-injected, so a ?seed= run is
// reproducible and the browser tests can be written against it. Roster shape mirrors FORMATIONS
// (AGENTS §4 row 8); the caller draws LAST in createGate so existing draws keep their positions.
export function pickStyle(rng, difficulty, lastStyle = null) {
  const unlocked = Object.entries(QTE.styles).filter(([, s]) => difficulty >= s.minD);
  const fallback = Object.entries(QTE.styles)[0];
  const pool = unlocked.length ? unlocked : [fallback];
  const fresh = pool.filter(([name]) => name !== lastStyle);
  const use = fresh.length ? fresh : pool;
  const total = use.reduce((sum, [, s]) => sum + s.weight, 0);
  let r = rng() * total;
  for (const [name, s] of use) {
    r -= s.weight;
    if (r <= 0) return name;
  }
  return use[use.length - 1][0];
}

// The tick count before the target — the VARIATION the player asked for ("the perfect, good, miss
// placement should be different every trigger"). Drawn per trigger from the gate's own stream, so a
// ?seed= run is still reproducible.
export function pickTicks(rng) {
  const { min, max } = QTE.targetTicks;
  return min + Math.floor(rng() * (max - min + 1));
}

// The moment, in seconds after the crossing: always a WHOLE number of ticks, so the clock's hand lands on
// the notch exactly and "within one tick" is literally the Perfect band.
export function pickLead(rng) {
  return pickTicks(rng) * QTE.tick;
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

export function resolveGatePlacement(gateX, gateZ, discs, { minZ = gateZ - GATE.zShiftMax, maxZ = gateZ + GATE.zShiftMax } = {}) {
  const acceptable = (x, z) => clearanceAt(z, x, discs) >= MIN_CLEAR && corridorClear(x, z, discs);
  if (acceptable(gateX, gateZ)) return { x: gateX, z: gateZ };
  const x = clearestXAt(gateZ, gateX, discs);
  if (acceptable(x, gateZ)) return { x, z: gateZ };
  // The ladder, TWO passes. Pass 1 keeps the ring's own column and moves only in z — a ring that
  // stays on its line reads as "it moved because the water is better there", where a 14 m sideways
  // jump to the lane edge reads as the objective wandering off. Pass 2 allows the clearest x at each
  // plane, but only if the column cannot be won anywhere in the window. Smallest move first, forward
  // on ties, inside the window the caller allows: the spawn LEAD BAND (spawnMin..spawnAhead ahead of
  // the player), not the old ±20 — measured, the clear water a ring needs is usually 20-48 m away, so
  // a ±20 search would spend its whole budget inside the tight stretch it is trying to escape.
  const walk = (allowLateral) => {
    for (let k = 1; k <= 400; k++) {
      const fwd = gateZ + k * 4;
      const back = gateZ - k * 4;
      const inFwd = fwd <= maxZ + 1e-9;
      const inBack = back >= minZ - 1e-9;
      if (!inFwd && !inBack) break;
      for (const z of [fwd, back]) {
        if (z > maxZ + 1e-9 || z < minZ - 1e-9) continue;
        if (acceptable(gateX, z)) return { x: gateX, z };
        if (allowLateral) {
          const cx = clearestXAt(z, gateX, discs);
          if (acceptable(cx, z)) return { x: cx, z };
        }
      }
    }
    return null;
  };
  return walk(false) ?? walk(true) ?? { x, z: gateZ };
}

// THE RING'S CORRIDOR (2026-10-22 spec stage A). `clearanceAt` above answers "does the ring overlap
// a hull AT ITS OWN PLANE". It cannot answer "is there room to line up": measured live, a quarter of
// rings left under 18 m of clear water behind them inside their own lane window, worst case 2.7 m —
// the user's "it can be very in front of the obstacle, and it can be right behind the obstacle".
//
// A hull is IN THE WAY when its lateral extent crosses the ring's water column, meaning it comes
// within MIN_CLEAR of the ring's x — the same bar the plane test uses, so the two cannot disagree
// about what "clear" means. It counts wherever it stands in z, INCLUDING a hull that never touches
// the ring's plane, which is exactly the case the old bar could not see.
//
// Returns the clear metres behind and ahead. A hull straddling the plane returns -1 for both: there
// is no corridor at all through it.
export function corridorGapAt(x, z, discs) {
  const fish = COLLISION.fishRadius;
  let before = Infinity;
  let after = Infinity;
  for (const d of discs) {
    const rx = d.rx ?? d.radius;
    if (Math.abs(d.x - x) - rx >= MIN_CLEAR) continue; // laterally clear of the ring's column
    const rz = d.rz ?? d.radius;
    const zNear = d.z - rz - fish;
    const zFar = d.z + rz + fish;
    if (zFar <= z) before = Math.min(before, z - zFar);
    else if (zNear >= z) after = Math.min(after, zNear - z);
    else return { before: -1, after: -1 };
  }
  return { before, after };
}

function corridorClear(x, z, discs) {
  const gap = corridorGapAt(x, z, discs);
  return gap.before >= GATE.corridorBefore && gap.after >= GATE.corridorAfter;
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
