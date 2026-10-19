// Procedural chunk generation (PRD §11, §12). Pure: layout decisions only; rendering lives in world.js.
// Phase 3: freeform pattern rows (slalom / wall / center / cluster) with a
// validated per-row gap — the center is sometimes occupied, but every chunk
// keeps a swimmable route (see docs/superpowers/specs/2026-10-16-obstacle-patterns-design.md).
// 2026-10-18 fairness rebuild (docs/superpowers/specs/2026-10-18-obstacle-fairness-design.md):
// cursor-based rows ≥1.2 s apart at every speed (walls ≥1.35 s), add-only
// jitter, steering-reachable chain validation between consecutive rows, and
// honest per-variant hull capsules (measured bounds + approved grace).
import { WORLD, DIFFICULTY, PATTERN, TIER_PROFILE, HULLS, KIND_VARIANTS, FORMATIONS } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Deterministic mixed stream keys (FNV-1a over small ints) — every decision
// owns its stream id so attempt re-rolls can't perturb the cursor or neighbors.
function streamKey(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) { h ^= (n | 0) + 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export const WORLD_HALF = WORLD.laneHalfWidth; // single name for the sweep bounds (and tests)

// Difficulty ramps by distance OR time, whichever is faster (PRD §13).
export function difficultyAt(distanceMeters, runTimeSeconds) {
  const byDistance = distanceMeters / DIFFICULTY.rampMeters;
  const byTime = runTimeSeconds / DIFFICULTY.rampSeconds;
  return clamp01(Math.max(byDistance, byTime));
}

// Legacy sphere roster (pre-2026-10-18). Gameplay collision now uses the
// honest per-variant capsules in config.HULLS; this table remains for the
// debug/probe surface and as the fixture fallback (rx/rz ?? radius).
const RADII = { rock: 4.0, buoy: 1.1, boat: 3.4, container: 2.2, ship: 6.5 };
export const RADIUS_TABLE = RADII;

function kindsFor(difficulty, rng) {
  if (difficulty < 0.25) return ['rock', 'buoy'];
  if (difficulty < 0.6) return ['rock', 'buoy', 'boat'];
  return ['rock', 'buoy', 'boat', 'container', 'buoy', 'ship'];
}

function groundY(kind) { return kind === 'buoy' ? 1.2 : 0.7; }

// ---- honest hull shapes -----------------------------------------------------
// Watercraft sail bow-forward along z (BOW_YAW), so the long axis is z.
// rx = variant half-beam + 0.3 grace; rz = half-length + 0.4 tip slack.

function hullOf(variant) { return HULLS[variant]; }

function variantFor(kind, rng) {
  const roster = KIND_VARIANTS[kind] || [kind];
  return roster[Math.floor(rng() * roster.length)] || kind;
}

function baseObstacle(kind, x, z, pattern, rng) {
  const variant = variantFor(kind, rng ?? deterministicFallbackRng());
  const hull = hullOf(variant) || { rx: RADII[kind], rz: RADII[kind] };
  return {
    kind, variant, x, y: groundY(kind), z,
    radius: RADII[kind],          // legacy sphere roster (debug/probe surface)
    rx: hull.rx,                  // honest capsule: half-beam + 0.3 grace
    rz: hull.rz,                  // honest capsule: half-length + 0.4 tip slack
    moving: false, phase: 0, speed: 1, range: 0,
    pattern,
    rowZ: z,
  };
}
// baseObstacle historically took no rng; fixtures/tests may call it — keep a
// module-level reserve stream for that path (never used by composition).
let reserveStream = mulberry32(0xFEED);
function deterministicFallbackRng() { return reserveStream; }

// ---- collision math (pure, mirrored by world.js) ----------------------------

// Point-in-hull-capsule: 2D distance from (px, pz) to the z-axis capsule
// centered on (o.x, o.z) — half-beam rx, half-length rz (caps included).
export function capsuleHit(px, pz, o, playerRadius = 1.1) {
  const rx = o.rx ?? o.radius;
  const rz = Math.max(o.rz ?? o.radius, 0);
  const dzRaw = Math.abs(pz - o.z);
  const dz = Math.max(0, dzRaw - Math.max(0, rz - rx));
  return Math.hypot(px - o.x, dz) < rx + playerRadius;
}

// ---- steering model (mirrors js/player.js) ----------------------------------

// Lateral speed cap for an obstacle-approach speed: the nearest tier worki
// exactly the swim/fly steering term (turnRate × airControl × 0.55).
export function steerCap(speed) {
  const order = ['none', 'low', 'medium', 'high', 'max'];
  for (const t of order) {
    if (speed <= TIER_PROFILE[t].maxSpeed + 1e-9) {
      return TIER_PROFILE[t].turnRate * TIER_PROFILE[t].airControl * 0.55;
    }
  }
  const p = TIER_PROFILE.max;
  return p.turnRate * p.airControl * 0.55;
}

// First-order settle transit: identical update loop to player.js (dt = 1/60):
// v += (target − v)·min(1, dt·6); x += v·dt, from lateralVel 0.
export function transitTime(dx, cap) {
  if (Math.abs(dx) < 1e-9) return 0;
  const dt = 1 / 60;
  const dir = Math.sign(dx);
  let pos = 0, vel = 0, t = 0, x = 0;
  const target = Math.abs(dx);
  while (x < target) {
    vel += (dir * cap - vel) * Math.min(1, dt * 6);
    x += Math.abs(vel) * dt;
    t += dt;
    if (t > 30) return Infinity;
  }
  return t;
}

export function freeIntervals(intervals, half = WORLD.laneHalfWidth) {
  let end = -half;
  const out = [];
  for (const [lo, hi] of intervals) {
    if (lo > end) out.push([end, lo]);
    if (hi > end) end = hi;
  }
  if (end < half) out.push([end, half]);
  return out;
}

function widestSpanCenter(spans, minGap) {
  let best = null;
  for (const [a, b] of spans) if (!best || b - a > best[1] - best[0]) best = [a, b];
  return best ? (best[0] + best[1]) / 2 : null;
}

// Chain reachability (spec §3.2): from the widest swimmable span of the
// previous row, can the fish steer to the widest swimmable span of the next
// row within its time window (window minus human reaction minus margin)?
// 2026-10-18 hull-aware corridor: rows anchor their capsules at rowZ, and a
// 16 m liner reaches ±8.4 m of that anchor — the swimmable corridor between
// two rows is dz minus each row's widest hull half-length, not raw dz.
export function chainReachable(prevObstacles, nextObstacles, dz, speed) {
  const ivs = row => row.map(o => {
    const rx = o.rx ?? o.radius;
    const reach = rx + (o.moving ? o.range : 0);
    return [o.x - reach, o.x + reach];
  }).sort((a, b) => a[0] - b[0]);
  const cap = steerCap(speed);
  const prevSpans = freeIntervals(ivs(prevObstacles)).filter(s => s[1] - s[0] >= PATTERN.minGap);
  const nextSpans = freeIntervals(ivs(nextObstacles)).filter(s => s[1] - s[0] >= PATTERN.minGap);
  if (!prevSpans.length || !nextSpans.length) return false;
  const widestTail = row => Math.max(0, ...row.map(o => o.rz ?? o.radius));
  const corridor = dz - widestTail(prevObstacles) - widestTail(nextObstacles);
  if (corridor <= 0) return false;
  const prevC = widestSpanCenter(prevSpans);
  const nextC = widestSpanCenter(nextSpans);
  const available = corridor / speed - PATTERN.reaction - PATTERN.chainMargin;
  if (available <= 0) return false;
  return transitTime(Math.abs(nextC - prevC), cap) <= available;
}

// ---- rows -------------------------------------------------------------------

// Lateral intervals for one row: movers count by their full swept
// envelope, so the gap holds for every phase of the sweep, not just its ends.
function rowIntervals(obstacles) {
  return obstacles.map(o => {
    const rx = o.rx ?? o.radius;
    const reach = rx + (o.moving ? o.range : 0);
    return [o.x - reach, o.x + reach];
  }).sort((a, b) => a[0] - b[0]);
}

// Widest swimmable gap across [-WORLD_HALF, WORLD_HALF] given sorted intervals.
export function maxRowGap(sortedIntervals) {
  let end = -WORLD_HALF, best = 0;
  for (const [lo, hi] of sortedIntervals) {
    if (lo > end) best = Math.max(best, lo - end);
    end = Math.max(end, hi);
  }
  return Math.max(best, WORLD_HALF - end);
}

function rowGapOk(obstacles) {
  return maxRowGap(rowIntervals(obstacles)) >= PATTERN.minGap;
}

// No-tangle rule (2026-10-17, updated 2026-10-18): swept envelopes must never
// interpenetrate. Hull-bearing specs (rx/rz present) separate as parallel
// z-capsules (z clearance must exceed the hull half-lengths); legacy fixtures
// without hull dims keep the exact sphere/z-distance rescue semantics.
function rowClash(row, margin = 0.5) {
  for (let i = 0; i < row.length; i++) {
    for (let j = i + 1; j < row.length; j++) {
      const a = row[i], b = row[j];
      const dx = Math.abs(a.x - b.x) - (a.moving ? a.range : 0) - (b.moving ? b.range : 0);
      const hasCaps = a.rx != null && b.rx != null;
      if (hasCaps) {
        const dzGap = Math.max(0, Math.abs(a.z - b.z) - (a.rz ?? a.radius) - (b.rz ?? b.radius));
        const need = (a.rx ?? a.radius) + (b.rx ?? b.radius) + margin;
        if (Math.hypot(Math.max(0, dx), dzGap) < need) return true;
      } else {
        const need = a.radius + b.radius + margin;
        if (Math.hypot(Math.max(0, dx), a.z - b.z) < need) return true;
      }
    }
  }
  return false;
}

// Safety validator (Phase 3, replaces hasSafeCorridor): every z-row of the
// chunk must keep a lateral gap of at least PATTERN.minGap AND hull-separated
// envelopes (2026-10-17 no-tangle rule; capsule-aware since 2026-10-18).
export function validateChunkGaps(chunk) {
  const sorted = [...chunk.obstacles].sort((a, b) => a.z - b.z);
  let row = [], prevZ = -1e9;
  const rows = [];
  for (const o of sorted) {
    if (o.z - prevZ > PATTERN.rowBand) { if (row.length) rows.push(row); row = []; }
    row.push(o);
    prevZ = o.z;
  }
  if (row.length) rows.push(row);
  return rows.every(row => rowGapOk(row) && !rowClash(row));
}

// Flag movers only where the swept envelope preserves the row gap. Draws the
// mover dice for every obstacle (fixed rng stream per seed); obstacles that
// fail the envelope check stay static with range 0.
function flagMovers(row, difficulty, rng) {
  const p = lerp(0, 0.55, difficulty);
  for (const o of row) {
    o.phase = rng() * Math.PI * 2;
    o.speed = lerp(0.5, 1.4, rng());
    const range = lerp(2, 6, rng());
    if (rng() >= p) continue;
    o.moving = true;
    o.range = range;
    if (!rowGapOk(row) || rowClash(row)) { o.moving = false; o.range = 0; }
  }
  return row;
}

// window between nominal rows: speed × seconds (more after wall rows) with a
// slow-swim floor. Jitter only ever ADDS (the anchor moves forward of cursor).
function windowDistance(speed, afterWall) {
  const seconds = afterWall ? PATTERN.wallWindowSeconds : PATTERN.rowWindowSeconds;
  return Math.max(speed * seconds, PATTERN.spacingMin);
}

// ---- row makers (unchanged shapes, honest beams) ----------------------------

// `opts.offset` locks a slalom lateral offset (offsetTurn's locked role);
// without it the offset stays a per-attempt jitter around the alternating sign.
function slalomRow(rng, rowZ, d, prevSign, opts = {}) {
  const sign = -prevSign;
  const offset = opts.offset ?? (5 + rng() * 5);
  const o = baseObstacle(pickKind(kindsFor(d, rng), rng), sign * offset, rowZ, 'slalom', rng);
  return { row: [o], prevSign: sign };
}

// `opts.gx` / `opts.gw` lock a wanted gap: wideGate's wide mouth, fork's
// off-center gap, chicane's alternating edge gaps, riskLane's narrow edge-hug
// gap. Without them a wall row keeps its historical jitter.
function wallRow(rng, rowZ, d, opts = {}) {
  const gx = opts.gx ?? (-11 + rng() * 22);
  const w = opts.gw ?? (PATTERN.minGap + 0.2 + rng() * 1.8); // wanted gap: ≥ minGap wide
  const kinds = kindsFor(d, rng);
  let cursor = -WORLD_HALF;
  let k = Math.floor(rng() * kinds.length);
  const row = [];
  while (cursor < WORLD_HALF && row.length < PATTERN.wallMax) {
    const kind = kinds[k % kinds.length];
    k++;
    const o = baseObstacle(kind, 0, rowZ, 'wall', rng); // variant + rx/rz bound here
    const r = o.rx;
    if (cursor + r > WORLD_HALF) break; // capsules stay in the lane (fish clamps to ±14)
    if (cursor + 2 * r > gx - w / 2 && cursor < gx + w / 2) {
      // this piece's beam would intrude into the wanted gap — jump the fill
      // cursor to the gap's far edge
      cursor = gx + w / 2;
      continue;
    }
    o.x = cursor + r;
    o.z = rowZ + (rng() * 2 - 1) * 2;
    row.push(o);
    cursor += 2 * r + 0.5 + rng(); // 0.5-1.5 m honest clearance between wall pieces
  }
  return { row };
}

function centerRow(rng, rowZ, d) {
  const n = 1 + Math.floor(rng() * 2);
  const row = [];
  for (let i = 0; i < n; i++) {
    // hull capsules can't always share the open center: re-roll a few times,
    // then drop an unplaceable member instead of fusing hulls
    for (let t = 0; t < 6; t++) {
      const o = baseObstacle(
        pickKind(kindsFor(d, rng), rng),
        (rng() * 2 - 1) * (WORLD.corridorHalfWidth - 1),
        rowZ + (rng() * 2 - 1) * 2,
        'center',
        rng,
      );
      if (!rowClash([...row, o])) { row.push(o); break; }
    }
  }
  return { row };
}

function clusterRow(rng, rowZ, d) {
  const n = 2 + Math.floor(rng() * 2);
  const cx = (rng() * 2 - 1) * 10;
  const row = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 6; t++) {
      const o = baseObstacle(
        pickKind(kindsFor(d, rng), rng),
        clamp(cx + (rng() * 2 - 1) * 4, -WORLD_HALF, WORLD_HALF),
        rowZ + (rng() * 2 - 1) * 2,
        'cluster',
        rng,
      );
      if (!rowClash([...row, o])) { row.push(o); break; }
    }
  }
  return { row };
}

