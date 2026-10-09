import { startServer, stopServer, openPage, closePage, assert, assertEqual } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. boot shows the main menu
assert(await page.isVisible('#ffm-menu'), 'main menu visible on boot');
assert(await page.isVisible('#ffm-start'), 'start button present');
assert(!(await page.isVisible('#ffm-hud')), 'HUD hidden in menu');

// 2. Start -> tutorial (first run) with a hint; skip goes to the run
await page.click('#ffm-start');
assert(await page.isVisible('#ffm-tutorial'), 'tutorial hint visible on first run');
await page.click('#ffm-tutorial-skip');
await page.waitForTimeout(200);
let s = await page.evaluate(() => window.__FFM_API.state());
assert(s.phase === 'run', `phase run after tutorial skip (${s.phase})`);
assert(await page.isVisible('#ffm-hud'), 'HUD visible during run');
assert(await page.isVisible('#ffm-tier'), 'gauge/tier label present');

// 3. tutorial completion persists: next start skips straight to run
await page.evaluate(() => window.__FFM_API.menu());
await page.waitForTimeout(100);
await page.click('#ffm-start');
await page.waitForTimeout(200);
s = await page.evaluate(() => window.__FFM_API.state());
assert(s.phase === 'run', 'second start skips tutorial (localStorage flag)');
assert(!(await page.isVisible('#ffm-tutorial')), 'no tutorial hint on second run');

// 4. pause stops the simulation entirely (PRD §2.3)
await page.waitForTimeout(400);
const d1 = await page.evaluate(() => window.__FFM_API.state().distance);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
assert(await page.isVisible('#ffm-pause'), 'pause screen on Escape');
const d2 = await page.evaluate(() => window.__FFM_API.state().distance);
await page.waitForTimeout(600);
const d3 = await page.evaluate(() => window.__FFM_API.state().distance);
assertEqual(d2, d3, 'simulation frozen while paused');
assert(d3 >= d1, 'distance preserved, not rewound');
await page.click('#ffm-resume');
await page.waitForTimeout(300);
const d4 = await page.evaluate(() => window.__FFM_API.state().distance);
assert(d4 > d3, `simulation resumes (${d3.toFixed(1)} -> ${d4.toFixed(1)})`);

// 5. failure -> results screen with all metrics (PRD §2.4)
await page.evaluate(() => { window.__FFM_API.setGauge(90); window.__FFM_API.applyResult('perfect'); window.__FFM_API.endRun(); });
await page.waitForTimeout(200);
assert(await page.isVisible('#ffm-results'), 'results screen after run end');
const rows = await page.evaluate(() => document.querySelector('#ffm-results-grid').textContent);
for (const label of ['Distance', 'Duration', 'Score', 'Highest tier', 'Top speed', 'Shrimp', 'Perfect', 'Good', 'Miss', 'Best chain']) {
  assert(rows.includes(label), `results shows ${label}`);
}

// 6. best distance persists across reload
const bestSaved = await page.evaluate(() => localStorage.getItem('ffm.bestDistance'));
assert(bestSaved && Number(bestSaved) > 0, `best distance saved (${bestSaved})`);
await page.reload();
await page.waitForFunction(() => window.__FFM?.ready);
const bestMenu = await page.textContent('#ffm-best-menu');
assert(Number(bestMenu) > 0, `best distance on menu after reload (${bestMenu}m)`);

// 7. settings screen persists values
await page.click('#ffm-settings-btn');
assert(await page.isVisible('#ffm-settings'), 'settings screen opens');
await page.evaluate(() => {
  const input = document.querySelector('input[data-key="cameraShake"]');
  input.value = '0.2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.click('#ffm-settings-back');
assert(await page.isVisible('#ffm-menu'), 'back to menu');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ffm.settings')));
assert(saved.cameraShake === 0.2, `settings saved (cameraShake=${saved.cameraShake})`);

// 8. assist toggle labels results (PRD §21.2)
await page.evaluate(() => {
  localStorage.setItem('ffm.settings', JSON.stringify({ assist: true }));
  window.__FFM_API.start({ assist: true });
  window.__FFM_API.endRun();
});
await page.waitForTimeout(150);
assert(await page.isVisible('#ffm-assist-badge'), 'assist mode flagged on results');

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t13-flow');
await closePage(browser);
await stopServer(server);
