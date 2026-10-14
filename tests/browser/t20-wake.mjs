// t20 — surface-contact wake: the ribbon trails the fish while swimming,
// curves with turns, and drains away in flight (nothing disturbs water airborne).
import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.evaluate(() => window.__FFM_API.start());

// 1. swimming builds a wake trail (poll: sim runs slow under software rendering)
await page.waitForFunction(() => (window.__FFM_API.debugWake()?.trailPoints ?? 0) >= 8, null, { timeout: 90000 });
const swimming = await page.evaluate(() => window.__FFM_API.debugWake());
assert(swimming.ribbonVisible, 'wake ribbon visible while swimming');
assert(swimming.ripplesActive >= 1, `contact ripples spawn while swimming (${swimming.ripplesActive})`);

// 2. turning curves the wake: hold D and watch the trail spread laterally
await page.keyboard.down('KeyD');
await page.waitForFunction(() => (window.__FFM_API.debugWake()?.spreadX ?? 0) > 1.5, null, { timeout: 60000 });
await page.keyboard.up('KeyD');
const turned = await page.evaluate(() => window.__FFM_API.debugWake());
assert(turned.spreadX > 1.5, `wake curves with the turn (spreadX=${turned.spreadX.toFixed(2)})`);

// 3. flight stops the wake: the trail drains, the ribbon hides.
// Fresh run first: the long turn above may have crashed the fish (results
// phase freezes both the locomotion mirror and the wake drain).
await page.evaluate(() => window.__FFM_API.start());
await page.evaluate(() => window.__FFM_API.debugForceFlight());
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', { timeout: 30000 });
await page.waitForFunction(() => (window.__FFM_API.debugWake()?.trailPoints ?? 99) === 0, null, { timeout: 60000 });
const flown = await page.evaluate(() => window.__FFM_API.debugWake());
assertEqual(flown.trailPoints, 0, 'no wake trail remains airborne');
assert(!flown.ribbonVisible, 'ribbon hidden in flight');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t20-wake');
await closePage(browser);
await stopServer(server);