// ---- formation library (2026-10-18 spec §9) ---------------------------------
// The uniform 4-shape pick became a weighted, difficulty-gated roster with a
// no-immediate-repeat guard and a speed tilt toward wide paths. `o.pattern`
// stays the shape class (the spacing/wall floors derive from the ROLE);
// `o.form` carries the formation id. Roles are LOCKED at pick time and reused
// by every retry, so a failed attempt re-jitters the row it already committed
// to instead of silently choosing a different shape.

function speedT(speed) {
  const span = FORMATIONS.tiltMaxSpeed - FORMATIONS.tiltMinSpeed;
  return clamp((speed - FORMATIONS.tiltMinSpeed) / span, 0, 1);
}

// Locked role sequence per formation id. Wall roles carry the gap they want;
// offsetTurn locks a big slalom offset; multi-window formations draw ALL their
// windows here so a retry can never change the shape that follows.
function rolesFor(id, rng) {
  switch (id) {
    case 'breather':
      return [{ role: 'breather' }];
    case 'wideGate':
      return [{ role: 'wall', gx: (rng() * 2 - 1) * 6, gw: 9 + rng() * 3 }];
    case 'offsetTurn': {
      const offset = 9 + rng() * 3;
      return [{ role: 'slalom', offset }, { role: 'slalom', offset }];
    }
    case 'fork': {
      const gx = (rng() < 0.5 ? -1 : 1) * (4 + rng() * 4);
      return [{ role: 'center' }, { role: 'wall', gx, gw: PATTERN.minGap + 0.6 }];
    }
    case 'chicane': {
      const gx = (rng() < 0.5 ? -1 : 1) * 7;
      const gw = PATTERN.minGap + 0.8;
      return [{ role: 'wall', gx, gw }, { role: 'wall', gx: -gx, gw }];
    }
    case 'riskLane': {
      const gx = (rng() < 0.5 ? -1 : 1) * (10 + rng() * 3);
      return [{ role: 'wall', gx, gw: 3.6 + rng() * 0.9 }];
    }
    default: // slalom | wall | center | cluster — the basics are the shape itself
      return [{ role: id }];
  }
}

