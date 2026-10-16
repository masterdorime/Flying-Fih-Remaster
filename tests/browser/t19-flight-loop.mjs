// t19 — the full two-phase flight loop (user-approved vision):
// fill gauge with perfects -> first-flight SPAM-QTE charge -> gauge blows ->
// cinematic leap -> fly at fixed altitude above the clouds (environment swaps to
// sky) -> gauge drains -> descent -> landing -> back to swimming. Then a second
// run: later flights skip the spam ritual and the sky world is rebuilt.
import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => {
  // record every juice popup that ever appears (popup lifetimes are short)
  window.__POPUPS = [];
  new MutationObserver(() => {
    for (const e of document.querySelectorAll('.ffm-popup')) {
      const t = e.textContent.trim();
      if (t && !window.__POPUPS.includes(t)) window.__POPUPS.push(t);
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.__FFM_API.start();
  window.__FFM_API.setTimeScale(3); // sim runs slow under software GL
  // patterned water bites the unsteered: hold a clear lateral line while the
  // ritual setups swim (x-only nudges — locomotion/gauge/FOV untouched).
  // Cleared at charge (steering is measured there), restarted after, done at leap.
  window.__DODGE = setInterval(() => {
    try {
      const api = window.__FFM_API;
      const s = api.state();
      if (s.phase !== 'run' && s.phase !== 'tutorial') return;
      // swim, charge, leap: the ritual setups travel through patterned water.
      // Fly/descend have no ocean hazards; results/menu freeze the sim.
      // Never cleared except around the steering measurement below — after
      // that it runs to end of test (inert outside swim/charge/leap, and the
      // page dies with the test).
      if (s.locomotion !== 'swim' && s.locomotion !== 'charge' && s.locomotion !== 'leap') return;
      // hold a moderate swim speed (see t17): at 100+ u/s, software-GL frames
      // advance tens of meters per tick and the fish tunnels through rows
      // between decisions. No ritual assert measures speed values.
      if (s.locomotion === 'swim') api.debugSetSpeed(20);
      const z0 = s.position[2], x = s.position[0], MARGIN = 2.5, AHEAD = 45;
      // query wide, land careful: the landing x must clear ABEAM hazards too
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
    } catch (e) { /* test driver only */ }
  }, 30);
});
await page.waitForTimeout(300);

// 0. the sky world exists only above the clouds: hidden during the first swim
let vis = await page.evaluate(() => window.__FFM_API.debugVisibility());
assert(vis.sky === false, `sky world hidden while swimming (sky=${vis.sky})`);
assert(vis.water === true, 'ocean visible while swimming');

// 1. perfects fill the gauge, but the launch gate also needs a chain of hits.
//    Fill + miss happen in ONE evaluate so no frame can launch in between.
await page.evaluate(() => {
  const api = window.__FFM_API;
  for (let i = 0; i < 20 && api.state().gauge < 100; i++) api.applyResult('perfect');
  api.applyResult('miss'); // breaks the chain while the gauge is still full
});
let s = await page.evaluate(() => window.__FFM_API.state());
assert(s.gauge >= 100, `perfects fill the gauge (${s.gauge.toFixed(1)})`);
assert(s.chain === 0, 'a miss breaks the chain');
const gated = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    await new Promise(r => setTimeout(r, 100));
    if (api.state().locomotion !== 'swim') return api.state();
  }
  return api.state();
});
assertEqual(gated.locomotion, 'swim', 'full gauge without a chain does NOT launch (gate holds)');
assertEqual(gated.phase, 'run', 'the setup swim survived the patterned water');

