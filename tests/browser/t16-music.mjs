import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
// musicdebug panel + real user activation: launch with audio flags so the context can run
const { browser, page, consoleErrors } = await openPage('?musicdebug=1');
await page.waitForTimeout(1500);

// 1. all ladder tracks + menu track loaded, no missing files
const state0 = await page.evaluate(() => window.__FFM_API.debugMusic());
assert(state0.tracksLoaded === 5, `5 music tracks loaded (got ${state0.tracksLoaded}, failed: ${state0.failed.join(',') || 'none'})`);
assert(state0.failed.length === 0, 'no missing music files');
const audioStats = await page.evaluate(() => window.__FFM_API.debugAudioStats());
assert(audioStats.filesMissing.length === 0, `all SFX/ambient files loaded (missing: ${audioStats.filesMissing.join(',') || 'none'})`);

// 2. panel exists with a 0-100 slider
assert(await page.isVisible('#music-test'), 'music test panel visible');
const slider = await page.$('#mt-slider');
const range = await page.evaluate(() => {
  const s = document.querySelector('#mt-slider');
  return { min: s.min, max: s.max };
});
assertEqual(range.min, '0', 'slider minimum is 0');
assertEqual(range.max, '100', 'slider maximum is 100');

// 3. dragging the slider crossfades rungs: 0 -> calm, 45 -> mid, 70 -> high, 90 -> max
await page.evaluate(() => {
  const set = (v) => {
    const s = document.querySelector('#mt-slider');
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(0);
});
await page.waitForTimeout(300);
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().rung), 'calm', 'momentum 0 -> calm rung');
await page.evaluate(() => {
  const s = document.querySelector('#mt-slider');
  s.value = '45'; s.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().rung), 'mid', 'momentum 45% -> mid rung');
await page.evaluate(() => {
  const s = document.querySelector('#mt-slider');
  s.value = '70'; s.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().rung), 'high', 'momentum 70% -> high rung');
await page.evaluate(() => {
  const s = document.querySelector('#mt-slider');
  s.value = '95'; s.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().rung), 'max', 'momentum 95% -> max rung');

// 4. crossfade: swap moves targets (calm -> 0, max -> volume) — a crossfade from
// an audible state, never a cut from silence. (param.value reads 0 in headless
// without an audio device, so the JS-side ramp targets are the assertion source)
const swap = await page.evaluate(async () => {
  const s = document.querySelector('#mt-slider');
  s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2100)); // let the calm crossfade settle
  const before = window.__FFM_API.debugMusic().targets;
  s.value = '90'; s.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const after = window.__FFM_API.debugMusic().targets;
  return { before, after };
});
assert(swap.before.calm > 0, `previous rung was audible before the swap (calm target ${swap.before.calm})`);
assert(swap.after.calm === 0, `old rung ramps to 0 (calm target ${swap.after.calm})`);
assert(swap.after.max > 0, `new rung ramps up (max target ${swap.after.max})`);

// 5. transport controls: mute / volume / pause
await page.evaluate(() => document.querySelector('#mt-mute').click());
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().muted), true, 'mute works');
await page.evaluate(() => document.querySelector('#mt-mute').click());
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().muted), false, 'unmute works');
await page.evaluate(() => document.querySelector('#mt-pause').click());
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().playing), false, 'pause works');
await page.evaluate(() => document.querySelector('#mt-play').click());
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().playing), true, 'play works');
await page.evaluate(() => {
  const v = document.querySelector('#mt-vol');
  v.value = '40'; v.dispatchEvent(new Event('input', { bubbles: true }));
});
assertEqual(await page.evaluate(() => window.__FFM_API.debugMusic().volume), 0.4, 'volume control works');

// 6. missing files degrade gracefully (controller survives a bogus load, keeps current tracks)
const missing = await page.evaluate(() => window.__FFM_API.debugMusicMissing());
assertEqual(missing, 'ok', 'loading a missing track does not break the controller');

// 7. real SFX fired during gameplay (files loaded -> file playback, synth only as fallback)
const sfxCalls = await page.evaluate(async () => {
  window.__FFM_API.start();
  window.__FFM_API.applyResult('perfect');
  window.__FFM_API.applyResult('miss');
  await new Promise(r => setTimeout(r, 150));
  return window.__FFM_API.debugAudioStats();
});
assert((sfxCalls.calls.perfect ?? 0) >= 1, `perfect sfx fired (${JSON.stringify(sfxCalls.calls)})`);
assert((sfxCalls.calls.miss ?? 0) >= 1, 'miss sfx fired');
assert(sfxCalls.filesLoaded >= 11, `SFX + ambience files loaded (${sfxCalls.filesLoaded})`);

// 8. zero console errors (the deliberate missing-file 404 + loadBuffer warnings are expected)
const realErrors = consoleErrors.filter(e =>
  !e.includes('missing or unreadable') && !e.includes('Failed to load resource'));
if (realErrors.length) throw new Error('console errors: ' + realErrors.join(' | '));

console.log('PASS  t16-music');
await closePage(browser);
await stopServer(server);
