// T10 (spec §4.6, cohesion): hulls ride the wave VISUALLY, while collision keeps the
// canonical layout height. That split IS the contract, and world.js is impure (THREE, scene
// graph), so it is pinned at the source level — the same approach as wave-port and
// shader-parity, and for the same reason: the failure mode is invisible to a pure test.
//
// Why it matters: if the collision gate ever follows mesh.position.y again, hit detection
// starts moving with the swell. That is a §4-row-6 collision change, and it would make the
// honest-capsule contract silently depend on the sea state at the moment of contact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'world.js'),
  'utf8',
);

test('the collision gate reads the canonical layout height, never the rendered one', () => {
  assert.ok(src.includes('const dy = Math.abs(spec.y - playerPos.y);'),
    'the dy gate must read spec.y (canonical). See the §4-row-6 note in world.js.');
  assert.ok(!/Math\.abs\(mesh\.position\.y - playerPos\.y\)/.test(src),
    'the dy gate must NOT read mesh.position.y — that now carries the wave offset');
});

test('hulls ride the shared wave field, budgeted by range', () => {
  assert.ok(/import \{[^}]*waveOffset[^}]*\} from '\.\/wave\.js';/.test(src),
    'world.js must import the SHARED wave field (waveOffset from ./wave.js), not its own copy');
  assert.ok(/spec\.y \+ waveOffset\(mesh\.position\.x, mesh\.position\.z, elapsed\)/.test(src),
    'the rendered y must be the canonical height plus the shared wave offset at that x/z');
  assert.ok(src.includes('ATMOSPHERE.props.sampleRange'),
    'sampling must be budgeted by ATMOSPHERE.props.sampleRange, not applied to every prop in the pool');
});