// Weighted, difficulty-gated pick. `last` is excluded so no formation repeats
// back-to-back (unless it is the only one the difficulty has unlocked, in which
// case the field would otherwise be empty). Draws only from the window's pick
// stream, so attempt re-rolls cannot perturb the choice or the cursor.
function pickFormation(difficulty, speed, last, rng) {
  const t = speedT(speed);
  const all = [];
  for (const id of Object.keys(FORMATIONS.roster)) {
    const f = FORMATIONS.roster[id];
    if (f.minD > difficulty) continue;
    const w = f.weight * (1 + f.tilt * t);
    if (w > 0) all.push({ id, w });
  }
  if (!all.length) return { id: 'wall', seq: rolesFor('wall', rng) };
  let pool = all.filter(e => e.id !== last);
  if (!pool.length) pool = all;
  const total = pool.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  let chosen = pool[pool.length - 1];
  for (const e of pool) { r -= e.w; if (r <= 0) { chosen = e; break; } }
  return { id: chosen.id, seq: rolesFor(chosen.id, rng) };
}

// Build one locked row role. A breather never reaches here (it commits an
// intentionally empty window upstream).
function buildRole(spec, rng, rowZ, d, prevSign) {
  switch (spec.role) {
    case 'slalom': return slalomRow(rng, rowZ, d, prevSign, spec);
    case 'wall': return wallRow(rng, rowZ, d, spec);
    case 'center': return centerRow(rng, rowZ, d);
    case 'cluster': return clusterRow(rng, rowZ, d);
    default: return { row: [] };
  }
}

