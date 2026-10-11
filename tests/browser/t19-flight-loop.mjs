// t19 — the full two-phase flight loop (user-approved vision):
// fill gauge with perfects -> first-flight SPAM-QTE charge -> gauge blows ->
// cinematic leap -> fly at fixed altitude above the clouds (environment swaps to
// sky) -> gauge drains -> descent -> landing -> back to swimming.
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
});
await page.waitForTimeout(300);

// 1. perfects fill the gauge; the chain gate opens the first flight (t07 owns the
//    flight-locked-while-swimming check itself)
await page.evaluate(() => {
  const api = window.__FFM_API;
  for (let i = 0; i < 20 && api.state().gauge < 100; i++) api.applyResult('perfect');
});
let s = await page.evaluate(() => window.__FFM_API.state());
assert(s.gauge >= 100, `perfects fill the gauge (${s.gauge.toFixed(1)})`);
assert(s.chain >= 5, `chain of hits opens the launch gate (chain=${s.chain})`);

// 2. the first flight is a SPAM-QTE: locked, trembling, with a charge meter
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'charge', { timeout: 30000 });
s = await page.evaluate(() => window.__FFM_API.state());
assertEqual(s.locomotion, 'charge', 'first flight enters the SPAM charge phase');
assert(await page.isVisible('#ffm-charge-meter'), 'charge meter shows during the QTE');

// mashing overfills the gauge; the 5s timer forces the blow either way
await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__FFM_API.debugSpam(); });
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'leap', { timeout: 30000 });

// 3. the leap ends in flight at the fixed altitude, above the cloud curtain
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'fly', { timeout: 40000 });
await page.waitForFunction(() => window.__FFM_API.state().position[1] > 70, { timeout: 40000 });
s = await page.evaluate(() => window.__FFM_API.state());
assert(Math.abs(s.position[1] - 85) < 8, `flight holds fixed altitude ~85, above the clouds (y=${s.position[1].toFixed(1)})`);
assert(s.firstFlightDone === true, 'first flight is marked done');
await page.waitForFunction(() => window.__FFM_API.debugEnvironment() === 'sky', { timeout: 20000 });
assertEqual(await page.evaluate(() => window.__FFM_API.debugEnvironment()), 'sky', 'environment swapped to the sky world');

// 4. the gauge empties -> descent back through the clouds -> landing -> swimming again
await page.evaluate(() => window.__FFM_API.setGauge(1));
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'descend', { timeout: 40000 });
await page.waitForFunction(() => window.__FFM_API.state().locomotion === 'swim', { timeout: 90000 });
s = await page.evaluate(() => window.__FFM_API.state());
assert(s.position[1] < 2, `landing returns the fish to the water (y=${s.position[1].toFixed(2)})`);
assertEqual(await page.evaluate(() => window.__FFM_API.debugEnvironment()), 'ocean', 'environment swapped back to the ocean');

// 5. the ritual was announced: SPAM on charge, LIFTOFF on the blow
const popups = await page.evaluate(() => window.__POPUPS);
assert(popups.some(t => t.includes('SPAM')), `SPAM popup fired on charge (saw: ${popups.join(', ')})`);
assert(popups.some(t => t.includes('LIFTOFF')), `LIFTOFF popup fired on the blow (saw: ${popups.join(', ')})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t19-flight-loop');
await closePage(browser);
await stopServer(server);
