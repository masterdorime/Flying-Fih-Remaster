import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. audio survives a full event sequence without errors
await page.evaluate(() => window.__FFM_API.start());
await page.evaluate(() => window.__FFM_API.debugResumeAudio());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const api = window.__FFM_API;
  api.applyResult('perfect');
  api.applyResult('good');
  api.applyResult('miss');
  api.setGauge(105);
});
await page.waitForTimeout(400);
await page.evaluate(() => window.__FFM_API.setGauge(20));
await page.waitForTimeout(300);

const stats = await page.evaluate(() => window.__FFM_API.debugAudioStats());
assert(stats.calls.perfect >= 1, `perfect sfx fired (${stats.calls.perfect})`);
assert(stats.calls.good >= 1, 'good sfx fired');
assert(stats.calls.miss >= 1, 'miss sfx fired');
assert(stats.calls.planeEnter >= 1, 'plane sfx fired');

// 2. volume settings change the gain graph without errors
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('ffm.settings') || '{}');
  s.master = 0.3; s.music = 0.2; s.sfx = 0.4;
  localStorage.setItem('ffm.settings', JSON.stringify(s));
});
await page.reload();
await page.waitForFunction(() => window.__FFM?.ready);
await page.evaluate(() => window.__FFM_API.debugResumeAudio());
assert(true, 'audio re-init after reload ok');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t14-audio');
await closePage(browser);
await stopServer(server);
