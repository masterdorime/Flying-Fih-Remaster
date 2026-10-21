// t23 — the horizon layer: is distant scenery actually distant, grounded, and inert?
//
// Every check here is something a screenshot cannot prove and a unit test cannot see: the layer is
// live, so its live reads are the evidence. Three of them are the spec's load-bearing rules —
// nothing nearer than the floor (or distant rock reads as a hazard), no obstacle disc ever matches
// a stack (non-collidable, provably), and a recycle never drops rock into the playable band.
//
// Recycle is exercised by TELEPORTING the fish forward rather than waiting: at this rig's sim rate
// (fps x 0.05 dt clamp) crossing the 600 m band takes minutes of wall time. This is the t15/t10
// router precedent — induce the condition instead of waiting for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, openPage, closePage } from './harness.mjs';

async function advanceFrames(page, n) {
  const from = await page.evaluate(() => window.__FFM.frames ?? 0);
  await page.waitForFunction((f) => (window.__FFM.frames ?? 0) > f, from + n, { timeout: 180000 });
}

test('t23: distant stacks keep the floor, the lane, and their distance from collision', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=1337');
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });
    // The rock templates load lazily (boot is untouched), so poll for readiness rather than
    // sleeping — a fixed wait here would be a race against disk.
    await page.waitForFunction(() => window.__FFM_API.debugHorizon().ready === true, null, { timeout: 60000 });
    await advanceFrames(page, 4);

    // The layer reports its own config, so this test duplicates no literal.
    const first = await page.evaluate(() => window.__FFM_API.debugHorizon());
    assert.ok(Number.isFinite(first.cap) && first.cap > 0, `debugHorizon must report a positive cap, got ${first.cap}`);
    assert.ok(Number.isFinite(first.minZ) && first.minZ > 0, `debugHorizon must report the floor, got ${first.minZ}`);

    let yMoved = false;
    let prevY = null;
    let zBefore = null;

    for (let i = 0; i < 12; i++) {
      const s = await page.evaluate(() => {
        const info = window.__FFM_API.debugHorizon();
        const fishZ = window.__FFM_API.state().position[2];
        const discs = window.__FFM_API.debugObstaclesNear(fishZ, 800);
        return { ...info, fishZ, discs: discs.map((d) => ({ x: d.x, z: d.z })) };
      });

      // --- the stack layer reports live positions -------------------------------
      assert.ok(Array.isArray(s.stacks), 'debugHorizon.stacks must be a list of live stack positions');
      assert.equal(s.stacks.length, s.cap, `every slot must be live: got ${s.stacks.length} of ${s.cap}`);

      if (zBefore === null) zBefore = s.stacks.map((v) => +v.z.toFixed(2)).sort((a, b) => a - b);

      for (const v of s.stacks) {
        // (1) THE FLOOR: nothing may stand nearer than minZ ahead of the fish.
        assert.ok(v.z - s.fishZ >= s.minZ - 1,
          `a stack stands ${(v.z - s.fishZ).toFixed(1)} m ahead, inside the ${s.minZ} m floor — distant rock must never be in the playable band`);
        // (2) NON-COLLIDABLE: no obstacle disc may coincide with a stack. This is the proof that
        // the layer never registered itself with the collision world.
        for (const d of s.discs) {
          assert.ok(Math.abs(d.x - v.x) > 0.5 || Math.abs(d.z - v.z) > 0.5,
            `an obstacle disc at (${d.x}, ${d.z}) coincides with a stack at (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) — the far layer must not be collidable`);
        }
        // (3) GROUNDED: a stack rides the swell, so its y must differ from a flat plane's.
        if (prevY !== null && Math.abs(prevY - v.y) > 1e-4) yMoved = true;
      }

      // --- the drift band: same two rules, and the same inertness proof ------------------
      assert.ok(Array.isArray(s.drift), 'debugHorizon.drift must be a list of live drift positions');
      assert.equal(s.drift.length, s.driftCap, `every drift slot must be live: ${s.drift.length} of ${s.driftCap}`);
      for (const d of s.drift) {
        // tolerance for frame quantisation: the recycle triggers inside the band and the fish
        // advances ~1.3 m per frame at this speed
        assert.ok(d.z - s.fishZ >= s.driftNear - 3,
          `drift must stay in its own band: ${(d.z - s.fishZ).toFixed(1)} m ahead, band starts at ${s.driftNear}`);
        // BOTH ends of the band: bounding only the near end let a double-offset recycle park drift
        // 400-600 m out, where it is 3 px and the band it exists to fill stays empty.
        assert.ok(d.z - s.fishZ <= s.driftFar + 3,
          `drift must stay in its own band: ${(d.z - s.fishZ).toFixed(1)} m ahead, band ends at ${s.driftFar}`);
        for (const disc of s.discs) {
          assert.ok(Math.abs(disc.x - d.x) > 0.5 || Math.abs(disc.z - d.z) > 0.5,
            `an obstacle disc at (${disc.x}, ${disc.z}) coincides with drift at (${d.x.toFixed(1)}, ${d.z.toFixed(1)}) — drift must not be collidable`);
        }
      }
      prevY = s.stacks[0].y;
      await advanceFrames(page, 1);
    }

    assert.ok(yMoved, 'stacks must ride the swell — their y has to move with the field, not sit on a flat plane');

    // (4) RECYCLE: hop the fish a full band forward, which must re-place every stack behind it.
    const before = await page.evaluate(() => window.__FFM_API.debugHorizon());
    const beforeZ = before.stacks.map((v) => +v.z.toFixed(2)).sort((a, b) => a - b);
    await page.evaluate(() => window.__FFM_API.debugTeleportFar(window.__FFM_API.state().position[2] + 640));
    await advanceFrames(page, 3);
    const after = await page.evaluate(() => {
      return { ...window.__FFM_API.debugHorizon(), fishZ: window.__FFM_API.state().position[2] };
    });

    assert.equal(after.stacks.length, after.cap, 'the pool must stay full across a recycle');
    for (const v of after.stacks) {
      assert.ok(v.z - after.fishZ >= after.minZ - 1,
        `after a recycle a stack stood ${(v.z - after.fishZ).toFixed(1)} m ahead, inside the ${after.minZ} m floor`);
    }
    assert.notDeepEqual(after.stacks.map((v) => +v.z.toFixed(2)).sort((a, b) => a - b), beforeZ,
      'a recycle must place a fresh window — an identical set means the layer is not recycling');
    void zBefore;

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});

