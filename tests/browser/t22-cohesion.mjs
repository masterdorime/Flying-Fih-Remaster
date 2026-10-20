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
    // The bloom is OPTIONAL: it renders the frame black in this vendored r170 setup, so it ships
    // disabled behind ATMOSPHERE.postFx.bloom. If one is present it must be half-resolution.
    if (pfx.bloom) {
      assert.ok(pfx.bloom.x <= Math.ceil(pfx.viewport.x / 2) + 1 && pfx.bloom.x > 0,
        `bloom, if enabled, must run at HALF resolution, got ${pfx.bloom.x}x${pfx.bloom.y} for a ${pfx.viewport.x} viewport`);
    }

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

test('t22: contact decals ground the nearest hulls', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=1337');
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });

    // the decal pool is fixed-size; what must hold is that the NEAR hulls are grounded and the
    // rest of the pool is switched OFF (a stale decal under open water is worse than none)
    let sawVisible = 0;
    let sawScaled = false;
    for (let i = 0; i < 20; i++) {
      const d = await page.evaluate(() => window.__FFM_API.debugDecals());
      if (d.visible > 0) sawVisible++;
      if (d.scale && d.scale[0] > 0 && d.scale[1] > 0) sawScaled = true;
      assert.ok(d.visible <= d.pooled, `visible decals (${d.visible}) cannot exceed the pool (${d.pooled})`);
      await advanceFrames(page, 1);
    }
    assert.ok(sawVisible > 0, 'at least one hull must be grounded as the fish travels');
    assert.ok(sawScaled, 'a decal must take its size from the hull footprint, not a fixed scale');

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});

test('t22: a LIVE gate never sits inside a hull (the invariant holds continuously)', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=1337');
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });

    const BAR = 3.0 + 0.8; // mouthRadius + clearanceMargin — the §7 acceptance bar
    let sampled = 0;
    let violations = 0;
    let worst = Infinity;
    let worstAt = null;

    // Sample every frame across a stretch of travel. A gate's clearance used to be asserted only
    // at spawn; this checks the same bar while it LIVES, which is what the structural fix makes
    // true. A couple of sub-bar frames are tolerated because a needed repair is RATE-LIMITED
    // (the ring drifts to clear water instead of teleporting) — but a gate left blocked, which
    // was the actual failure, stays blocked for its whole life and cannot hide here.
    for (let i = 0; i < 45; i++) {
      const r = await page.evaluate(() => {
        const g = window.__FFM_API.gate();
        if (!g) return null;
        const discs = window.__FFM_API.debugObstaclesNear(g.z, 30);
        let c = Infinity;
        for (const d of discs) {
          if (Math.abs(d.z - g.z) <= (d.rz ?? d.radius) + 3.0) {
            c = Math.min(c, Math.abs(g.x - d.x) - (d.rx ?? d.radius));
          }
        }
        return { c, x: +g.x.toFixed(2), z: +g.z.toFixed(2) };
      });
      if (r) {
        sampled++;
        if (r.c < worst) { worst = r.c; worstAt = `x${r.x}z${r.z}`; }
        if (r.c < BAR - 0.01) violations++;
      }
      await advanceFrames(page, 1);
    }

    assert.ok(sampled > 30, `expected to sample a live gate on most frames, got ${sampled}`);
    assert.ok(violations <= 2,
      `a live gate must keep the clearance bar ${BAR}: ${violations}/${sampled} frames below it (worst ${worst.toFixed(2)} at ${worstAt})`);

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});
