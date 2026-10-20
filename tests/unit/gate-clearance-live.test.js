// STRUCTURAL gate clearance (2026-10-20, §4 row 4). A gate's clearance was checked ONCE, at
// spawn, against the discs visible then. world.js's ensureChunks composes ahead and REMOVES
// chunks behind, so that is not the disc set the gate goes on to live in — and a hull can
// become relevant underneath a gate that was legally placed.
//
// Observed live twice (t19-fairness phase 4, 2026-10-18 and again on the S2 gate): a 16 m
// liner (rx 2.09, rz 8.4, x -2.65, z 52.7) under a gate at (x -0.64, z 45.41) — lat -0.08,
// i.e. dead through the hull — with 125 legal planes available and the resolver's own re-run
// on the same discs returning a clear x. So the fix is not to place better at spawn; it is to
// re-assert the invariant while the gate is LIVE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearGateX } from '../../js/timing.js';
import { GATE } from '../../js/config.js';

const BAR = GATE.mouthRadius + GATE.clearanceMargin;

// worst lateral clearance at a plane, mirroring the resolver's own scope rule
const near = (discs, z) => discs.filter((d) => Math.abs(d.z - z) <= (d.rz ?? d.radius) + GATE.mouthRadius);
const clearanceAt = (z, x, discs) => {
  let c = Infinity;
  for (const d of near(discs, z)) c = Math.min(c, Math.abs(x - d.x) - (d.rx ?? d.radius));
  return c;
};

// the exact shape the gate sampler caught live
const LINER = { x: -2.65, z: 52.7, rx: 2.09, rz: 8.4, kind: 'rock' };
const GATE_Z = 45.41;
const BLOCKED_X = -0.64;

test('clearGateX leaves a legal gate EXACTLY where it is', () => {
  const discs = [LINER];
  const legalX = -14; // the clearest lane edge in the observed case
  assert.ok(clearanceAt(GATE_Z, legalX, discs) >= BAR, 'fixture: -14 must be legal');
  assert.equal(clearGateX(legalX, GATE_Z, discs), legalX,
    'an already-clear gate must never move (this is what makes a per-frame re-check safe)');
});

test('clearGateX rescues the live-blocked gate the sampler caught', () => {
  const discs = [LINER];
  // fixture sanity: the observed placement really is illegal at this plane
  assert.ok(clearanceAt(GATE_Z, BLOCKED_X, discs) < BAR,
    'fixture: the observed placement must be blocked, or this test proves nothing');
  const fixed = clearGateX(BLOCKED_X, GATE_Z, discs);
  assert.notEqual(fixed, BLOCKED_X, 'it must move a blocked gate off the hull');
  assert.ok(clearanceAt(GATE_Z, fixed, discs) >= BAR,
    `the repaired x must clear the bar: got ${clearanceAt(GATE_Z, fixed, discs).toFixed(2)} at x ${fixed}`);
});

test('clearGateX keeps the plane: it repairs x, never z', () => {
  // A live gate's z is committed: the QTE window origin and gateBehind both read it, so
  // shifting z mid-approach would move the objective in time as well as space.
  const discs = [LINER];
  assert.equal(typeof clearGateX(BLOCKED_X, GATE_Z, discs), 'number',
    'clearGateX returns an x (a number), not a placement object');
});

test('clearGateX takes the NEAREST legal x, not the clearest one', () => {
  // The LIVE repair wants the smallest disturbance: the clearest x is often the far lane edge,
  // so a repair could drag a ring 13 m sideways while the player lines it up (t08-gates caught
  // that shape on the first version of this fix). The spawn-time resolver keeps clearest-x; only
  // the live repair is gentle.
  const discs = [{ x: 0, z: GATE_Z, rx: 2.0, rz: 2.0 }]; // blocks the middle
  const fixed = clearGateX(0.5, GATE_Z, discs);
  assert.ok(clearanceAt(GATE_Z, fixed, discs) >= BAR, 'repaired x clears the bar');
  // the grid's nearest legal x on the right is 6.0; the far lane edge (14) also clears, and
  // choosing it would be a 13.5 m drag instead of 5.5
  const farEdge = clearanceAt(GATE_Z, 14, discs);
  assert.ok(farEdge > clearanceAt(GATE_Z, fixed, discs), 'fixture: the lane edge is genuinely clearer');
  assert.ok(Math.abs(fixed - 0.5) <= 6.0, `the repair must stay near the gate, moved ${Math.abs(fixed - 0.5)} m to ${fixed}`);
});