function pickKind(kinds, rng) { return kinds[Math.floor(rng() * kinds.length)]; }

// Compose one chunk of cursor-anchored pattern rows.
//
// state = { cursor, prevRow } — the cross-chunk generation state. Pure:
// identical arguments return identical chunks. The chunk places every row
// whose nominal anchor lands in ITS span (110 u/s windows exceed one chunk;
// empty chunks are correct). prevRow carries the previous chunk's last row so
// the chain check holds across chunk boundaries.
export function composeChunk(index, difficulty, seed = 1, speed = 25, state = null) {
  const d = clamp01(difficulty);
  const spanStart = index * WORLD.chunkLength;
  const spanEnd = spanStart + WORLD.chunkLength;
  let cursor = (state && state.cursor) ?? (spanStart + PATTERN.rowZ0);
  let prevRow = state && state.prevRow ? state.prevRow : null; // {rowZ(abs), obstacles, wall}
  let prevSign = (state && state.prevSlalomSign) ?? (mulberry32(streamKey(seed, index, 4, 0))() < 0.5 ? -1 : 1);
  // formation state { id, seq, last, breathers } threads across chunks exactly
  // like the cursor: generateChunk's replay and world.js's genState both pass
  // it, or chunk N diverges from the streamed one.
  let form = {
    id: (state && state.form && state.form.id) ?? null,
    seq: (state && state.form && state.form.seq) ? state.form.seq.slice() : [],
    last: (state && state.form && state.form.last) ?? null,
    breathers: (state && state.form && state.form.breathers) || 0,
    // pick bookkeeping: `picks` counts every pick (a breather is a pick), and
    // `pick` is the pick number the formation in progress came from. Rows tagged
    // with the same number are one formation's windows; a gap means another pick
    // (usually a breather) came between them — the no-repeat guard only forbids
    // ADJACENT picks from repeating.
    picks: (state && state.form && state.form.picks) || 0,
    pick: (state && state.form && state.form.pick) ?? null,
  };
  const obstacles = [];
  let ordinal = 0;

  while (cursor < spanEnd) {
    // anchor base clamped into this chunk's span past the ±2 member jitter;
    // when the promised window can't hold inside the span the row belongs to
    // the next chunk (110 u/s windows exceed one chunk) — never clamp a row
    // below the window its predecessor promises
    const jitter = mulberry32(streamKey(seed, index, 1, ordinal))() * PATTERN.zJitterMax;
    const base = Math.max(cursor, spanStart + 3);
    const anchorAbs = Math.min(base + jitter, spanEnd - 3);
    if (prevRow && anchorAbs - prevRow.rowZ < windowDistance(speed, prevRow.wall)) break;
    const anchorLocal = anchorAbs - spanStart;
    // one formation pick per window, BEFORE the attempt loop: the locked role
    // is reused by every retry (retries re-jitter, they never re-pick)
    if (!form.seq.length) {
      const picked = pickFormation(d, speed, form.last, mulberry32(streamKey(seed, index, 5, ordinal)));
      form.picks++;
      form.pick = form.picks;
      form.id = picked.id;
      form.seq = picked.seq;
    }
    const spec = form.seq[0];
    // intentional breather: the empty window IS the deliverable — commit it, let
    // the chain reset, and keep the cursor on the normal window cadence so the
    // 1.2 s floor still holds on both sides of the rest
    if (spec.role === 'breather') {
      form.breathers++;
      form.picks++; // a breather is a pick: it separates the rows either side
      form.last = form.id;
      form.seq = [];
      form.id = null;
      prevRow = null;
      cursor = anchorAbs + windowDistance(speed, false);
      ordinal++;
      continue;
    }
    let row = null, nextSign = prevSign;
    for (let attempt = 0; attempt < PATTERN.maxAttempts && !row; attempt++) {
      const rng = mulberry32(streamKey(seed, index, 2, ordinal, attempt));
      const out = buildRole(spec, rng, anchorLocal, d, prevSign);
      if (out.prevSign != null) nextSign = out.prevSign; // slalom roles alternate
      row = out.row;
      if (!row.length) { row = null; continue; }
      // movers first: the chain check must see the FINAL swept envelopes, not
      // a pre-sweep promise (a 6 m mover can close a corridor silently)
      flagMovers(row, d, mulberry32(streamKey(seed, index, 3, ordinal, attempt)));
      if (prevRow) {
        const dz = anchorAbs - prevRow.rowZ;
        if (dz <= 0 || !chainReachable(prevRow.obstacles, row, dz, speed)) { row = null; }
      }
    }
    if (!row) {
      // enforced breather: skip one full window; the chain resets after it and
      // the formation state drops its locked continuation, so a half-realised
      // multi-window formation never strands its remaining roles
      cursor = anchorAbs + windowDistance(speed, false);
      ordinal++;
      prevRow = null;
      form.seq = [];
      form.id = null;
      continue;
    }
    for (const o of row) { o.rowZ = anchorLocal; o.form = form.id; o.formPick = form.pick; }
    obstacles.push(...row);
    // wall-ness for the after-spacing floor comes from the ROLE, never from the
    // shape tag (a fork's wall continuation counts as wall)
    const roleIsWall = spec.role === 'wall';
    prevRow = { rowZ: anchorAbs, obstacles: row, wall: roleIsWall };
    prevSign = nextSign;
    cursor = anchorAbs + windowDistance(speed, roleIsWall);
    form.seq.shift();
    form.last = form.id;
    if (!form.seq.length) form.id = null;
    ordinal++;
  }

  return {
    index, difficulty: d, obstacles,
    cursorOut: cursor,
    prevRowState: prevRow,
    prevSlalomSign: prevSign,
    formOut: form,
  };
}

