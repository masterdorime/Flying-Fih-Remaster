// t08-gates — ring-triggered QTE (2026-10-15; CENTRED + tick model 2026-10-22): crossing INSIDE the ring
// mouth opens exactly one SPACE window and the press time picks the grade against the cue's TARGET moment
// (within one tick of it = Perfect, within 0.38 s = Good, later or never Miss). The window is a fixed
// width and the target moves per trigger, so the opportunity never changes but the question does.
// Crossing outside the mouth is a plain Miss with no window at all; a pending window owns its gate so the
// behind-miss can't fire early; one live gate at a time, spaced by the cooldown. Popups use the
// observer-recorder pattern (~850ms lifetime).
// The #ffm-qte cue carries the window (style cue + static target + beat + the key as its own surface),
// and a press while paused must not grade.
import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => {
  window.__POPUPS = [];
  new MutationObserver(() => {
    for (const e of document.querySelectorAll('.ffm-popup')) {
      const t = e.textContent.trim();
      if (t && !window.__POPUPS.includes(t)) window.__POPUPS.push(t);
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.__FFM_API.start();
});

// 1. a gate spawns ahead (poll: sim runs slow under software rendering)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 90000 });
const g0 = await page.evaluate(() => window.__FFM_API.gate());
assert(g0 && g0.z > 0, `gate spawns ahead (z=${g0?.z})`);
// The SPAWN corridor is ±GATE.corridorX, but this x is read AFTER resolveGatePlacement, whose lateral
// rescue searches the whole LANE by design (stage A: a ring boxed in by hulls takes the clearest x at a
// legal plane, and its own comment calls a lane-edge move the last resort). So the honest bound here is the
// lane. This assertion read `<= 4` and passed for weeks only because the gate stream was seeded from a
// fixed literal — the first gate never needed a rescue. Re-seeding per run (2026-10-22) exposed it: on one
// run the first gate was rescued to x=4.86. NOT a code change: the spawn bound is still ±4 in config and
// still enforced at the draw (js/timing.js createGate), which is what `corridorX` describes.
const laneHalf = await page.evaluate(() => window.__FFM_API.debugGateLaneHalf().laneHalfWidth);
assert(Math.abs(g0.x) <= laneHalf + 1e-9, `gate placed inside the lane (x=${g0.x.toFixed(2)}, lane ±${laneHalf})`);

// 2. crossing the mouth opens exactly one QTE; an early press -> PERFECT
// (read + press in one evaluate: a separate CDP round trip could cross the
// 300 ms perfect window under load and grade GOOD instead)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 90000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => {
  const q = window.__FFM_API.qte();
  if (q) window.__FFM_API.debugPressAt(q.targetAt);
});
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'perfect', null, { timeout: 60000 });
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.perfect, 1, 'perfect counted');
assert(s.gauge > 0, `perfect fills the gauge (${s.gauge})`);
assertEqual(s.chain, 1, 'chain starts');
const popups = await page.evaluate(() => (window.__POPUPS ?? []).join(','));
assert(popups.includes('PERFECT'), `PERFECT popup recorded (${popups})`);

// 3. a late (but in-window) press -> GOOD (press at an explicit run-time so
//    frame pacing can't jump the window)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => {
  const q = window.__FFM_API.qte();
  window.__FFM_API.debugPressAt(q.targetAt + q.perfectHalf + 0.05);
});
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'good', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.good, 1, 'good counted');
assertEqual(s.chain, 2, 'good extends the chain');

// 4. no press before the deadline -> MISS (chain reset, speed cut)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
const preMiss = await page.evaluate(() => window.__FFM_API.state().speed);
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
// poll the deadline on runTime alone: the auto-miss nulls the QTE on the very
// frame the deadline is crossed, so a predicate that also needs a live QTE
// could never observe "past the window" — it would just time out
const deadline = await page.evaluate(() => {
  const q = window.__FFM_API.qte();
  return q ? q.deadline : null;
});
assert(deadline !== null, 'window opened with a deadline to poll');
await page.waitForFunction((d) => window.__FFM_API.state().runTime > d, deadline, { timeout: 60000 });
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'miss', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.chain, 0, 'miss resets the chain');
assert(s.speed < preMiss, `miss cuts speed (${preMiss.toFixed(1)} -> ${s.speed.toFixed(1)})`);
assertEqual(s.counts.miss, 1, 'miss counted');

