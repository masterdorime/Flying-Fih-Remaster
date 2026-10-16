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
  // patterned water bites the unsteered: between gates, hold a clear lateral
  // line (x-only nudges, like the teleports — gauge economy untouched).
  // The landing x must clear ABEAM hazards too (|dz| <= 6): jumping blind
  // sideways is how you teleport into a neighbor rock.
  const dodge = () => {
    const s = api.state();
    if (s.phase !== 'run' || s.locomotion !== 'swim') return;
    const z0 = s.position[2], x = s.position[0], MARGIN = 2.5, AHEAD = 45;
    const discs = api.debugObstaclesNear(z0 + AHEAD, AHEAD + 6);
    for (const d of discs) {
      if (d.z < z0 + 4 || Math.abs(d.x - x) >= d.radius + MARGIN) continue;
      let best = x, bd = 1e9;
      for (let cx = -13; cx <= 13; cx += 1) {
        let ok = true;
        for (const e of discs) {
          if (e.z < z0 - 6) continue;
          if (Math.abs(e.x - cx) < e.radius + MARGIN) { ok = false; break; }
        }
        if (ok && Math.abs(cx - x) < bd) { bd = Math.abs(cx - x); best = cx; }
      }
      api.debugSetLateral(best);
      break;
    }
  };
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
      const q = api.qte();
      // deterministic grade: press inside the perfect window no matter how slow
      // the frames are (CDP latency at 4x sim would otherwise eat perfects)
      if (q) api.debugPressAt(q.startedAt + 0.05);
    } else {
      dodge(); // cooldown gaps: stay in clear water so chains survive to MAX
    }
    // hold a moderate speed: at 100+ u/s, software-GL frames advance tens of
    // meters per tick and the fish tunnels through rows between decisions.
    // Speed is not measured here (gauge chains are) — this isolates the economy.
    api.debugSetSpeed(20);
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