// Legacy signature kept for callers/tests: pure per-(index, …) chunk via
// sequential replay of the cross-chunk state (memoized — world.js threads the
// state directly, generating each chunk exactly once per run).
//
// prevRow.rowZ is ABSOLUTE (it feeds only the z/dz chain math), so it threads
// across chunk boundaries unchanged.
const replayCache = new Map();
export function generateChunk(index, difficulty, seed = 1, speed = 25) {
  const cacheKey = `${seed}|${speed}|${difficulty}|${index}`;
  if (replayCache.has(cacheKey)) return replayCache.get(cacheKey);
  let state = null;
  for (let i = 0; i < index; i++) {
    const out = composeChunk(i, difficulty, seed, speed, state);
    state = { cursor: out.cursorOut, prevRow: out.prevRowState, prevSlalomSign: out.prevSlalomSign, form: out.formOut };
  }
  const chunk = composeChunk(index, difficulty, seed, speed, state);
  replayCache.set(cacheKey, chunk);
  return chunk;
}

// Clearest lateral line for a length of water (coin trails): the candidate x
// whose WORST clearance to every disc reaching the span is the largest. Pure
// scoring — callers use the clearance to shrink the weave and skip coins that
// would sit inside a hull. Never null: hopeless water returns the best
// available x with its (possibly negative) clearance. Ties keep the x closest
// to the lane center (deterministic; open water stays center).
export function findClearLane(discs, z0, z1) {
  const rel = discs.filter(d => d.z + (d.rz ?? d.radius) >= z0 && d.z - (d.rz ?? d.radius) <= z1);
  const clearance = (x) => {
    let c = Infinity;
    for (const d of rel) c = Math.min(c, Math.abs(x - d.x) - (d.rx ?? d.radius));
    return c;
  };
  const lane = WORLD.laneHalfWidth;
  const candidates = [0];
  for (let k = 1; k <= lane; k++) candidates.push(k, -k);
  let best = { x: 0, clearance: clearance(0) };
  for (const x of candidates) {
    const c = clearance(x);
    if (c > best.clearance + 1e-9) best = { x, clearance: c };
  }
  return best;
}
