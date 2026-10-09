// Procedural chunk generation (PRD §11, §12). Pure: layout decisions only; rendering lives in world.js.
import { WORLD, DIFFICULTY } from './config.js';

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

// One 120 m chunk. Obstacles are ALWAYS placed outside the central corridor,
// so a safe lane down the middle always exists (PRD §12.4 safety constraints).
export function generateChunk(index, difficulty, seed = 1) {
  const rng = mulberry32((seed * 2654435761 + index * 40503) >>> 0);
  const d = clamp01(difficulty);
  const count = Math.round(lerp(2, 7, d));
  const obstacles = [];
  const kinds = kindsFor(d, rng);
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const radius = RADII[kind];
    const corridor = WORLD.corridorHalfWidth + radius;
    const x = side * (corridor + rng() * Math.max(1, WORLD.laneHalfWidth - corridor));
    const z = (i + 0.35) * (WORLD.chunkLength / count) + rng() * 9;
    const elevated = kind !== 'boat' && rng() < d * 0.4; // flying hazards appear later
    const y = elevated ? lerp(8, 24, rng()) : (kind === 'buoy' ? 1.2 : 0.7);
    const moving = rng() < lerp(0, 0.55, d);
    obstacles.push({
      kind, x, y, z,
      radius,
      moving,
      phase: rng() * Math.PI * 2,
      speed: lerp(0.5, 1.4, rng()),
      range: lerp(2, 6, rng()),
    });
  }
  obstacles.sort((a, b) => a.z - b.z);
  return { index, difficulty: d, obstacles };
}

// Safety validator (PRD §12.4, §27.3): the central corridor must be clear.
export function hasSafeCorridor(chunk) {
  for (const o of chunk.obstacles) {
    if (Math.abs(o.x) - o.radius < WORLD.corridorHalfWidth) return false;
  }
  return true;
}

export const RADIUS_TABLE = RADII;