// 14. a pending window outlives the behind-miss threshold — the deadline is
// its only expiry (numbered out of order: it must run here, while a fresh
// window is cheap to open, before the terminal section 12)
await page.evaluate(() => window.__FFM_API.debugSetSpeed(40));
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.waitForFunction(() => {
  const api = window.__FFM_API;
  const q = api.qte(), g = api.gate(), z = api.state().position[2];
  return q && !q.resolved && g && (z - g.z) >= 6;
}, null, { timeout: 30000 });
assert(await page.evaluate(() => window.__FFM_API.qte() !== null),
  'a pending QTE survives being 6 m past the plane (no behind-miss on top of the window)');
// resolve §14's window so it can't pollute section 5's "no window opened" watch
const p14 = await page.evaluate(() => window.__FFM_API.state().counts.perfect);
await page.evaluate(() => {
  const q = window.__FFM_API.qte();
  if (q) window.__FFM_API.debugPressAt(q.targetAt);
});
await page.waitForFunction((p) => window.__FFM_API.state().counts.perfect > p, p14, { timeout: 60000 });

// 5. crossing OUTSIDE the mouth -> plain miss, and NO window ever opens
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
const wide = await page.evaluate(async () => {
  const api = window.__FFM_API;
  let sawQte = false;
  const before = api.state().counts.miss;
  api.debugTeleportToRing(9, 0);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 25));
    if (api.qte()) sawQte = true;
    if (api.state().counts.miss > before) break;
  }
  return { sawQte, before, after: api.state().counts.miss };
});
assert(!wide.sawQte, 'no QTE window opens when the crossing misses the mouth');
assertEqual(wide.after, wide.before + 1, 'wide crossing counted as a plain miss');

// 6. flight gates sit inside the climb band so W/S alignment matters
await page.evaluate(() => { window.__FFM_API.setGauge(115); window.__FFM_API.debugForceFlight(); });
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', null, { timeout: 60000 });
await page.waitForFunction(() => {
  const g = window.__FFM_API.gate();
  return g && g.y >= 63 && g.y <= 104;
}, null, { timeout: 90000 });
assert(true, 'flight gate inside the 63-104 band');

// 6b. the ring's COLOUR survives its own proximity tint (2026-10-22). The tint passed a hex NUMBER to
//     THREE.Color.lerp, which takes a Color: it read `.r/.g/.b` off a number, so all three channels went
//     NaN — and a NaN colour renders BLACK. That one wrong argument is the whole of the long-standing "the
//     gate ring renders as a heavy black hoop" report: not the geometry, not the post-processing, and not
//     something replacing the ring with a 3D asset would have fixed.
//
//     The tint only runs on a frame that no flash owns (`flashLeft === 0`), and a flash sets the colour
//     directly (and validly). Sampling must therefore happen IN-PAGE, on the same frame it accepts, or a
//     flash that starts between the wait and the read masks the bug — which it did, twice, before this.
const ringSamples = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const out = [];
  const until = performance.now() + 90000;
  while (performance.now() < until && out.length < 3) {
    const i = api.debugGateFlash();
    if (i.visible && i.flashLeft === 0) out.push(i);
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
});
assert(ringSamples.length >= 1, `must catch a frame the tint owns (got ${ringSamples.length})`);
for (const s of ringSamples) {
  assertEqual(s.ringFinite, true, `the ring's colour must survive the tint (ring ${s.ring})`);
  assert(s.ring !== '#000000' && !s.ring.includes('NaN'), `and must not be black/NaN (ring ${s.ring})`);
}

// 7. the gate flash actually renders: visible + colored after a resolve
await page.waitForFunction(() => (window.__FFM_API.debugGateFlash()?.flashLeft ?? 0) > 0, null, { timeout: 60000 });
const flash = await page.evaluate(() => window.__FFM_API.debugGateFlash());
assert(flash.visible && flash.flashLeft > 0, `flash renders after a resolve (${JSON.stringify(flash)})`);