// rebuild the chain AND refill the gauge: stray gate-misses and obstacle clips
// during the poll above drain it, and 5 top-up perfects from a drained base
// can't always reach the 100 launch threshold. Loop to BOTH conditions —
// synchronous, so no frame can intervene before the charge check fires.
await page.evaluate(() => {
  const api = window.__FFM_API;
  for (let i = 0; i < 40 && (api.state().chain < 5 || api.state().gauge < 100); i++) api.applyResult('perfect');
});
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'charge', { timeout: 30000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'charge', 'first flight enters the SPAM charge phase');
assert(await page.isVisible('#ffm-charge-meter'), 'charge meter shows during the QTE');
// the dodger stands down while steering is measured, then resumes to the leap.
// Slow the charge first: at charge speed the steering window swims straight
// through too many rows to survive (probe: wings 3 -> 1 in 16s unsteered).
// No ritual assert measures speed values.
await page.evaluate(() => { clearInterval(window.__DODGE); window.__FFM_API.debugSetSpeed(20); });

// the fish can still steer toward screen-right while charging (aim the launch).
// Fixed short hold, NOT distance-gated: waiting for a full meter would swim
// straight through rows until the fish dies first (see t17). Any consistent
// lateral movement proves steering; the rate itself is untiered here.
const cx0 = await page.evaluate(() => window.__FFM_API.state().position[0]);
await page.keyboard.down('KeyD');
await page.waitForTimeout(400);
await page.keyboard.up('KeyD');
const steered = await page.evaluate(() => window.__FFM_API.state());
assertEqual(steered.phase, 'run', 'steering window survived the rocks');
assert(steered.position[0] < cx0 - 0.05, `charge allows steering (x ${cx0.toFixed(1)} -> ${steered.position[0].toFixed(1)})`);
// dodger back on: the rest of the charge swims straight through patterned water
await page.evaluate(() => {
  const api = window.__FFM_API;
  window.__DODGE = setInterval(() => {
    try {
      const s = api.state();
      if (s.phase !== 'run' && s.phase !== 'tutorial') return;
      // swim, charge, leap: the ritual travels through patterned water the
      // whole way up. Left running to end of test (inert elsewhere).
      if (s.locomotion !== 'swim' && s.locomotion !== 'charge' && s.locomotion !== 'leap') return;
      // hold a moderate swim speed (see t17): at 100+ u/s, software-GL frames
      // advance tens of meters per tick and the fish tunnels through rows
      // between decisions. No ritual assert measures speed values.
      if (s.locomotion === 'swim') api.debugSetSpeed(20);
      const z0 = s.position[2], x = s.position[0], MARGIN = 2.5, AHEAD = 45;
      // query wide, land careful: the landing x must clear ABEAM hazards too
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
    } catch (e) { /* test driver only */ }
  }, 30);
});

// mashing overfills the gauge; the 5s timer forces the blow either way.
// 20 spams overfill from any gauge value, so the blow lands on the next frame
// instead of after seconds of unprotected charge swimming.
await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__FFM_API.debugSpam(); });
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'leap', { timeout: 30000 });

// the cinematic leap swells the FOV (60 -> 95) while the camera orbits.
// Sample through the leap AND its recovery: assert the dip (punch) and the
// settle back into the flight cam.
const fovRange = await page.evaluate(async () => {
  let min = 999, max = 0, leapEndedAt = 0;
  const t0 = Date.now();
  // generous wall budget: the first curtain crossing compiles new shaders on
  // the GPU, which stalls frames for seconds under software GL
  while (Date.now() - t0 < 25000) {
    const f = window.__FFM_API.debugCameraFov();
    min = Math.min(min, f); max = Math.max(max, f);
    if (window.__FFM_API.state().locomotion !== 'leap' && !leapEndedAt) leapEndedAt = Date.now();
    if (leapEndedAt && Date.now() - leapEndedAt > 2000) break; // flight cam settled
    await new Promise(r => setTimeout(r, 40));
  }
  return { min, max };
});
assert(fovRange.min < 80, `leap dips the FOV toward 60 (min ${fovRange.min.toFixed(1)})`);
assert(fovRange.max > 90, `camera settles back into the flight FOV (max ${fovRange.max.toFixed(1)})`);

