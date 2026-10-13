// Pure wake-trail math (no three.js, unit-tested). The three.js ribbon and
// ripple pool in js/wake.js build on these helpers.

export function createTrail(maxPoints, minSpacing) {
  return { points: [], maxPoints, minSpacing };
}

// Append a surface sample; ignores samples closer than minSpacing to the last
// (keeps the ribbon even at low frame rates) and evicts the oldest past cap.
export function trailPush(trail, x, z, t) {
  const pts = trail.points;
  const last = pts[pts.length - 1];
  if (last) {
    const dx = x - last.x, dz = z - last.z;
    if (Math.sqrt(dx * dx + dz * dz) < trail.minSpacing) return false;
  }
  pts.push({ x, z, t });
  while (pts.length > trail.maxPoints) pts.shift();
  return true;
}

// Ribbon half-width scale from speed: a narrow thread at MinSpeed, full foam
// at cruise and above. Bounded so low speed reads calm, never absent.
export function wakeWidthForSpeed(speed) {
  return Math.min(1.6, Math.max(0.25, (speed - 8) / 40 + 0.25));
}
