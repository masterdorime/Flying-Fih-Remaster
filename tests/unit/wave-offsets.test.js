// T8 (spec §3, "dependent offsets"): raising the wave amplitude from 0.93 m to the
// contracted 1.2–1.6 m band is only safe if the offsets that ride the field still
// clear it. The plan assumed every offset would need bumping; MEASUREMENT said
// otherwise, so this file pins the constraint rather than a set of magic numbers.
//
// The one offset with a real clearance job is GATE.swimLift: a swim gate sits at
// `surfaceHeight(gate) + swimLift`, so its lower rim stays dry only while swimLift
// covers how far the sea can rise ACROSS THE MOUTH from the height at its centre.
// (Coin skim and the fish's draft are surface-RELATIVE — they ride the field at their
// own x/z — so the amplitude does not change what they need. That is why they are not
// swept: a global-peak rule would inflate them for no reason.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceHeight, WAVE_TERMS, WAVE_AMPLITUDE } from '../../js/wave.js';
import { GATE } from '../../js/config.js';

// Analytic bound on how far the surface can differ between two points R apart at one
// instant: |Δh| ≤ Σ a_i·|k_i|·R, the mean value theorem applied per sine term.
function slopeBound() {
  let k = 0;
  for (const t of WAVE_TERMS) k += Math.abs(t.a) * Math.hypot(t.kx, t.kz);
  return k;
}

test('the wave field sits in the contracted amplitude band (§3: 1.2–1.6 m)', () => {
  assert.ok(WAVE_AMPLITUDE >= 1.2 && WAVE_AMPLITUDE <= 1.6,
    `WAVE_AMPLITUDE ${WAVE_AMPLITUDE.toFixed(3)} must be inside the contracted band`);
});

test('GATE.swimLift keeps the ring mouth out of the sea at the current amplitude', () => {
  const R = GATE.mouthRadius;
  const bound = slopeBound() * R;
  assert.ok(GATE.swimLift > bound,
    `swimLift ${GATE.swimLift} must clear the analytic mouth bound ${bound.toFixed(3)} m`);
});

test('GATE.swimLift also clears the measured worst deviation on the real field', () => {
  const R = GATE.mouthRadius;
  let worst = 0;
  for (let ci = 0; ci < 120; ci++) {
    const cx = Math.sin(ci * 1.7) * 14;
    const cz = ci * 5.3;
    for (let ti = 0; ti < 24; ti++) {
      const t = ti * 0.9;
      const h0 = surfaceHeight(cx, cz, t);
      for (let ai = 0; ai < 12; ai++) {
        const a = (ai / 12) * Math.PI * 2;
        const d = Math.abs(surfaceHeight(cx + Math.cos(a) * R, cz + Math.sin(a) * R, t) - h0);
        if (d > worst) worst = d;
      }
    }
  }
  assert.ok(GATE.swimLift > worst,
    `swimLift ${GATE.swimLift} must clear the measured worst mouth deviation ${worst.toFixed(3)} m`);
});