// 8. descent hands out NO gates: a sinking fish has no vertical control, so a
//    portal would be an unavoidable miss
await page.evaluate(() => { window.__FFM_API.debugSetSpeed(40); window.__FFM_API.setGauge(0.5); });
const descentMisses = await page.evaluate(async () => {
  const api = window.__FFM_API;
  let sawGateWhileDescending = false;
  const until = Date.now() + 120000; // decaying software-GL rig: sim runs ~0.05x real late in a page
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 25));
    const s = api.state();
    if (s.locomotion === 'descend' && api.gate()) sawGateWhileDescending = true;
    if (s.locomotion === 'swim') break;
  }
  return { sawGateWhileDescending, loco: api.state().locomotion };
});
assert(!descentMisses.sawGateWhileDescending, 'no gates spawn while descending');
assertEqual(descentMisses.loco, 'swim', 'the sinking fish reaches the swim phase');

// 9. the next gate appears after the cooldown (one at a time)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });

// 10. exactly one press grades: a second press while resolved no-ops
// (both presses deterministic in one evaluate — no frame-pacing gap)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
const double = await page.evaluate(() => {
  const api = window.__FFM_API;
  const before = api.state().counts.perfect;
  const q = api.qte();
  api.debugPressAt(q.targetAt);
  api.debugPressAt(q.startedAt + 0.5); // must no-op: window already resolved
  return { before, after: api.state().counts.perfect };
});
assertEqual(double.after, double.before + 1, 'a second press does not re-grade the QTE');

// 11. the cue shows while a window is open and hides when it resolves
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => {
  const el = document.querySelector('#ffm-qte');
  return el && !el.classList.contains('hidden');
}, null, { timeout: 60000 });
const cue = await page.evaluate(() => {
  const el = document.querySelector('#ffm-qte');
  return {
    mode: el.dataset.mode,
    beat: el.dataset.beat,
    fill: document.querySelector('.ffm-qte-key').style.getPropertyValue('--fill'),
    // a static target must be marked BEFORE the moment exists, whichever style the roster drew: the
    // closing style draws a ring, the clock style paints its windows on the dial
    targetShown: document.querySelector('#ffm-qte-target').style.display !== 'none'
      || document.querySelector('#ffm-qte-perfect').getAttribute('d') !== '',
    label: el.textContent,
  };
});
assert(['closing', 'clock'].includes(cue.mode), `the cue names a real style (${cue.mode})`);
assert(['0', '1'].includes(cue.beat), `the cue publishes its beat state (${cue.beat})`);
assert(/^[\d.]+%$/.test(cue.fill), `the key fills toward the moment (${cue.fill})`);
assertEqual(cue.targetShown, true, 'a static target is marked before anything moves — motion is not the only cue');
assert(cue.label.includes('SPACE'), `the prompt names the key (${cue.label})`);
await page.evaluate(() => window.__FFM_API.debugPress());
await page.waitForFunction(() => {
  const el = document.querySelector('#ffm-qte');
  return !el || el.classList.contains('hidden');
}, null, { timeout: 60000 });
// audio: the open blip fired through the counted synth path
const stats = await page.evaluate(() => window.__FFM_API.debugAudioStats());
assert((stats.calls.qte ?? 0) >= 1, `qte open cue counted (${stats.calls.qte})`);

// 13. a SPACE press while paused does not resolve a pending window (runs before
//     the run-ending section 12, which is terminal: no gate ever spawns after it)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
const paused = await page.evaluate(() => {
  const api = window.__FFM_API;
  api.pause();
  api.debugPress(); // frozen runTime: must not grade
  api.debugPressAt(api.qte().startedAt + 5); // explicit-time press: also must not grade
  const stillPending = api.qte() !== null;
  api.resume();
  return { stillPending };
});
assert(paused.stillPending, 'a press while paused does not grade the window');

