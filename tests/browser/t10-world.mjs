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

// 3b. crash grace (2026-10-17): a crash starts 0.5 s of global i-frames and
// recovery-flashes the model — a fast on/off blink, not a blackout. Rides §3's
// crash for the flash, then a fresh crash for i-frames: each measurement gets
// its own full window.
// the model recovery-flashes: samples ride SIM time (crashHide) — the
// software-GL rig slows the sim down, so a fixed real-time window can miss the
// blink entirely. Runs until ~0.35 sim-s of the window has elapsed.
const flicker = await page.evaluate(() => new Promise(resolve => {
  const api = window.__FFM_API;
  const samples = [];
  const iv = setInterval(() => {
    const d = api.debugFish();
    samples.push(d.visible);
    if (d.crashHide <= 0.15) { clearInterval(iv); resolve(samples); } // both blink parities covered
  }, 10);
  setTimeout(() => { clearInterval(iv); resolve(samples); }, 10000); // real-time cap for the decayed rig
}));
assert(flicker.includes(true) && flicker.includes(false), `the fish recovery-flashes during the grace (${flicker.join(',')})`);
// hop clear of the hull, let the window close: the fish reappears and stays so
await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(8);
  api.debugTeleportFar(api.debugFish().z + 14);
});
await page.waitForFunction(() => {
  const f = window.__FFM_API.debugFish();
  return f.crashHide === 0 && f.visible === true;
}, null, { timeout: 25000 });
// fresh crash: a second hull touched inside the window cannot land a hit
const pre = await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(25);
  api.debugTeleportToObstacle(0);
  const c = api.debugAudioStats().calls;
  return { wings: api.state().wings, crashes: (c.collision ?? 0) + (c.collisionMajor ?? 0) };
});
let crashBDump = null;
try {
  await page.waitForFunction((n) => {
    const c = window.__FFM_API.debugAudioStats().calls;
    return ((c.collision ?? 0) + (c.collisionMajor ?? 0)) > n;
  }, pre.crashes, { timeout: 25000 });
} catch (e) {
  crashBDump = await page.evaluate(() => {
    const s = window.__FFM_API.state();
    const f = window.__FFM_API.debugFish();
    const c = window.__FFM_API.debugAudioStats();
    return { phase: s.phase, ended: s.ended, endReason: s.endReason, wings: s.wings, speed: s.speed, runTime: s.runTime, fish: f, calls: { ...c.calls }, ctx: c.contextState };
  });
  throw new Error(`crash B never landed: ${JSON.stringify(crashBDump)}`);
}
const afterCrash = await page.evaluate(() => window.__FFM_API.state().wings);
// touch the next hull inside the grace window (stays overlapping)
await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(25);
  api.debugTeleportToObstacle(1);
});
await page.waitForTimeout(120); // read still inside the grace
const inside = await page.evaluate(() => {
  const c = window.__FFM_API.debugAudioStats().calls;
  return { crashes: (c.collision ?? 0) + (c.collisionMajor ?? 0), wings: window.__FFM_API.state().wings };
});
assertEqual(inside.crashes, pre.crashes + 1, `no second crash inside the grace window (${inside.crashes})`);
assertEqual(inside.wings, afterCrash, 'no wing stacking inside the grace window');
// the fish reappears when the window ends — hop clear of all hulls first so
// the restore isn't raced by a re-hide on the hull we are still inside of;
// the blink means visible===true alone is not proof the window closed
await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(8);
  api.debugTeleportFar(api.debugFish().z + 14);
});
await page.waitForFunction(() => {
  const f = window.__FFM_API.debugFish();
  return f.crashHide === 0 && f.visible === true;
}, null, { timeout: 25000 });

