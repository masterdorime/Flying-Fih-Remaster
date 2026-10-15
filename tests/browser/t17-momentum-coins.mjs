import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. Skyfin model is the player (not the procedural fallback)
const fish = await page.evaluate(() => window.__FFM_API.debugFish());
assert(fish.skyfin === true, 'Skyfin FBX loaded as the player fish');

// 2. momentum preserved: a chained-perfect run fills the gauge past 100 and reaches max tier
const result = await page.evaluate(async () => {
  const api = window.__FFM_API;
  api.start();
  api.setTimeScale(4);
  let maxTier = 'none';
  let filledAt = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
    const s = api.state();
    if (s.phase !== 'run') break;
    maxTier = ['none', 'low', 'medium', 'high', 'max'].indexOf(s.tier) > ['none', 'low', 'medium', 'high', 'max'].indexOf(maxTier) ? s.tier : maxTier;
    if (filledAt === null && s.gauge >= 100) filledAt = s.runTime;
    if (s.gauge >= 100 && s.runTime >= 60) break;
    if (api.gate()) {
      api.debugTeleportToRing(); // chain perfects: cross the mouth, press in the window
      api.debugPress();
    }
  }
  const final = api.state();
  api.setTimeScale(1);
  return { maxTier, gauge: final.gauge, filledAt, runTime: final.runTime, phase: final.phase, perfects: final.counts.perfect };
});
assert(result.perfects > 10, `chained perfects landed (${result.perfects})`);
assert(result.maxTier === 'max', `gauge reaches MAX tier via perfect chains (peak: ${result.maxTier})`);
assert(result.filledAt !== null && result.filledAt < 60, `gauge fills within a minute of play (${result.filledAt?.toFixed(1)}s)`);
assert(result.phase === 'run', 'run alive while chaining');

// 3. coins are a continuous river: small gaps, coverage far ahead
await page.evaluate(() => window.__FFM_API.start());
await page.waitForTimeout(800);
const coins = await page.evaluate(() => window.__FFM_API.debugCoins());
assert(coins.active >= 30, `many shrimp active ahead (${coins.active})`);
assert(coins.maxGapAhead <= 6, `coin trail continuous (max gap ${coins.maxGapAhead}m)`);
assert(coins.coverageAhead >= 100, `coins reach far ahead (${coins.coverageAhead}m)`);
// ...and still continuous after traveling a while
await page.waitForTimeout(1500);
const coins2 = await page.evaluate(() => window.__FFM_API.debugCoins());
assert(coins2.maxGapAhead <= 6, `trail stays continuous on the move (gap ${coins2.maxGapAhead}m)`);
assert(coins2.coverageAhead >= 80, `coverage maintained (${coins2.coverageAhead}m)`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t17-momentum-coins');
await closePage(browser);
await stopServer(server);