// 12. a run ending with a QTE pending clears it (no stuck cue, no stale state)
// (decayed-rig headroom: deep in a long page the sim runs ~0.05x real)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 120000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 120000 });
await page.evaluate(() => window.__FFM_API.endRun());
const postEnd = await page.evaluate(() => ({ qte: window.__FFM_API.qte(), phase: window.__FFM_API.state().phase }));
assertEqual(postEnd.qte, null, 'ending a run clears a pending QTE');
assertEqual(postEnd.phase, 'results', 'run ended');
assertEqual(await page.evaluate(() => document.querySelector('#ffm-qte').classList.contains('hidden')), true, 'the cue hides when the run ends');

// ---- centred QTE timing, two styles (2026-10-22, user-directed) -------------------------------
// The grade vocabulary and everything downstream (applyResult, +8/+4, chain, cuts) is unchanged. What
// changed is WHEN a press counts: the window is centred on the cue's target moment, so pressing the
// instant you cross is now a Miss. Styles forced via the inert seam, not the roster's draw.

// a crossing helper: force a style, spawn, teleport onto the ring, and hand back the live QTE
async function crossWithStyle(style) {
  await page.evaluate((s) => { window.__FFM_API.debugForceStyle(s); window.__FFM_API.debugRestart(); }, style);
  await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
  await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
  await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 120000 });
  return page.evaluate(() => {
    const api = window.__FFM_API;
    const q = api.qte();
    return {
      style: q.style, mode: document.querySelector('#ffm-qte').dataset.mode,
      lead: q.targetAt - q.startedAt, perfect: q.perfectHalf, good: q.goodHalf,
      deadline: q.deadline - q.startedAt,
    };
  });
}
// press `offset` seconds from the target moment and report the grade. Returns '<no-window>' when no
// QTE is open — a stale grade read after the fact would look like a pass for the wrong reason.
async function pressAtOffset(offset) {
  return page.evaluate((off) => {
    const api = window.__FFM_API;
    const q = api.qte();
    if (!q) return '<no-window>';
    api.debugPressAt(q.targetAt + off);
    return api.state().lastResult;
  }, offset);
}

// (1) CLOSING: the plain cyan ring; the prompt says closing; the inner ring starts outside the track
//     and MEETS it at the target moment; pressing that moment is a Perfect.
const closing = await crossWithStyle('closing');
assertEqual(closing.style, 'closing', 'the forced style reaches the spawned gate');
assertEqual(await page.evaluate(() => window.__FFM_API.debugLastStyle()), 'closing', 'the no-repeat guard sees the real style');
assertEqual(closing.mode, 'closing', 'the prompt reports the closing style');
assert(closing.lead > 0.3, `there is a moment to time (lead ${closing.lead.toFixed(2)}s)`);
assert(closing.deadline > closing.lead, 'and a tail after it before the auto-miss');
const closeCue = await page.evaluate(() => ({
  r: Number(document.querySelector('#ffm-qte-close').getAttribute('r')),
  targetShown: document.querySelector('#ffm-qte-target').style.display !== 'none',
  dialHidden: document.querySelector('#ffm-qte-dial').style.display === 'none',
  dotHidden: document.querySelector('#ffm-qte-hand').style.display === 'none',
}));
assert(closeCue.r > 44, `the closing ring starts OUTSIDE the marked target and shrinks in (r=${closeCue.r})`);
assertEqual(closeCue.targetShown, true, 'the target it will land on is drawn from the first frame');
assertEqual(closeCue.dotHidden, true, 'the needle is not drawn for a closing ring');
assertEqual(closeCue.dialHidden, true, 'and the painted dial belongs to the clock style only');

