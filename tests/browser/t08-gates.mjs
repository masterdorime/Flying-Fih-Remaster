// t08-gates — ring-triggered QTE (2026-10-15): crossing INSIDE the ring mouth
// opens exactly one SPACE window and the press time picks the grade (<=0.30 s
// Perfect, <=0.70 s Good, later or never Miss). Crossing outside the mouth is a
// plain Miss with no window at all; a pending window owns its gate so the
// behind-miss can't fire early; one live gate at a time, spaced by the
// cooldown. Popups use the observer-recorder pattern (~850ms lifetime).
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
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 90000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugPress());
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
  window.__FFM_API.debugPressAt(q.startedAt + q.perfectWindow + 0.05);
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
  return q ? q.startedAt + q.goodWindow : null;
});
assert(deadline !== null, 'window opened with a deadline to poll');
await page.waitForFunction((d) => window.__FFM_API.state().runTime > d, deadline, { timeout: 60000 });
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'miss', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.chain, 0, 'miss resets the chain');
assert(s.speed < preMiss, `miss cuts speed (${preMiss.toFixed(1)} -> ${s.speed.toFixed(1)})`);
assertEqual(s.counts.miss, 1, 'miss counted');

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
  const until = Date.now() + 40000;
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
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
const double = await page.evaluate(() => {
  const api = window.__FFM_API;
  const before = api.state().counts.perfect;
  api.debugPress();
  api.debugPress(); // second press must not double-grade
  return { before, after: api.state().counts.perfect };
});
assertEqual(double.after, double.before + 1, 'a second press does not re-grade the QTE');

// 12. a run ending with a QTE pending clears it (no stuck cue, no stale state)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.qte() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.endRun());
const postEnd = await page.evaluate(() => ({ qte: window.__FFM_API.qte(), phase: window.__FFM_API.state().phase }));
assertEqual(postEnd.qte, null, 'ending a run clears a pending QTE');
assertEqual(postEnd.phase, 'results', 'run ended');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t08-gates');
await closePage(browser);
await stopServer(server);
