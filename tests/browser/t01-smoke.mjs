import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

await page.waitForTimeout(600);
const frames = await page.evaluate(() => window.__FFM.frames);
assert(frames > 3, `render loop running (frames=${frames})`);

const canvasCount = await page.evaluate(() => document.querySelectorAll('#app canvas').length);
assert(canvasCount === 1, 'exactly one canvas mounted');

const threeOk = await page.evaluate(async () => {
  const m = await import('./js/main.js').then(() => true).catch(() => false);
  return m;
});
assert(threeOk, 'main.js module evaluates');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t01-smoke');
await closePage(browser);
await stopServer(server);
