import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => window.__FFM_API.start());

// 1. the world populates with Kenney props + rock clusters ahead of the fish
const propCount = await page.evaluate(() => window.__FFM_API.debugObstacleCount());
assert(propCount >= 4, `chunks spawn obstacles ahead (${propCount} props)`);
const modelFailures = await page.evaluate(() => window.__FFM_API.debugModelFailures());
assert(modelFailures.length === 0, `all models load (failures: ${modelFailures.join(', ') || 'none'})`);

// 2. run a while at speed through the world
await page.waitForTimeout(1500);
const s1 = await page.evaluate(() => window.__FFM_API.state());
assert(s1.distance > 30, `distance accumulates (${s1.distance.toFixed(1)}m)`);
assert(s1.difficulty > 0, `difficulty ramps (${s1.difficulty.toFixed(3)})`);

// 3. minor collision: teleport fish into an obstacle's lane and check speed loss
const before = await page.evaluate(() => {
  window.__FFM_API.debugTeleportToObstacle();
  return window.__FFM_API.state();
});
await page.waitForTimeout(200);
const after = await page.evaluate(() => window.__FFM_API.state());
assert(after.speed < before.speed - 3, `collision cuts speed (${before.speed.toFixed(1)} -> ${after.speed.toFixed(1)})`);

// 4. obstacles never block the central corridor (safety by construction, worldgen-tested)
const corridorClear = await page.evaluate(() => window.__FFM_API.debugCorridorClear());
assert(corridorClear, 'central corridor stays passable');

// 5. frames healthy with the loaded models
const fps = await page.evaluate(() => window.__FFM.fps);
assert(fps > 10, `fps healthy with world props (${fps})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t10-world');
await closePage(browser);
await stopServer(server);
