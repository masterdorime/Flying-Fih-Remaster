// t08-gates — momentum gates replace the press-timing QTE (2026-10-14):
// one gate spawns ahead; passing its center scores Perfect, the band scores
// Good, going around scores Miss and resets the chain; a cooldown gates the
// next spawn. Popups use the observer-recorder pattern (~850ms lifetime).
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

// 2. dead center -> PERFECT: gauge fills, chain starts, popup recorded
await page.evaluate(() => window.__FFM_API.debugTeleportToRing());
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'perfect', null, { timeout: 60000 });
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.perfect, 1, 'perfect counted');
assert(s.gauge > 0, `perfect fills the gauge (${s.gauge})`);
assertEqual(s.chain, 1, 'chain starts');
const popups = await page.evaluate(() => (window.__POPUPS ?? []).join(','));
assert(popups.includes('PERFECT'), `PERFECT popup recorded (${popups})`);

// 3. through the band -> GOOD
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
await page.evaluate(() => window.__FFM_API.debugTeleportToRing(2, 0));
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'good', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.counts.good, 1, 'good counted');
assertEqual(s.chain, 2, 'good extends the chain');

// 4. sailing around it -> MISS: chain resets, speed cut
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });
const preMiss = await page.evaluate(() => window.__FFM_API.state().speed);
await page.evaluate(() => window.__FFM_API.debugTeleportToRing(9, 0));
await page.waitForFunction(() => window.__FFM_API.state().lastResult === 'miss', null, { timeout: 60000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.chain, 0, 'miss resets the chain');
assert(s.speed < preMiss, `miss cuts speed (${preMiss.toFixed(1)} -> ${s.speed.toFixed(1)})`);
assertEqual(s.counts.miss, 1, 'miss counted');

// 5. the next gate appears after the cooldown (one at a time)
await page.waitForFunction(() => window.__FFM_API.gate() !== null, null, { timeout: 60000 });

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
await page.evaluate(() => window.__FFM_API.debugSetSpeed(40));
await page.evaluate(() => window.__FFM_API.setGauge(0.5));
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

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t08-gates');
await closePage(browser);
await stopServer(server);
