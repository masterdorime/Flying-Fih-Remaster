// t22 — cohesion: do the layers actually belong to one world?
//
// Each section is a live-read proof of one agreement between layers that a screenshot
// suggested and a unit test cannot see. The whole point of the cohesion phase is that no
// single change "blends" anything: it is the stack of small agreements (same field, same
// air, same light, same contact) that stops props reading as pasted on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, openPage, closePage } from './harness.mjs';

// advance N rendered frames (poll, never sleep; 3-arg waitForFunction or the options object
// is read as the predicate ARG and the timeout silently becomes 30 s — AGENTS §5.4)
async function advanceFrames(page, n) {
  const from = await page.evaluate(() => window.__FFM.frames ?? 0);
  await page.waitForFunction((f) => (window.__FFM.frames ?? 0) > f, from + n, { timeout: 180000 });
}

test('t22: hulls ride the swell instead of floating on a flat plane', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=1337');
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });

    // The field moves, so sample across frames: at least one nearby hull must be sitting
    // somewhere other than its canonical layout height.
    let maxDelta = 0;
    for (let i = 0; i < 10; i++) {
      const deltas = await page.evaluate(() => {
        const p = window.__FFM_API.state().position;
        return window.__FFM_API.debugObstaclesNear(p[2], 120)
          .map((d) => Math.abs((d.meshY ?? d.y) - d.y));
      });
      for (const d of deltas) if (d > maxDelta) maxDelta = d;
      await advanceFrames(page, 1);
    }

    // enough to be unmistakably riding (a flat plane gives exactly 0)
    assert.ok(maxDelta > 0.06,
      `hulls must ride the swell: max |rendered - canonical| = ${maxDelta.toFixed(3)} m`);
    // and it must stay inside the field's own envelope, or the offset is not the wave field
    assert.ok(maxDelta < 2.0,
      `riding must stay inside the field range: max = ${maxDelta.toFixed(3)} m`);

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});

test('t22: post-FX runs one transform over the whole frame, and both paths render', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=1337');
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });
    await advanceFrames(page, 2);

    // --- composer path (settings.postFx > 0, the default) ---
    const on = await page.evaluate(() => {
      window.__FFM_API.debugSetPostFx(1); // the default is 0.7; be explicit
      return null;
    });
    void on;
    await advanceFrames(page, 2);
    const pfx = await page.evaluate(() => window.__FFM_API.debugPostFx());
    assert.equal(pfx.active, true, 'the composer must be the live path when postFx > 0');
    assert.equal(pfx.toneMapping, 0, 'OutputPass owns tone mapping, so the renderer must stand down (0 = NoToneMapping)');
    assert.ok(pfx.bloom.x <= Math.ceil(pfx.viewport.x / 2) + 1 && pfx.bloom.x > 0,
      `bloom must run at HALF resolution, got ${pfx.bloom.x}x${pfx.bloom.y} for a ${pfx.viewport.x} viewport`);

    // --- direct path (settings.postFx = 0): must render and be tone-mapped, never black ---
    await page.evaluate(() => window.__FFM_API.debugSetPostFx(0));
    await advanceFrames(page, 2);
    const off = await page.evaluate(() => window.__FFM_API.debugPostFx());
    assert.equal(off.active, false, 'postFx = 0 must return to the direct render path');
    // assert WHICH LAYER tone-maps rather than a magic enum value: with the composer off the
    // renderer must do it (and the props keep their look, per T5's in-shader parity)
    assert.notEqual(off.toneMapping, 0, 'the direct path must tone-map in the renderer, not skip it');

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});