// the meeting is real, AND the moment carries a second channel (2026-10-22). The report was "can't tell
// when to press", so the moment is now: the ring landing exactly on a marked target, the target lighting,
// a tick per step and one beat at the moment. The radius is taken as a MINIMUM over the live window —
// the landing is clamped, so every frame after the moment reads r=44 and a single "at the moment" sample
// can no longer miss it on a slow frame.
const meeting = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const q = api.qte();
  let minR = null, beatSeen = false, phaseSeen = [];
  const deadline = performance.now() + 30000;
  while (api.qte() === q && performance.now() < deadline) {
    const el = document.querySelector('#ffm-qte');
    if (el.dataset.beat === '1') beatSeen = true;
    if (el.dataset.phase && !phaseSeen.includes(el.dataset.phase)) phaseSeen.push(el.dataset.phase);
    const r = Number(document.querySelector('#ffm-qte-close').getAttribute('r'));
    if (minR === null || r < minR) minR = r;
    await new Promise((r2) => requestAnimationFrame(r2));
  }
  return {
    minR, beatSeen, phaseSeen, ticks: q.ticks,
    targetTick: Math.round((q.targetAt - q.startedAt) / q.tick),
    deadlineTick: Math.ceil((q.deadline - q.startedAt) / q.tick),
    audio: api.debugAudioStats().calls,
  };
});
assert(Math.abs(meeting.minR - 44) < 0.5,
  `the ring must land exactly ON the marked target (min r=${meeting.minR})`);
assert(meeting.beatSeen, 'the target must light at the moment — the visual beat, not converging motion alone');
// the cue must stop CLAIMING the moment once it has passed: a late press still scores Good for 0.38 s, and
// a cue frozen on the target would tell the player "now" while grading them late
assert(meeting.phaseSeen.includes('now'), `the cue reports the moment itself (${meeting.phaseSeen.join('/')})`);
assert(meeting.phaseSeen.includes('late'), `and reports that the moment has passed (${meeting.phaseSeen.join('/')})`);
// the counter is a CLOCK, so it runs past the target to the deadline; it must span the drawn tick count
// and never outlive the window it belongs to
assert(meeting.ticks >= meeting.targetTick,
  `the clock counts its way to the drawn tick (${meeting.ticks} >= ${meeting.targetTick})`);
assert(meeting.ticks <= meeting.deadlineTick,
  `and never past the window's deadline (${meeting.ticks} <= ${meeting.deadlineTick})`);
assert((meeting.audio.tick ?? 0) >= 1, `the tick is audible (calls.tick=${meeting.audio.tick})`);
assert((meeting.audio.beat ?? 0) >= 1, `the moment sounds (calls.beat=${meeting.audio.beat})`);

// (2) the grade follows the MOMENT, and jumping the gun is a Miss — the skill is inverted.
//     NOTE: the sampling loop above runs until the QTE resolves, so every press needs its own crossing.
await crossWithStyle('closing');
assertEqual(await pressAtOffset(0), 'perfect', 'pressing at the moment is a Perfect');
await crossWithStyle('closing');
assertEqual(await pressAtOffset(0.24), 'good', 'slightly late is a Good');
await crossWithStyle('closing');
assertEqual(await pressAtOffset(-0.24), 'good', 'slightly early is a Good');
await crossWithStyle('closing');
const jumped = await page.evaluate(() => {
  const api = window.__FFM_API;
  const q = api.qte();
  api.debugPressAt(q.startedAt + 0.001); // the OLD "press as fast as you can" input
  return api.state().lastResult;
});
assertEqual(jumped, 'miss', 'pressing the instant you cross is now a MISS');
await crossWithStyle('closing');
const late = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const deadline = api.qte().deadline;
  while (api.state().runTime <= deadline + 0.05) await new Promise((r) => requestAnimationFrame(r));
  return api.state().lastResult;
});
assertEqual(late, 'miss', 'letting the moment pass un-pressed is a Miss');