// 3c. same-obstacle immunity (2026-10-17, user call "cant get hit by a same
// obstacle"): a hull that already hit you is dead for the rest of the run —
// pinned inside it past the window's end, the crash count must never move.
// Fresh run first: under the old wing rule the earlier sections' crashes end
// the run before this contract can be observed at all.
await page.evaluate(() => window.__FFM_API.debugRestart());
await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 15000 });
const preC = await page.evaluate(() => {
  const api = window.__FFM_API;
  api.debugSetSpeed(25);
  api.debugTeleportToObstacle(0);
  const c = api.debugAudioStats().calls;
  return { wings: api.state().wings, crashes: (c.collision ?? 0) + (c.collisionMajor ?? 0) };
});
await page.waitForFunction((n) => {
  const c = window.__FFM_API.debugAudioStats().calls;
  return ((c.collision ?? 0) + (c.collisionMajor ?? 0)) > n;
}, preC.crashes, { timeout: 25000 });
// crawl at min speed and keep re-pinning onto the same hull so the overlap
// outlives the 0.5 s grace; the sampler exits early the moment a re-hit lands
const steady = await page.evaluate(() => new Promise(resolve => {
  const api = window.__FFM_API;
  api.debugSetSpeed(8);
  let baseline = null;
  let armed = false;
  let t0 = 0;
  const samples = [];
  const iv = setInterval(() => {
    api.debugTeleportToObstacle(0); // stay overlapping the same hull
    const f = api.debugFish();
    const s = api.state();
    const c = api.debugAudioStats().calls;
    const crashes = (c.collision ?? 0) + (c.collisionMajor ?? 0);
    if (baseline === null) baseline = crashes;
    if (!armed && f.crashHide === 0) { armed = true; t0 = s.runTime; }
    samples.push(crashes);
    if ((armed && s.runTime - t0 >= 0.8) || crashes !== baseline) {
      clearInterval(iv);
      resolve({ armed, baseline, samples });
    }
  }, 150);
  setTimeout(() => { clearInterval(iv); resolve({ armed, baseline, samples }); }, 15000);
}));
assert(steady.armed && steady.samples.every(n => n === steady.baseline),
  `a hull can never hit twice (armed=${steady.armed}, crash counts: ${[...new Set(steady.samples)].join(',')})`);
// collisions never cost wings (2026-10-17, user call): only the debug hook may
const postC = await page.evaluate(() => window.__FFM_API.state().wings);
assertEqual(postC, preC.wings, 'collisions never cost wings');
await page.evaluate(() => window.__FFM_API.debugSetSpeed(25)); // §4 wants the fish moving

// 4. every live chunk validates: each obstacle row keeps a swimmable gap
// (patterns replaced the always-clear corridor — validity is per-row now;
// center-occupation is proven deterministically in unit tests, since an
// unsteered fish is SUPPOSED to wreck itself on the new hazards now)
// 2026-10-18 calibration: the old distance>150 wall-budget wait is
// decay-fragile at the rig floor measured today (fresh pages idle at
// 1.5–1.8 fps — HANDOFF §5 floor class): ~6 sim-s needed reads ~80 s wall,
// over the 90 s budget once one hull hit eats ~2.5 sim-s of recovery
// (measured: pre-fix run passed by a few wall-seconds; identical wait
// failed twice on an equally-built branch at the same fps floor). t15's
// teleport router is the established decay-proof composition: jump ahead
// (chunksAhead => ensureChunks composes immediately), let the fish drift
// two frames, then validate the fresh span.
let chunksValid = await page.evaluate(() => window.__FFM_API.debugChunksValid());
assert(chunksValid, 'spawn chunks keep a >= 3 m gap per row');
// run a while — or until the unsteered fish wrecks itself, which proves the
// hazards bite — then re-validate the fresh chunks either way
const zFresh = await page.evaluate(() => {
  const s = window.__FFM_API.state();
  window.__FFM_API.debugSetSpeed(25); // §4 wants the fish moving
  window.__FFM_API.debugTeleportFar(s.position[2] + 160);
  return s.position[2];
});
await page.waitForFunction((z0) => window.__FFM_API.state().position[2] > z0 + 2, zFresh, { timeout: 60000 });
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
