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
