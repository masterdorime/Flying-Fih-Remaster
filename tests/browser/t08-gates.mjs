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
assert(Math.abs(g0.x) <= 4, `gate placed inside the corridor (x=${g0.x.toFixed(2)})`);

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
    // closing style draws a ring, the clock style's gold band IS its target
    targetShown: document.querySelector('#ffm-qte-target').style.display !== 'none'
      || document.querySelector('#ffm-qte-zone').style.display !== 'none',
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
  dotHidden: document.querySelector('#ffm-qte-dot').style.display === 'none',
}));
assert(closeCue.r > 44, `the closing ring starts OUTSIDE the marked target and shrinks in (r=${closeCue.r})`);
assertEqual(closeCue.targetShown, true, 'the target it will land on is drawn from the first frame');
assertEqual(closeCue.dotHidden, true, 'the clock hand is not drawn for a closing ring');

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

// (3) CLOCK: a hand that TICKS (discrete steps, not a smooth sweep — a countable beat is readable where
//     smooth motion is only feelable), a gold band one tick wide whose width IS the Perfect window, and
//     a static target mark. This is the style the user asked to have REPLACE the old sweep.
const clock = await crossWithStyle('clock');
assertEqual(clock.style, 'clock', 'crossing a clock ring opens the clock cue');
assertEqual(clock.mode, 'clock', 'the prompt reports the clock style');
const clockCue = await page.evaluate(() => ({
  dotShown: document.querySelector('#ffm-qte-dot').style.display !== 'none',
  zoneShown: document.querySelector('#ffm-qte-zone').style.display !== 'none',
  closeHidden: document.querySelector('#ffm-qte-close').style.display === 'none',
  dash: document.querySelector('#ffm-qte-zone').getAttribute('stroke-dasharray'),
  zoneTransform: document.querySelector('#ffm-qte-zone').getAttribute('transform'),
}));
assertEqual(clockCue.dotShown, true, 'the hand is drawn for a clock ring');
assertEqual(clockCue.zoneShown, true, 'and so is the gold band — the static target');
assertEqual(clockCue.closeHidden, true, 'the closing ring is not drawn for a clock ring');
assert(/^[\d.]+ 276\.5$/.test(clockCue.dash), `the band is an arc on the dial, not a full circle (dash ${clockCue.dash})`);
// the band must be CENTRED on the top, in the same convention as the hand. Checked against the band's own
// width, so an edit that moves one and not the other fails: the dash is the Perfect window (2 ticks), so
// its centre sits half its width counter-clockwise of the path start (3 o'clock) brought to 12.
{
  const dashDeg = Number(clockCue.dash.split(' ')[0]) / 276.5 * 360;
  const zoneDeg = Number((/rotate\(([-\d.]+)/.exec(clockCue.zoneTransform) || [])[1]);
  const centred = ((-90 - dashDeg / 2 - zoneDeg) % 360 + 360) % 360;
  assert(centred < 0.2 || centred > 359.8,
    `the band must be centred at 12 o'clock, where the hand's origin is (off by ${centred.toFixed(2)} deg)`);
}
// the hand must arrive ON the band exactly at the moment, and its steps must be DISCRETE: the angle only
// ever changes on tick boundaries, so a smooth sweep (the old cue) fails this by construction. WHERE the
// hand lands is checked in RENDERED POSITION, not angle — an angle-only assertion passed while the hand
// sat at 9 o'clock with the band at 12 (2026-10-22), because that is a convention mismatch, not a number.
const arrived = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const q = api.qte();
  let landed = null, angles = new Set(), bestAngle = null;
  const deadline = performance.now() + 30000;
  while (api.qte() === q && performance.now() < deadline) {
    const el = document.querySelector('#ffm-qte');
    const m = /rotate\(([-\d.]+)/.exec(document.querySelector('#ffm-qte-dot').getAttribute('transform') || '');
    if (m) {
      const a = Number(m[1]);
      angles.add(a.toFixed(2));
      if (bestAngle === null || Math.abs(a) < Math.abs(bestAngle)) bestAngle = a;
    }
    if (!landed && el.dataset.phase === 'late') {
      const ring = document.querySelector('.ffm-qte-ring').getBoundingClientRect();
      const dot = document.querySelector('#ffm-qte-dot').getBoundingClientRect();
      const r = ring.width / 2; // the cue box is square, so this is the dial's radius on screen
      landed = {
        dx: +((dot.left + dot.width / 2 - (ring.left + r)) / r).toFixed(3),
        dy: +((dot.top + dot.height / 2 - (ring.top + r)) / r).toFixed(3),
      };
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { landed, bestAngle, distinctAngles: angles.size, ticks: q.ticks };
});
assert(arrived.landed, 'the hand must be sampled in the frame after the moment');
assert(Math.abs(arrived.landed.dx) < 0.1,
  `the hand must sit horizontally centred ON the gold band at the moment (dx ${arrived.landed.dx})`);
assert(arrived.landed.dy < -0.75,
  `and ABOVE the dial's centre — the top, where the band is drawn (dy ${arrived.landed.dy})`);
assert(arrived.distinctAngles <= arrived.ticks + 2,
  `the hand STEPS rather than sweeping: ${arrived.distinctAngles} distinct angles over ${arrived.ticks} ticks`);
await crossWithStyle('clock');
assertEqual(await pressAtOffset(0), 'perfect', 'the clock style grades identically: the moment is a Perfect');

// (4) the roster is free to pick again once the style seam is released
assertEqual(await page.evaluate(() => window.__FFM_API.debugForceStyle(null)), null, 'the force seam releases');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t08-gates');
await closePage(browser);
await stopServer(server);