// 2. the leap ends in flight at the fixed altitude, above the cloud curtain
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', null, { timeout: 40000 });
await page.waitForFunction(() => window.__FFM_API.state().position[1] > 70, null, { timeout: 40000 });
s = await page.evaluate(() => window.__FFM_API.state());
assert(Math.abs(s.position[1] - 85) < 8, `flight holds fixed altitude ~85, above the clouds (y=${s.position[1].toFixed(1)})`);
assert(s.firstFlightDone === true, 'first flight is marked done');
await page.waitForFunction(() => window.__FFM_API.debugEnvironment() === 'sky', { timeout: 20000 });
assertEqual(await page.evaluate(() => window.__FFM_API.debugEnvironment()), 'sky', 'environment swapped to the sky world');
vis = await page.evaluate(() => window.__FFM_API.debugVisibility());
assert(vis.sky === true, 'sky world visible above the clouds');
assert(vis.water === false, 'ocean hidden above the clouds (the curtain cuts both ways)');
assert(vis.skyInfo.trailAhead > 0, `sky shrimp trails spawn ahead (${vis.skyInfo.trailAhead})`);
assert(Math.abs(vis.skyInfo.slabZ - vis.skyInfo.playerZ) < 400, `cloud slab follows the fish (slab ${vis.skyInfo.slabZ} vs player ${vis.skyInfo.playerZ})`);

// 3. the gauge empties -> descent back through the clouds -> landing -> swimming again
await page.evaluate(() => window.__FFM_API.setGauge(1));
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'descend', null, { timeout: 40000 });
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'swim', null, { timeout: 90000 });
s = await page.evaluate(() => window.__FFM_API.state());
assert(s.position[1] < 2, `landing returns the fish to the water (y=${s.position[1].toFixed(2)})`);
assertEqual(await page.evaluate(() => window.__FFM_API.debugEnvironment()), 'ocean', 'environment swapped back to the ocean');
vis = await page.evaluate(() => window.__FFM_API.debugVisibility());
assert(vis.sky === false && vis.water === true, 'visibility restored on landing');

// 4. the ritual was announced: SPAM on charge, LIFTOFF on the blow
const popups = await page.evaluate(() => window.__POPUPS);
assert(popups.some(t => t.includes('SPAM')), `SPAM popup fired on charge (saw: ${popups.join(', ')})`);
assert(popups.some(t => t.includes('LIFTOFF')), `LIFTOFF popup fired on the blow (saw: ${popups.join(', ')})`);

// 5. later flights in the SAME run skip the spam: a full gauge auto-launches into the leap
await page.evaluate(() => {
  const api = window.__FFM_API;
  for (let i = 0; i < 20 && api.state().gauge < 100; i++) api.applyResult('perfect');
});
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'leap', null, { timeout: 40000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'leap', 'later flights skip the spam and auto-launch');
assert(s.firstFlightDone === true, 'the first flight is still marked done');

// 6. a new run rebuilds the sky world from scratch around the fish
//    (gauge must be full: an empty gauge in the sky descends immediately)
await page.evaluate(() => {
  window.__FFM_API.start();
  window.__FFM_API.setGauge(100);
  window.__FFM_API.debugForceFlight();
});
await page.waitForFunction(() => window.__FFM_API.debugVisibility().sky === true, null, { timeout: 40000 });
vis = await page.evaluate(() => window.__FFM_API.debugVisibility());
assert(vis.skyInfo.trailAhead > 0, `sky shrimp rebuilt after restart (${vis.skyInfo.trailAhead} ahead)`);
assert(Math.abs(vis.skyInfo.slabZ - vis.skyInfo.playerZ) < 400, `cloud slab rebuilt near the fish after restart (slab ${vis.skyInfo.slabZ} vs player ${vis.skyInfo.playerZ})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t19-flight-loop');
await closePage(browser);
await stopServer(server);
