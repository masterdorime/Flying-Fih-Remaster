// t12 — the sky flight phase (replaces the retired tier-based plane mode):
// debugForceFlight launches the fish, it holds the fixed flight altitude above
// the clouds, banking still steers, and an empty gauge ends with a descent.
import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. debugForceFlight enters the fly phase at full gauge
await page.evaluate(() => {
  window.__FFM_API.start();
  window.__FFM_API.setGauge(115);
  window.__FFM_API.debugForceFlight();
});
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', { timeout: 20000 });
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'fly', 'debugForceFlight enters the fly phase');
assertEqual(s.tier, 'max', 'full gauge is max tier in flight');
await page.waitForFunction(() => [...document.querySelectorAll('.ffm-popup')].some(e => e.textContent.includes('MAX FLIGHT')), { timeout: 5000 });

// 2. flight holds a fixed altitude above the cloud curtain
await page.waitForFunction(() => window.__FFM_API.state().position[1] > 70, { timeout: 40000 });
await page.waitForTimeout(1500); // let it settle
s = await page.evaluate(() => window.__FFM_API.state());
assert(Math.abs(s.position[1] - 85) < 8, `flight altitude settles near 85, above the clouds (y=${s.position[1].toFixed(1)})`);
assert(s.speed > 8, `fish keeps flying forward (speed=${s.speed.toFixed(1)})`);

// 3. banking in flight: hold D until the fish drifts screen-right and rolls
const roll0 = await page.evaluate(() => window.__FFM_API.debugBanking());
const x0 = await page.evaluate(() => window.__FFM_API.state().position[0]);
await page.keyboard.down('KeyD');
await page.waitForFunction((x) => window.__FFM_API.state().position[0] < x - 2, x0, { timeout: 20000 });
const bankSample = await page.evaluate(() => ({ roll: window.__FFM_API.debugBanking(), x: window.__FFM_API.state().position[0] }));
await page.keyboard.up('KeyD');
assert(bankSample.x < x0 - 2, `bank-turn moves the fish screen-right (x ${x0.toFixed(1)} -> ${bankSample.x.toFixed(1)})`);
assert(Math.abs(bankSample.roll) > 0.3, `banking rolls the fish (${roll0.toFixed(2)} -> ${bankSample.roll.toFixed(2)})`);

// 4. the gauge drains while flying; empty -> descent out of the sky
const gaugeBefore = await page.evaluate(() => window.__FFM_API.state().gauge);
await page.evaluate(() => window.__FFM_API.setTimeScale(4));
await page.waitForFunction((g) => window.__FFM_API.state().gauge < g - 5, gaugeBefore, { timeout: 20000 });
await page.evaluate(() => window.__FFM_API.setGauge(0.5));
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'descend', { timeout: 30000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'descend', 'empty gauge starts the descent');
await page.waitForFunction(() => [...document.querySelectorAll('.ffm-popup')].some(e => e.textContent.includes('POWER DOWN')), { timeout: 5000 });

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t12-flight');
await closePage(browser);
await stopServer(server);
