import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => window.__FFM_API.start());

// 1. coin trails spawn ahead (shrimp model instances, continuous)
await page.waitForFunction(() => (window.__FFM_API.debugCoins()?.active ?? 0) > 10, { timeout: 10000 });
const coins0 = await page.evaluate(() => window.__FFM_API.debugCoins());
assert(coins0.active >= 10, `shrimp coins spawned ahead (${coins0.active} coins)`);

// 2. collecting increments coins + score but does NOT touch the gauge (PRD §8.2)
await page.evaluate(() => window.__FFM_API.setGauge(50));
const before = await page.evaluate(() => window.__FFM_API.state());
await page.evaluate(() => window.__FFM_API.debugTeleportToCoin());
// poll, never a fixed timeout: sim time runs slow under software GL (HANDOFF key facts)
await page.waitForFunction((c) => window.__FFM_API.state().coins > c, before.coins, { timeout: 20000 });
const after = await page.evaluate(() => window.__FFM_API.state());
assert(after.coins >= before.coins + 1, 'coin collected');
assert(after.score > before.score, `coin adds score (${before.score.toFixed(0)} -> ${after.score.toFixed(0)})`);
assert(after.gauge <= before.gauge + 0.001, `gauge never filled by coin (${before.gauge.toFixed(2)} -> ${after.gauge.toFixed(2)})`);

// 3. coin popup feedback exists
const mid = await page.evaluate(() => window.__FFM_API.state());
await page.evaluate(() => window.__FFM_API.debugTeleportToCoin());
await page.waitForFunction((c) => window.__FFM_API.state().coins > c, mid.coins, { timeout: 20000 });
const popups = await page.evaluate(() => [...document.querySelectorAll('.ffm-popup')].map(e => e.textContent).join(','));
const s2 = await page.evaluate(() => window.__FFM_API.state());
assert(s2.coins >= mid.coins, 'continued collection works');
assert(popups.includes('COIN'), `COIN popup shown (${popups})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t11-coins');
await closePage(browser);
await stopServer(server);
