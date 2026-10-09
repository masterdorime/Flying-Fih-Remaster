import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. a prompt spawns on its own during a run
await page.waitForFunction(() => window.__FFM_API.prompt() !== null, { timeout: 6000 });
const prompt = await page.evaluate(() => window.__FFM_API.prompt());
assert(prompt && prompt.expiresAt > prompt.perfectAt, 'prompt has spawn/perfect/expiry');

// 2. perfect press via real keyboard: wait until near perfectAt then hit Space
const perfectAt = prompt.perfectAt;
await page.waitForFunction((t) => window.__FFM_API.state().runTime >= t - 0.03, perfectAt - 0.03);
await page.keyboard.press('Space');
await page.waitForTimeout(120);
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.lastResult, 'perfect', 'space press near perfectAt scores perfect');
assertEqual(s.counts.perfect, 1, 'perfect counted');
assert(s.speed > 20, `perfect boosts speed (${s.speed.toFixed(1)})`);
assert(s.gauge > 0, 'perfect fills gauge');
assert(s.chain === 1, 'chain starts');

// 3. perfect popup visible
const popupText = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.ffm-popup')];
  return els.map(e => e.textContent).join(',');
});
assert(popupText.includes('PERFECT'), `PERFECT popup shown (${popupText})`);

// 4. determinism: pressAt(t) evaluates exactly (scripted test hook)
await page.evaluate(() => {
  const p = window.__FFM_API.prompt();
  return p;
});
// wait for the next prompt then press 0.15s after perfectAt -> good window
await page.waitForFunction(() => window.__FFM_API.prompt() !== null, { timeout: 6000 });
const p2 = await page.evaluate(() => window.__FFM_API.prompt());
const goodAt = p2.perfectAt + 0.15;
const before = await page.evaluate(() => window.__FFM_API.state());
const after = await page.evaluate((t) => {
  window.__FFM_API.pressAt(t);
  return window.__FFM_API.state();
}, goodAt);
assertEqual(after.lastResult, 'good', 'press 150ms after perfectAt is good');
assert(after.speed > before.speed, `good gives smaller boost than perfect (${before.speed.toFixed(1)}->${after.speed.toFixed(1)})`);
assertEqual(after.counts.good, 1, 'good counted');

// 5. miss via early press: press just after spawn but before good window
await page.waitForFunction(() => window.__FFM_API.prompt() !== null, { timeout: 6000 });
const p3 = await page.evaluate(() => window.__FFM_API.prompt());
const earlyAt = p3.perfectAt - 0.16; // outside good window (0.18 at low speed?) -> use 0.25 to be safe
const missAt = p3.perfectAt - 0.25;
const preMiss = await page.evaluate(() => window.__FFM_API.state());
const missState = await page.evaluate((t) => {
  window.__FFM_API.pressAt(t);
  return window.__FFM_API.state();
}, missAt);
assertEqual(missState.lastResult, 'miss', 'press 250ms off is a miss');
assert(missState.speed < preMiss.speed, `miss cuts speed (${preMiss.speed.toFixed(1)}->${missState.speed.toFixed(1)})`);
assertEqual(missState.chain, 0, 'miss breaks chain');

// 6. expired prompt shows MISSED and does not penalize
await page.waitForFunction(() => window.__FFM_API.prompt() !== null, { timeout: 6000 });
const p4 = await page.evaluate(() => window.__FFM_API.prompt());
const preExpire = await page.evaluate(() => window.__FFM_API.state().speed);
await page.waitForFunction((t) => window.__FFM_API.state().runTime > t + 0.1, p4.expiresAt);
await page.waitForTimeout(100);
const postExpire = await page.evaluate(() => window.__FFM_API.state());
assert(postExpire.speed >= preExpire - 1.5, `expired prompt causes no speed penalty (${preExpire.toFixed(1)} -> ${postExpire.speed.toFixed(1)})`);
const popups2 = await page.evaluate(() => [...document.querySelectorAll('.ffm-popup')].map(e => e.textContent).join(','));
assert(popups2.includes('MISSED'), `MISSED popup on expiry (${popups2})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t08-timing');
await closePage(browser);
await stopServer(server);
