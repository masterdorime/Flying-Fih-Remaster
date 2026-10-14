import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. fragile crashes cost wings; three ends the run as CRASHED
await page.evaluate(() => { window.__FFM_API.start(); window.__FFM_API.setGauge(20); });
await page.waitForTimeout(300);
let s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.wings, 3, 'run starts with 3 wings');
assert(s.phase === 'run', 'run active');

const wings = await page.evaluate(() => {
  const out = [];
  out.push(window.__FFM_API.debugLoseWing()); // fragile crash
  out.push(window.__FFM_API.debugLoseWing());
  return out;
});
assertEqual(wings[0], 2, 'first fragile crash leaves 2 wings');
assertEqual(wings[1], 1, 'second fragile crash leaves 1 wing');
s = await page.evaluate(() => window.__FFM_API.state());
assert(s.phase === 'run', 'run continues with 1 wing (recovery possible)');
// poll for the HUD pips: software-GL frames are slow, a fixed sleep can read
// before the first render lands (repo rule: poll, never sleep)
await page.waitForFunction(() => document.querySelector('#ffm-wings')?.textContent.includes('✦'), { timeout: 30000 });
const pipText = await page.evaluate(() => document.querySelector('#ffm-wings').textContent);
assert(pipText.includes('✦'), `wing pips render in the HUD (${pipText.trim()})`);

await page.evaluate(() => window.__FFM_API.debugLoseWing()); // third -> over
await page.waitForTimeout(200);
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.phase, 'results', 'third fragile crash ends the run');
assertEqual(s.endReason, 'CRASHED', 'end reason is CRASHED');
assert(await page.isVisible('#ffm-results'), 'results screen shown');
const title = await page.textContent('#ffm-results-title');
assert(title.includes('CRASHED'), `results title shows CRASHED (${title})`);

// 2. restart restores full wings
await page.evaluate(() => window.__FFM_API.start());
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.wings, 3, 'restart restores 3 wings');
assert(s.phase === 'run', 'run restarts');

// 3. speed pinned at MinSpeed while in the sky flight phase ends the run (engines out)
const collapse = await page.evaluate(async () => {
  const api = window.__FFM_API;
  api.start();
  api.setTimeScale(4);
  api.setGauge(110);
  api.debugForceFlight();          // get airborne first: the water is the recovery zone
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 120));
    const s = api.state();
    if (s.phase === 'results') break;
    // simulate a double Max-tier miss: gauge still full, speed floored, no thrust
    api.setGauge(110);
    api.debugSetSpeed(8);
  }
  return api.state();
});
assertEqual(collapse.phase, 'results', 'collapsed momentum ends the run');
assertEqual(collapse.endReason, 'OUT OF MOMENTUM', 'end reason is OUT OF MOMENTUM');

// 4. natural path: two real Max-tier misses while in the sky = plummet + run over
const natural = await page.evaluate(async () => {
  const api = window.__FFM_API;
  api.start();
  api.setGauge(110);
  api.debugForceFlight();          // setGauge no longer triggers flight on its own
  // climb to the sky world first (low altitude + water = survivable recovery)
  const climbDeadline = Date.now() + 20000;
  while (Date.now() < climbDeadline) {
    await new Promise(r => setTimeout(r, 120));
    if (api.state().position[1] > 50) break;
  }
  api.applyResult('miss'); // -70 at max tier
  api.applyResult('miss'); // floored at MinSpeed
  const minSpeedSeen = api.state().speed;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 150));
    if (api.state().phase === 'results') break;
  }
  const s = api.state();
  return { minSpeedSeen, phase: s.phase, reason: s.endReason, speed: s.speed, alt: s.position[1] };
});
assert(natural.minSpeedSeen <= 8.01, `misses pinned speed at minimum (${natural.minSpeedSeen})`);
assertEqual(natural.phase, 'results', 'natural double-miss ends the run');
assertEqual(natural.reason, 'OUT OF MOMENTUM', 'natural path ends OUT OF MOMENTUM');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t18-gameover');
await closePage(browser);
await stopServer(server);
