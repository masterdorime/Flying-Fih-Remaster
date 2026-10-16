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
await page.waitForFunction(() => window.__FFM_API.state().distance > 30, { timeout: 30000 });
const s1 = await page.evaluate(() => window.__FFM_API.state());
assert(s1.difficulty > 0, `difficulty ramps (${s1.difficulty.toFixed(3)})`);

// 3. minor collision: teleport fish into an obstacle's lane and check speed loss
const before = await page.evaluate(() => {
  window.__FFM_API.debugTeleportToObstacle();
  return window.__FFM_API.state();
});
await page.waitForFunction((s) => window.__FFM_API.state().speed < s - 3, before.speed, { timeout: 20000 });
const after = await page.evaluate(() => window.__FFM_API.state());
assert(after.speed < before.speed - 3, `collision cuts speed (${before.speed.toFixed(1)} -> ${after.speed.toFixed(1)})`);

// 4. every live chunk validates: each obstacle row keeps a swimmable gap
// (patterns replaced the always-clear corridor — validity is per-row now;
// center-occupation is proven deterministically in unit tests, since an
// unsteered fish is SUPPOSED to wreck itself on the new hazards now)
let chunksValid = await page.evaluate(() => window.__FFM_API.debugChunksValid());
assert(chunksValid, 'spawn chunks keep a >= 3 m gap per row');
// run a while — or until the unsteered fish wrecks itself, which proves the
// hazards bite — then re-validate the fresh chunks either way
await page.waitForFunction(() => {
  const s = window.__FFM_API.state();
  return s.distance > 150 || (s.phase !== 'run' && s.phase !== 'tutorial');
}, null, { timeout: 90000 });
chunksValid = await page.evaluate(() => window.__FFM_API.debugChunksValid());
assert(chunksValid, 'fresh chunks keep a >= 3 m gap per row');

// 5. render loop keeps advancing with the loaded models
const framesA = await page.evaluate(() => window.__FFM.frames);
await page.waitForTimeout(600);
const framesB = await page.evaluate(() => window.__FFM.frames);
assert(framesB > framesA, `render loop alive with world props (${framesA} -> ${framesB})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t10-world');
await closePage(browser);
await stopServer(server);
