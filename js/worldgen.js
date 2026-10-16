// Procedural chunk generation (PRD §11, §12). Pure: layout decisions only; rendering lives in world.js.
// Phase 3: freeform pattern rows (slalom / wall / center / cluster) with a
// validated per-row gap — the center is sometimes occupied, but every chunk
// keeps a swimmable route (see docs/superpowers/specs/2026-10-16-obstacle-patterns-design.md).
import { WORLD, DIFFICULTY, PATTERN } from './config.js';

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

export const WORLD_HALF = WORLD.laneHalfWidth; // single name for the sweep bounds (and tests)

// Difficulty ramps by distance OR time, whichever is faster (PRD §13).
export function difficultyAt(distanceMeters, runTimeSeconds) {
  const byDistance = distanceMeters / DIFFICULTY.rampMeters;
  const byTime = runTimeSeconds / DIFFICULTY.rampSeconds;
  return clamp01(Math.max(byDistance, byTime));
}

const RADII = { rock: 2.6, buoy: 1.1, boat: 3.4, container: 2.2 };

function kindsFor(difficulty, rng) {
  if (difficulty < 0.25) return ['rock', 'buoy'];
  if (difficulty < 0.6) return ['rock', 'buoy', 'boat'];
  return ['rock', 'buoy', 'boat', 'container', 'buoy'];
}

function groundY(kind) { return kind === 'buoy' ? 1.2 : 0.7; }

// Lateral intervals for one row: movers count by their full swept
// envelope, so the gap holds for every phase of the sweep, not just its ends.
function rowIntervals(obstacles) {
  return obstacles.map(o => {
    const reach = o.radius + (o.moving ? o.range : 0);
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

// Safety validator (Phase 3, replaces hasSafeCorridor): every z-row of the
// chunk must keep a lateral gap of at least PATTERN.minGap.
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
  return rows.every(rowGapOk);
}

function pickKind(kinds, rng) { return kinds[Math.floor(rng() * kinds.length)]; }

function baseObstacle(kind, x, z, pattern) {
  return {
    kind, x, y: groundY(kind), z,
    radius: RADII[kind],
    moving: false, phase: 0, speed: 1, range: 0,
    pattern,
  };
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
    if (!rowGapOk(row)) { o.moving = false; o.range = 0; }
  }
  return row;
}

function slalomRow(rng, rowZ, d, prevSign) {
  const sign = -prevSign;
  const o = baseObstacle(pickKind(kindsFor(d, rng), rng), sign * (5 + rng() * 5), rowZ, 'slalom');
  return { row: [o], prevSign: sign };
}

function wallRow(rng, rowZ, d) {
  const gx = -11 + rng() * 22;
  const w = 3.2 + rng() * 1.8;
  const kinds = kindsFor(d, rng);
  let cursor = -WORLD_HALF;
  let k = Math.floor(rng() * kinds.length);
  const row = [];
  while (cursor < WORLD_HALF && row.length < PATTERN.wallMax) {
    const kind = kinds[k % kinds.length];
    k++;
    const r = RADII[kind];
    if (cursor + r > WORLD_HALF) break; // centers stay in the lane (fish clamps to ±14)
    if (cursor + 2 * r > gx - w / 2 && cursor < gx + w / 2) { cursor = gx + w / 2; continue; }
    const o = baseObstacle(kind, cursor + r, rowZ + (rng() * 2 - 1) * 2, 'wall');
    row.push(o);
    cursor += 2 * r + rng() * 1.5;
  }
  return { row };
}

function centerRow(rng, rowZ, d) {
  const n = 1 + Math.floor(rng() * 2);
  const row = [];
  for (let i = 0; i < n; i++) {
    const o = baseObstacle(
      pickKind(kindsFor(d, rng), rng),
      (rng() * 2 - 1) * (WORLD.corridorHalfWidth - 1),
      rowZ + (rng() * 2 - 1) * 2,
      'center',
    );
    row.push(o);
  }
  return { row };
}

function clusterRow(rng, rowZ, d) {
  const n = 2 + Math.floor(rng() * 2);
  const cx = (rng() * 2 - 1) * 10;
  const row = [];
  for (let i = 0; i < n; i++) {
    const o = baseObstacle(
      pickKind(kindsFor(d, rng), rng),
      clamp(cx + (rng() * 2 - 1) * 4, -WORLD_HALF, WORLD_HALF),
      rowZ + (rng() * 2 - 1) * 2,
      'cluster',
    );
    row.push(o);
  }
  return { row };
}

const PATTERNS = ['slalom', 'wall', 'center', 'cluster'];

// One 120 m chunk of pattern rows. Rows scale with difficulty (count) and
// speed (spacing); shapes never unlock by tier — variety shows from the start.
export function generateChunk(index, difficulty, seed = 1, speed = 25) {
  const d = clamp01(difficulty);
  const spacing = clamp(speed * PATTERN.spacingSeconds, PATTERN.spacingMin, PATTERN.spacingMax);
  const rows = Math.min(Math.round(lerp(2, 7, d)), 1 + Math.floor((PATTERN.rowZ1 - PATTERN.rowZ0) / spacing));
  const base = (seed * 2654435761 + index * 40503) >>> 0;
  for (let attempt = 0; attempt < PATTERN.maxAttempts; attempt++) {
    const rng = mulberry32((base + attempt * 7919) >>> 0);
    const obstacles = composeRows(rng, d, rows, spacing);
    obstacles.sort((a, b) => a.z - b.z);
    const chunk = { index, difficulty: d, obstacles };
    if (validateChunkGaps(chunk)) return chunk;
  }
  // Fallback: a single static rock far to the side — provably valid
  // (one 2.6-radius obstacle leaves a 22.8 m gap).
  const rock = baseObstacle('rock', 10, 60, 'fallback');
  return { index, difficulty: d, obstacles: [rock] };
}

function composeRows(rng, d, rows, spacing) {
  const obstacles = [];
  let prevSlalomSign = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < rows; i++) {
    const rowZ = Math.min(PATTERN.rowZ0 + i * spacing + rng() * 6, PATTERN.rowZ1);
    const shape = PATTERNS[Math.floor(rng() * PATTERNS.length)];
    let out;
    if (shape === 'slalom') { out = slalomRow(rng, rowZ, d, prevSlalomSign); prevSlalomSign = out.prevSign; }
    else if (shape === 'wall') out = wallRow(rng, rowZ, d);
    else if (shape === 'center') out = centerRow(rng, rowZ, d);
    else out = clusterRow(rng, rowZ, d);
    obstacles.push(...flagMovers(out.row, d, rng));
  }
  return obstacles;
}

export const RADIUS_TABLE = RADII;
