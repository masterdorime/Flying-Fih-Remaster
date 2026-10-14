import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// PRD §28.1 acceptance 10: continuous 60-90s run while chaining momentum.
// Scripted by parking the fish on each gate's center the moment it appears,
// sim time at 4x (gate-driven successor of the old pressAt() loop).
const summary = await page.evaluate(async () => {
  const api = window.__FFM_API;
  api.start();
  api.setTimeScale(4);
  const TARGET_SIM_SECONDS = 90;
  let maxTier = 'none';
  let coins = 0;
  let perfects = 0;
  const deadline = Date.now() + 260000; // 4x sim: generous wall budget
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
    const s = api.state();
    if (s.phase !== 'run' && s.phase !== 'tutorial') break;
    if (['low', 'medium', 'high', 'max'].indexOf(s.tier) > ['low', 'medium', 'high', 'max'].indexOf(maxTier)) maxTier = s.tier;
    coins = s.coins; perfects = s.counts.perfect;
    if (api.gate()) api.debugTeleportToRing(); // park on the portal's center axis
    if (s.runTime >= TARGET_SIM_SECONDS) break;
  }
  const final = api.state();
  api.setTimeScale(1);
  return {
    runTime: final.runTime, distance: final.distance, maxTier, coins, perfects,
    misses: final.counts.miss, phase: final.phase, speed: final.speed, score: final.score,
  };
});

console.log('  summary:', JSON.stringify(summary));
assert(summary.runTime >= 60, `run lasted 60+ sim seconds (${summary.runTime.toFixed(1)}s)`);
assert(summary.distance > 800, `covered real distance (${summary.distance.toFixed(0)}m)`);
assert(summary.maxTier === 'medium' || summary.maxTier === 'high' || summary.maxTier === 'max',
  `reached Medium+ tier via chained perfects (peak: ${summary.maxTier})`);
assert(summary.perfects > 15, `chained many perfects (${summary.perfects})`);
// the scripted loop parks on the gate axis every tick; buoyancy drift at 4x
// sim speed can clip a crossing, so a couple of strays are real gameplay now
assert(summary.misses <= 2, `scripted run stayed on the rails (misses: ${summary.misses})`);
assert(summary.phase === 'run' || summary.phase === 'tutorial', 'run never failed during the scripted sequence');
assert(summary.score > 1000, `score accumulates (${summary.score.toFixed(0)})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t15-acceptance');
await closePage(browser);
await stopServer(server);