// (3) CLOCK: the dial PAINTED in window time — white Miss, yellow Good, red Perfect — with a NEEDLE that
//     steps in ticks at a constant speed, so it is the painted MOMENT that moves per trigger. This is the
//     style the user asked to REPLACE the old sweep, and the paint/zones/needle are what they then asked
//     for by name ("red area(perfect, small) yellow area(good, medium) white area(miss, large)", "a stick
//     indicator like clock needle").
const clock = await crossWithStyle('clock');
assertEqual(clock.style, 'clock', 'crossing a clock ring opens the clock cue');
assertEqual(clock.mode, 'clock', 'the prompt reports the clock style');
const clockCue = await page.evaluate(() => {
  const shown = (sel) => {
    const el = document.querySelector(sel);
    return !!el && el.style.display !== 'none';
  };
  // measure each zone's angular extent FROM ITS DRAWN PATH, so a styling-only change cannot pass this
  const arc = (sel) => {
    const d = document.querySelector(sel).getAttribute('d') || '';
    const m = /M ([\d.-]+) ([\d.-]+) A 44 44 0 ([01]) 1 ([\d.-]+) ([\d.-]+)/.exec(d);
    if (!m) return null;
    const ang = (x, y) => Math.atan2(Number(y) - 50, Number(x) - 50) * 180 / Math.PI + 90;
    const a0 = ang(Number(m[1]), Number(m[2]));
    const a1 = ang(Number(m[4]), Number(m[5]));
    return +((((a1 - a0) % 360) + 360) % 360).toFixed(2);
  };
  return {
    handShown: shown('#ffm-qte-hand'),
    dialShown: shown('#ffm-qte-dial'),
    needleShown: shown('.ffm-qte-needle'),
    closeHidden: document.querySelector('#ffm-qte-close').style.display === 'none',
    perfectDeg: arc('#ffm-qte-perfect'),
    goodDeg: arc('#ffm-qte-good'),
    perfectD: document.querySelector('#ffm-qte-perfect').getAttribute('d'),
  };
});
assertEqual(clockCue.dialShown, true, 'the dial is painted for a clock ring (the white miss field)');
assertEqual(clockCue.handShown, true, 'and so is the hand');
assertEqual(clockCue.needleShown, true, 'the hand is a NEEDLE — the player asked for a stick, not a bare dot');
assertEqual(clockCue.closeHidden, true, 'the closing ring is not drawn for a clock ring');
// the three zones as asked: red (perfect) small, yellow (good) medium, white (miss) large
assert(clockCue.perfectDeg !== null && clockCue.goodDeg !== null, `both zones drawn (${clockCue.perfectD})`);
assert(clockCue.perfectDeg > 0 && clockCue.perfectDeg < clockCue.goodDeg,
  `red (${clockCue.perfectDeg} deg) must read smaller than yellow (${clockCue.goodDeg} deg)`);
assert(clockCue.goodDeg < 360 - clockCue.goodDeg,
  `and yellow (${clockCue.goodDeg} deg) must read smaller than the miss field (${(360 - clockCue.goodDeg).toFixed(1)} deg)`);
// a needle that actually reaches the rim: a stick, not a dot parked near the middle
const needle = await page.evaluate(() => {
  const l = document.querySelector('.ffm-qte-needle');
  return { y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')), x1: Number(l.getAttribute('x1')) };
});
assertEqual(needle.x1, 50, 'the needle is drawn from the dial hub');
assert(needle.y1 - needle.y2 > 30, `and reaches out to the rim (length ${needle.y1 - needle.y2} viewBox units)`);
// THE PAINT IS WHERE THE MOMENT IS. Sampled on the first frame after the moment — when the needle has
// landed on the target tick — and compared directly against the red zone's own centre: no dial arithmetic
// in the test, so the two drawn things are being compared to each other, not to a third opinion.
const aligned = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const q = api.qte();
  const until = performance.now() + 60000;
  while (api.qte() === q && performance.now() < until) {
    if (document.querySelector('#ffm-qte').dataset.phase === 'late') break; // the needle has landed
    await new Promise((r) => requestAnimationFrame(r));
  }
  const m = /M ([\d.-]+) ([\d.-]+) A 44 44 0 [01] 1 ([\d.-]+) ([\d.-]+)/
    .exec(document.querySelector('#ffm-qte-perfect').getAttribute('d'));
  const ang = (x, y) => Math.atan2(Number(y) - 50, Number(x) - 50) * 180 / Math.PI + 90;
  const a0 = ang(Number(m[1]), Number(m[2]));
  const a1 = ang(Number(m[3]), Number(m[4]));
  const span = (((a1 - a0) % 360) + 360) % 360;
  const wrap = (v) => ((v % 360) + 360) % 360;
  const centre = wrap(a0 + span / 2);
  const hand = wrap(Number((/rotate\(([-\d.]+)/.exec(document.querySelector('#ffm-qte-hand').getAttribute('transform')) || [])[1]));
  const off = Math.min(Math.abs(centre - hand), 360 - Math.abs(centre - hand));
  return { centre, hand, off, span };
});
assert(aligned.off < 0.75,
  `the red zone must be centred where the needle lands (zone ${aligned.centre.toFixed(1)} deg, needle ${aligned.hand.toFixed(1)} deg)`);
