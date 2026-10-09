import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. FOV responds to tier
await page.evaluate(() => window.__FFM_API.start());
await page.waitForTimeout(150);
const fovNone = await page.evaluate(() => window.__FFM_API.state().tier === 'none');
await page.evaluate(() => window.__FFM_API.setGauge(105)); // max tier
await page.waitForTimeout(500);
const camFovMax = await page.evaluate(() => {
  // read fov off the renderer's camera via the game's camera rig: expose via pixels? use __FFM_API state + debug hook
  return window.__FFM_API.debugCameraFov();
});
assert(camFovMax >= 90, `camera FOV widens at max tier (${camFovMax.toFixed(1)})`);

await page.evaluate(() => window.__FFM_API.setGauge(20)); // low tier
await page.waitForTimeout(500);
const camFovLow = await page.evaluate(() => window.__FFM_API.debugCameraFov());
assert(camFovLow < 75, `camera FOV narrows back at low tier (${camFovLow.toFixed(1)})`);

// 2. shake offset > 0 on miss (cameraShake default 0.7)
await page.evaluate(() => window.__FFM_API.setGauge(60));
await page.waitForTimeout(300);
await page.evaluate(() => window.__FFM_API.applyResult('miss'));
const shakeOffsets = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(window.__FFM_API.debugShakeOffset());
    await new Promise(r => setTimeout(r, 25));
  }
  return out;
});
const maxShake = Math.max(...shakeOffsets);
assert(maxShake > 0.01, `camera shakes on miss (offset ${maxShake.toFixed(3)})`);

// 3. cameraShake = 0 disables shake (PRD §21 adjustable camera shake)
await page.evaluate(() => window.__FFM_API.setSettingsShake(0));
await page.evaluate(() => window.__FFM_API.applyResult('miss'));
const calmOffsets = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(window.__FFM_API.debugShakeOffset());
    await new Promise(r => setTimeout(r, 25));
  }
  return out;
});
assert(Math.max(...calmOffsets) === 0, `shake disabled by setting (max offset ${Math.max(...calmOffsets)})`);

// 4. kick on perfect pushes the camera back briefly
const kickSamples = await page.evaluate(async () => {
  const before = window.__FFM_API.debugCameraPos();
  window.__FFM_API.applyResult('perfect');
  await new Promise(r => setTimeout(r, 60));
  const after = window.__FFM_API.debugCameraPos();
  return { before, after };
});
const dz = Math.abs(kickSamples.after[2] - kickSamples.before[2]);
assert(dz > 0.05, `camera kick on perfect (dz ${dz.toFixed(3)})`);

if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.join(' | '));
console.log('PASS  t09-camera');
await closePage(browser);
await stopServer(server);
