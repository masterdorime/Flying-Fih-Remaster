import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

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

// 3b. crash grace (2026-10-17): a crash hides the fish for 0.5 s and starts
// global i-frames — a second hull touched inside the window cannot land a hit.
// Rides §3's crash (no settle): the crash just landed, its window is open NOW.
const pre = await page.evaluate(() => {
  const api = window.__FFM_API;
  const c = api.debugAudioStats().calls;
  return { wings: api.state().wings, crashes: (c.collision ?? 0) + (c.collisionMajor ?? 0) };
});
const hit1 = await page.evaluate(() => ({
  visible: window.__FFM_API.debugFish().visible,
}));
assertEqual(hit1.visible, false, 'the fish is invisible right after the §3 crash');
// touch the next hull inside the grace window at low speed (stays overlapping):
// with i-frames no second crash may land during the window
await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(8);
  api.debugTeleportToObstacle(1);
});
await page.waitForTimeout(250); // read ~0.4 s into the 0.5 s grace
const inside = await page.evaluate(() => {
  const c = window.__FFM_API.debugAudioStats().calls;
  return { crashes: (c.collision ?? 0) + (c.collisionMajor ?? 0), wings: window.__FFM_API.state().wings };
});
assertEqual(inside.crashes, pre.crashes, `no second crash inside the grace window (${inside.crashes})`);
assertEqual(inside.wings, pre.wings, 'no wing stacking inside the grace window');
// the fish reappears when the window ends — hop clear of all hulls first so
// the restore isn't raced by a re-hide on the hull we are still inside of
await page.evaluate(() => window.__FFM_API.debugTeleportFar(window.__FFM_API.debugFish().z + 14));
await page.waitForFunction(() => window.__FFM_API.debugFish().visible === true, null, { timeout: 20000 });

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