// Review Focus 1: the load-failure path the spec's §7 promises (degrade to drift + haze, never
// throw, never black). Asserted by ABORTING the rock requests, which is the only way to reach the
// path with real code.
//
// Note this file's console-clean rule is deliberately relaxed HERE and only here: an aborted
// request makes Chrome log a failed-resource error, so the meaningful assertion is that no
// UNCAUGHT error (pageerror) was thrown by the degraded path.
test('t23: a failed rock load degrades to drift and haze, and never throws', async () => {
  const server = await startServer();
  const pageErrors = [];
  const { browser, page } = await openPage('?seed=1337', async (p) => {
    p.on('pageerror', (e) => pageErrors.push(String(e)));
    await p.route('**/assets/models/rocks/**', (r) => r.abort());
  });
  try {
    await page.evaluate(() => window.__FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => window.__FFM_API.debugObstacleCount() > 0, null, { timeout: 60000 });
    await advanceFrames(page, 6);

    const h = await page.evaluate(() => window.__FFM_API.debugHorizon());
    assert.equal(h.templates, 0, 'aborted rock requests must leave no rock templates');
    assert.equal(h.ready, false, 'with no template the layer must report itself not ready');
    assert.equal(h.stacks.length, 0, 'no template means no stacks');
    assert.equal(h.drift.length, h.driftCap,
      'drift must still render: it needs no rock template, which is what makes the degradation real');
    const vis = await page.evaluate(() => window.__FFM_API.debugVisibility());
    assert.equal(vis.horizon, true, 'the layer stays in the scene even when degraded');
    assert.equal(pageErrors.length, 0, `the degraded path must not throw: ${pageErrors.join(' | ')}`);

    // and the game is still alive and rendering after all that
    await advanceFrames(page, 3);
    const frames = await page.evaluate(() => window.__FFM.frames);
    assert.ok(frames > 0, 'the loop must still be running after a failed rock load');
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});