// the hand must arrive ON the band exactly at the moment, and its steps must be DISCRETE: the angle only
// ever changes on tick boundaries, so a smooth sweep (the old cue) fails this by construction. WHERE the
// hand lands is checked in RENDERED POSITION, not angle — an angle-only assertion passed while the hand
// sat at 9 o'clock with the band at 12 (2026-10-22), because that is a convention mismatch, not a number.
const arrived = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const q = api.qte();
  let landed = null, angles = new Set();
  const wrap = (v) => ((v % 360) + 360) % 360;
  const deadline = performance.now() + 30000;
  while (api.qte() === q && performance.now() < deadline) {
    const el = document.querySelector('#ffm-qte');
    const m = /rotate\(([-\d.]+)/.exec(document.querySelector('#ffm-qte-hand').getAttribute('transform') || '');
    if (m) angles.add(Number(m[1]).toFixed(2));
    if (!landed && el.dataset.phase === 'late') {
      // WHERE the tip IS on screen, and where the red zone's centre is DRAWN — same frame, one convention.
      // The zone is no longer pinned at 12 o'clock (that was the bug the user reported), so the check is
      // "the tip is on the zone", not "the tip is at the top".
      const ring = document.querySelector('.ffm-qte-ring').getBoundingClientRect();
      const dot = document.querySelector('#ffm-qte-dot').getBoundingClientRect();
      const r = ring.width / 2;
      const cx = ring.left + r, cy = ring.top + r;
      const tx = dot.left + dot.width / 2 - cx, ty = dot.top + dot.height / 2 - cy;
      const a = /M ([\d.-]+) ([\d.-]+) A 44 44 0 [01] 1 ([\d.-]+) ([\d.-]+)/
        .exec(document.querySelector('#ffm-qte-perfect').getAttribute('d'));
      const ang = (x, y) => Math.atan2(Number(y) - 50, Number(x) - 50) * 180 / Math.PI + 90;
      const a0 = ang(Number(a[1]), Number(a[2]));
      const a1 = ang(Number(a[3]), Number(a[4]));
      const span = (((a1 - a0) % 360) + 360) % 360;
      landed = {
        tipDeg: wrap(Math.atan2(ty, tx) * 180 / Math.PI + 90),
        bandDeg: wrap(a0 + span / 2),
        radius: Math.hypot(tx, ty) / r,
      };
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { landed, distinctAngles: angles.size, ticks: q.ticks };
});
assert(arrived.landed, 'the tip must be sampled in the frame after the moment');
{
  const off = Math.min(Math.abs(arrived.landed.tipDeg - arrived.landed.bandDeg),
    360 - Math.abs(arrived.landed.tipDeg - arrived.landed.bandDeg));
  assert(off < 1.5,
    `the tip must land ON the red zone wherever it is painted (tip ${arrived.landed.tipDeg.toFixed(1)} deg, zone ${arrived.landed.bandDeg.toFixed(1)} deg)`);
  assert(Math.abs(arrived.landed.radius - 0.88) < 0.08,
    `and at the dial's own radius rather than floating off it (${arrived.landed.radius.toFixed(3)} of 0.88)`);
}
assert(arrived.distinctAngles <= arrived.ticks + 2,
  `the needle STEPS rather than sweeping: ${arrived.distinctAngles} distinct angles over ${arrived.ticks} ticks`);
await crossWithStyle('clock');
assertEqual(await pressAtOffset(0), 'perfect', 'the clock style grades identically: the moment is a Perfect');

// (4) the roster is free to pick again once the style seam is released
assertEqual(await page.evaluate(() => window.__FFM_API.debugForceStyle(null)), null, 'the force seam releases');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t08-gates');
await closePage(browser);
await stopServer(server);

