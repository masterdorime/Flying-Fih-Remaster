import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => window.__FFM_API.start());

// 1. fish swims forward on its own
const z1 = await page.evaluate(() => window.__FFM_API.state().position[2]);
await page.waitForTimeout(1000);
const z2 = await page.evaluate(() => window.__FFM_API.state().position[2]);
assert(z2 > z1 + 10, `fish advances forward (z ${z1.toFixed(1)} -> ${z2.toFixed(1)})`);

// 2. WASD steers laterally without granting speed
await page.keyboard.down('KeyD');
await page.waitForTimeout(600);
await page.keyboard.up('KeyD');
const afterRight = await page.evaluate(() => window.__FFM_API.state());
assert(afterRight.position[0] > 1.5, `steering moves fish right (x=${afterRight.position[0].toFixed(2)})`);
// holding a direction keeps speed at the swim tier cap (boosts come only from timing)
assert(afterRight.speed <= 28, `holding a direction grants no speed (speed=${afterRight.speed.toFixed(2)})`);
await page.waitForTimeout(1000);
const stillCapped = await page.evaluate(() => window.__FFM_API.state());
assert(stillCapped.speed <= 28, `speed keeps decaying to the swim cap without timing (${stillCapped.speed.toFixed(2)})`);

await page.keyboard.down('KeyA');
await page.waitForTimeout(600);
await page.keyboard.up('KeyA');
const afterLeft = await page.evaluate(() => window.__FFM_API.state());
assert(afterLeft.position[0] < afterRight.position[0] - 1.5, 'steering moves fish back left');

// 3. gauge drains toward water when flying
await page.evaluate(() => window.__FFM_API.setGauge(12));
await page.waitForTimeout(400);
const midFlight = await page.evaluate(() => window.__FFM_API.state());
assert(midFlight.tier === 'low', `gauge 12 -> low tier (got ${midFlight.tier})`);
assert(midFlight.position[1] > 3, `fish climbs when flying (y=${midFlight.position[1].toFixed(2)})`);
await page.waitForTimeout(4000); // 3.5/s drain -> gauge hits 0
const sinking = await page.evaluate(() => window.__FFM_API.state());
assert(sinking.tier === 'none', `gauge drained to none tier (got ${sinking.tier})`);
assert(sinking.position[1] < 2, `fish sinks back to water as gauge drains (y=${sinking.position[1].toFixed(2)})`);

// 4. render loop alive, no console errors
const fps = await page.evaluate(() => window.__FFM.fps);
assert(fps > 10, `fps healthy (${fps})`);
if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));

console.log('PASS  t07-scene-player');
await closePage(browser);
await stopServer(server);
