import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skyBands, skyCoverageGaps, bandCoversXZ, skyPuffCount, seaTopY, SEA_AREA, SEA_PUFF_BUDGET } from '../../js/sky-layers.js';
import { FLIGHT, ATMOSPHERE } from '../../js/config.js';

// ---- the cloud sea's contract (2026-10-23, phase 4; spec docs/superpowers/specs/2026-10-23-flight-environment-design.md) ----
//
// The user's requirement was "a vast sea of cloud with NO HOLLOW ON IT". The old sea was one plane carrying
// a SOFT-ALPHA texture, so its gaps were see-through — a hollow you could look down through to the sky. The
// replacement is a stack of altitude bands, and these tests are what make "no hollow" a property of the
// DATA rather than a hope about a texture:
//
//   * the bands must be CONTIGUOUS in y — a vertical gap is literally a hole to see through;
//   * the deepest band must be OPAQUE and its puffs must OVERLAP in x/z, so the floor is closed;
//   * the whole sea must stay under the flight lane, or it would occlude rings and coins.

test('no hollow: every metre between the sea top and the floor is inside a band', () => {
  assert.deepEqual(skyCoverageGaps(), [],
    'a vertical gap between bands is a hole you can look through to the sky');
});

test('no hollow: the deepest band is opaque, and its puffs cover the ground they span', () => {
  const bands = skyBands();
  const deepest = bands.reduce((a, b) => (b.yBottom < a.yBottom ? b : a));
  assert.equal(deepest.opacity, 1, 'the floor band must be fully opaque, or the sea has holes under it');
  assert.ok(bandCoversXZ(deepest, SEA_AREA),
    `a band's puffs must overlap to close the sea: size ${deepest.size[0]}..${deepest.size[1]} vs spacing ${deepest.spacing.toFixed(0)}`);
});

test('the sea can never rise into the lane a ring or a coin lives in', () => {
  // the flight lane is flyMin 57 up to the climb ceiling, and flight gates spawn in the 63-104 band, so the
  // sea's surface has to sit well below all of it
  assert.ok(seaTopY() <= 50, `sea top ${seaTopY()} must stay at or under 50`);
  assert.ok(seaTopY() <= FLIGHT.flyMin - 5, `and clear of the flight floor (flyMin ${FLIGHT.flyMin})`);
});

test('the sea ends in haze, not in an edge: the field reaches past the fog', () => {
  const far = ATMOSPHERE.flight.fog.far;
  assert.ok(SEA_AREA.z >= 2 * far,
    `the recycled field (${SEA_AREA.z} m deep) must extend past the haze (far ${far}) so its edge is never the thing you see`);
  assert.ok(ATMOSPHERE.flight.fog.far <= 520, `and the haze itself stays readable (far ${far})`);
});

test('the sea stays inside its quad budget', () => {
  assert.ok(skyPuffCount() <= SEA_PUFF_BUDGET, `${skyPuffCount()} puffs against a budget of ${SEA_PUFF_BUDGET}`);
  assert.ok(skyPuffCount() >= 120, `${skyPuffCount()} puffs is too thin to read as a sea`);
});
