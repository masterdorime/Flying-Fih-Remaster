import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. hitting max gauge engages plane mode
await page.evaluate(() => { window.__FFM_API.start(); window.__FFM_API.setGauge(115); });
await page.waitForTimeout(300);
let s = await page.evaluate(() => window.__FFM_API.state());
assert(s.tier === 'max', `gauge 101 -> max tier (${s.tier})`);
assert(s.planeMode === true, 'plane mode engaged at full gauge');
const popup = await page.evaluate(() => [...document.querySelectorAll('.ffm-popup')].map(e => e.textContent).join(','));
assert(popup.includes('MAX FLIGHT'), `MAX FLIGHT popup (${popup})`);

// 2. plane mode flies like a plane: pitch climbs toward the ceiling, W/S control pitch
const prePitch = await page.evaluate(() => window.__FFM_API.state().position[1]);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1000);
await page.keyboard.up('KeyW');
const climbing = await page.evaluate(() => window.__FFM_API.state());
assert(climbing.position[1] > prePitch + 8, `pitch-up climbs (y ${prePitch.toFixed(1)} -> ${climbing.position[1].toFixed(1)})`);
// keep holding: plane climb continues far above normal tier altitude
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
const highClimb = await page.evaluate(() => window.__FFM_API.state());
assert(highClimb.position[1] > climbing.position[1] + 10, `free climb continues (y=${highClimb.position[1].toFixed(1)})`);

await page.keyboard.down('KeyS');
await page.waitForTimeout(800);
await page.keyboard.up('KeyS');
const diving = await page.evaluate(() => window.__FFM_API.state());
assert(diving.position[1] < highClimb.position[1] - 3, `pitch-down descends (${highClimb.position[1].toFixed(1)} -> ${diving.position[1].toFixed(1)})`);

// 3. banking in plane mode: hold D briefly and sample before the lane edge
const roll0 = await page.evaluate(() => window.__FFM_API.debugBanking());
const x0 = await page.evaluate(() => window.__FFM_API.state().position[0]);
await page.keyboard.down('KeyD');
await page.waitForTimeout(160);
const bankSample = await page.evaluate(() => ({ roll: window.__FFM_API.debugBanking(), x: window.__FFM_API.state().position[0] }));
await page.keyboard.up('KeyD');
const rolled = await page.evaluate(() => window.__FFM_API.state());
assert(bankSample.x < x0 - 2, `bank-turn moves the fish screen-right (x ${x0.toFixed(1)} -> ${bankSample.x.toFixed(1)})`);
assert(Math.abs(bankSample.roll) > 0.3, `banking rolls the fish (${roll0.toFixed(2)} -> ${bankSample.roll.toFixed(2)})`);
assert(rolled.position[0] < x0, 'sideways drift persists');

// 4. dropping below 100 exits plane mode with a damp + POWER DOWN
await page.evaluate(() => window.__FFM_API.setGauge(99));
await page.waitForTimeout(300);
const dropped = await page.evaluate(() => window.__FFM_API.state());
assert(dropped.planeMode === false, 'plane mode exits below max gauge');
assert(dropped.tier === 'high', `tier steps down to high (${dropped.tier})`);

// 5. speed cap in plane mode reaches toward 110 with chained perfects
await page.evaluate(() => { window.__FFM_API.setGauge(100); window.__FFM_API.applyResult('perfect'); window.__FFM_API.applyResult('perfect'); });
await page.waitForTimeout(500);
const fast = await page.evaluate(() => window.__FFM_API.state());
assert(fast.speed > 60, `max tier accelerates hard (speed=${fast.speed.toFixed(1)})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t12-plane');
await closePage(browser);
await stopServer(server);
