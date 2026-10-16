import { startServer, stopServer, openPage, closePage, assert } from './harness.mjs';

const server = await startServer();
const { browser, page, consoleErrors } = await openPage();

// 1. FOV responds to tier (poll: FOV eases toward the target)
await page.evaluate(() => window.__FFM_API.start());
await page.waitForTimeout(150);
// patterned water bites the unsteered (probe: gauge 105 -> capped 25 in 2.5s,
// FOV never reaches tier target). Hold a clear line + moderate speed while the
// camera measurements run — FOV/shake/kick never read position.
await page.evaluate(() => {
  const api = window.__FFM_API;
  window.__DODGE = setInterval(() => {
    try {
      const s = api.state();
      if (s.phase !== 'run' || s.locomotion !== 'swim') return;
      api.debugSetSpeed(20);
      const z0 = s.position[2], x = s.position[0], MARGIN = 2.5, AHEAD = 45;
      const discs = api.debugObstaclesNear(z0 + AHEAD, AHEAD + 6);
      for (const d of discs) {
        if (d.z < z0 + 4 || Math.abs(d.x - x) >= d.radius + MARGIN) continue;
        let best = x, bd = 1e9;
        for (let cx = -13; cx <= 13; cx += 1) {
          let ok = true;
          for (const e of discs) {
            if (e.z < z0 - 6) continue;
            if (Math.abs(e.x - cx) < e.radius + MARGIN) { ok = false; break; }
          }
          if (ok && Math.abs(cx - x) < bd) { bd = Math.abs(cx - x); best = cx; }
        }
        api.debugSetLateral(best);
        break;
      }
    } catch (e) { /* test driver only */ }
  }, 30);
});
await page.evaluate(() => window.__FFM_API.setGauge(105)); // max tier
await page.waitForFunction(() => window.__FFM_API.debugCameraFov() >= 90, { timeout: 20000 });

await page.evaluate(() => window.__FFM_API.setGauge(20)); // low tier
await page.waitForFunction(() => window.__FFM_API.debugCameraFov() < 75, { timeout: 20000 });
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
