// t12 — the sky flight phase (replaces the retired tier-based plane mode):
// debugForceFlight launches the fish, it holds the fixed flight altitude above
// the clouds, banking still steers, and an empty gauge ends with a descent.
import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. debugForceFlight enters the fly phase at full gauge
await page.evaluate(() => {
  // record every juice popup (they live ~850ms wall-clock — too short to poll
  // for reliably under software GL, so observe-then-assert instead)
  window.__POPUPS = [];
  new MutationObserver(() => {
    for (const e of document.querySelectorAll('.ffm-popup')) {
      const t = e.textContent.trim();
      if (t && !window.__POPUPS.includes(t)) window.__POPUPS.push(t);
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.__FFM_API.start();
  window.__FFM_API.setGauge(115);
  window.__FFM_API.debugForceFlight();
});
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', { timeout: 20000 });
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'fly', 'debugForceFlight enters the fly phase');
assertEqual(s.tier, 'max', 'full gauge is max tier in flight');

// 2. flight holds a fixed altitude above the cloud curtain
await page.waitForFunction(() => window.__FFM_API.state().position[1] > 70, null, { timeout: 40000 });
// settle: condition-wait, not a fixed nap — the decaying software-GL rig can
// take tens of wall-seconds to climb the last 15 m
await page.waitForFunction(() => Math.abs(window.__FFM_API.state().position[1] - 85) < 8, null, { timeout: 120000 });
s = await page.evaluate(() => window.__FFM_API.state());
assert(Math.abs(s.position[1] - 85) < 8, `flight altitude settles near 85, above the clouds (y=${s.position[1].toFixed(1)})`);
assert(s.speed > 8, `fish keeps flying forward (speed=${s.speed.toFixed(1)})`);

// 3. W/S controls altitude in flight: climb and dive within the sky band
const cruiseY = await page.evaluate(() => window.__FFM_API.state().position[1]);
await page.keyboard.down('KeyW');
await page.waitForFunction((y) => window.__FFM_API.state().position[1] > y + 5, cruiseY, { timeout: 20000 });
const climbed = await page.evaluate(() => window.__FFM_API.state());
await page.keyboard.up('KeyW');
assert(climbed.position[1] > cruiseY + 5, `W climbs in flight (y ${cruiseY.toFixed(1)} -> ${climbed.position[1].toFixed(1)})`);
await page.keyboard.down('KeyS');
await page.waitForFunction((y) => window.__FFM_API.state().position[1] < y - 5, climbed.position[1], { timeout: 20000 });
const dived = await page.evaluate(() => window.__FFM_API.state());
await page.keyboard.up('KeyS');
assert(dived.position[1] < climbed.position[1] - 5, `S dives in flight (${climbed.position[1].toFixed(1)} -> ${dived.position[1].toFixed(1)})`);
assert(dived.position[1] > 45, `flight stays above the cloud curtain (y=${dived.position[1].toFixed(1)})`);

// 4. banking in flight: hold D until the fish drifts screen-right and rolls
const roll0 = await page.evaluate(() => window.__FFM_API.debugBanking());
const x0 = await page.evaluate(() => window.__FFM_API.state().position[0]);
await page.keyboard.down('KeyD');
await page.waitForFunction((x) => window.__FFM_API.state().position[0] < x - 2, x0, { timeout: 20000 });
const bankSample = await page.evaluate(() => ({ roll: window.__FFM_API.debugBanking(), x: window.__FFM_API.state().position[0] }));
await page.keyboard.up('KeyD');
assert(bankSample.x < x0 - 2, `bank-turn moves the fish screen-right (x ${x0.toFixed(1)} -> ${bankSample.x.toFixed(1)})`);
assert(Math.abs(bankSample.roll) > 0.3, `banking rolls the fish (${roll0.toFixed(2)} -> ${bankSample.roll.toFixed(2)})`);

// 5. the gauge drains while flying; empty -> descent out of the sky
const gaugeBefore = await page.evaluate(() => window.__FFM_API.state().gauge);
await page.evaluate(() => window.__FFM_API.setTimeScale(4));
await page.waitForFunction((g) => window.__FFM_API.state().gauge < g - 5, gaugeBefore, { timeout: 20000 });
await page.evaluate(() => window.__FFM_API.setGauge(0.5));
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'descend', { timeout: 30000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'descend', 'empty gauge starts the descent');
const popups = await page.evaluate(() => window.__POPUPS);
assert(popups.some(t => t.includes('MAX FLIGHT')), `MAX FLIGHT popup fired on entering flight (saw: ${popups.join(', ')})`);
assert(popups.some(t => t.includes('POWER DOWN')), `POWER DOWN popup fired on descent (saw: ${popups.join(', ')})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t12-flight');
await closePage(browser);
await stopServer(server);
