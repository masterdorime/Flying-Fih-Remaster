import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => window.__FFM_API.start());

// 1. fish swims forward on its own (poll: sim runs slow under software rendering)
const z1 = await page.evaluate(() => window.__FFM_API.state().position[2]);
await page.waitForFunction((z) => window.__FFM_API.state().position[2] > z + 12, z1, { timeout: 30000 });
const z2 = await page.evaluate(() => window.__FFM_API.state().position[2]);
assert(z2 > z1 + 10, `fish advances forward (z ${z1.toFixed(1)} -> ${z2.toFixed(1)})`);

// 2. WASD steers toward the SCREEN direction (camera looks down +Z, so screen-right = world -X)
await page.keyboard.down('KeyD');
await page.waitForFunction(() => window.__FFM_API.state().position[0] < -1.5, { timeout: 20000 });
const afterRight = await page.evaluate(() => window.__FFM_API.state());
await page.keyboard.up('KeyD');
assert(afterRight.position[0] < -1.5, `D steers screen-right (world x=${afterRight.position[0].toFixed(2)})`);
// holding a direction keeps speed at the swim tier cap (boosts come only from timing)
assert(afterRight.speed <= 28, `holding a direction grants no speed (speed=${afterRight.speed.toFixed(2)})`);

await page.keyboard.down('KeyA');
await page.waitForFunction((x) => window.__FFM_API.state().position[0] > x + 1.5, afterRight.position[0], { timeout: 20000 });
await page.keyboard.up('KeyA');
const afterLeft = await page.evaluate(() => window.__FFM_API.state());
assert(afterLeft.position[0] > afterRight.position[0] + 1.5, 'A steers screen-left back across');

// 3. flight is LOCKED while swimming: a full-ish gauge does not lift the fish
await page.evaluate(() => window.__FFM_API.setGauge(12));
await page.waitForFunction(() => window.__FFM_API.state().tier === 'low', { timeout: 20000 });
const lowGauge = await page.evaluate(() => window.__FFM_API.state());
assert(lowGauge.tier === 'low', `gauge 12 -> low tier (got ${lowGauge.tier})`);
assertEqual(lowGauge.locomotion, 'swim', 'low gauge does not unlock flight');
await page.waitForTimeout(2500); // let the swim phase pull the fish back to the surface
const stillSwimming = await page.evaluate(() => window.__FFM_API.state());
assert(stillSwimming.locomotion === 'swim', `fish keeps swimming at low gauge (${stillSwimming.locomotion})`);
assert(stillSwimming.position[1] < 2, `flight locked: fish stays on the water (y=${stillSwimming.position[1].toFixed(2)})`);

// 4. render loop alive, no console errors
const fps = await page.evaluate(() => window.__FFM.fps);
assert(fps > 10, `fps healthy (${fps})`);
if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));

console.log('PASS  t07-scene-player');
await closePage(browser);
await stopServer(server);
