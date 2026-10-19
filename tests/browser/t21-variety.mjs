// t21 — layout variety (2026-10-18 spec §8 per-run seed + §9 formation library):
// phase A proves two fresh runs compose DIFFERENT obstacle layouts (the old
// world.js literal seed 1337 replayed the same layout every run), with a
// ?seed= pin proving the equality control; phase B (added with the formation
// library) proves live formation variety at depth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, openPage, closePage } from './harness.mjs';

async function captureSignature(page) {
  await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 8000 });
  return page.evaluate(() => {
    const list = __FFM_API.debugObstaclesNear(0, 90);
    return JSON.stringify(list
      .map(o => `${o.kind}|${o.variant ?? ''}|${Math.round(o.x * 2)}|${Math.round(o.z * 2)}`)
      .sort());
  });
}

test('t21: layout variety — fresh runs differ, ?seed pin holds', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage();
  try {
    await page.evaluate(() => __FFM_API.start({ tutorial: false }));

    // ---- phase A1: two fresh runs compose different layouts ----
    const first = await captureSignature(page);
    await page.evaluate(() => __FFM_API.debugRestart());
    const second = await captureSignature(page);
    assert.notEqual(second, first, `layout replays across restarts: ${second.slice(0, 160)}`);

    // ---- phase A2 (pin control): ?seed=777 makes both runs EQUAL ----
    const pinned = await openPage('?seed=777');
    try {
      await pinned.page.evaluate(() => __FFM_API.start({ tutorial: false }));
      const a = await captureSignature(pinned.page);
      await pinned.page.evaluate(() => __FFM_API.debugRestart());
      const b = await captureSignature(pinned.page);
      assert.equal(b, a, `?seed=777 pin must reproduce the layout: ${b === a}`);
    } finally {
      await closePage(pinned.browser);
    }

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});

test('t21: formation variety — gated formations appear live at depth', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=4242');
  try {
    await page.evaluate(() => __FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 20000 });

    // difficulty ramps on distance/time, NOT on z, so moving the fish alone cannot
    // reach d ≥ 0.8: move the ramp, then hop far enough that the WHOLE sampled band
    // is composed AFTER the hop. Chunks already exist out to oldZ + chunksAhead×120
    // (= oldZ + 360), so a shorter hop samples still-low-difficulty water and the
    // "≥4 at depth" claim reads stronger than it is (review I2).
    const target = await page.evaluate(() => {
      __FFM_API.debugSetDistance(4500); // state.difficulty = min(1, 4500/5000) = 0.9
      const z = __FFM_API.state().position[2];
      __FFM_API.debugTeleportFar(z + 520);
      return __FFM_API.state().position[2];
    });

    // Sampled band = [target−50, target+350]: entirely past the pre-hop horizon
    // (oldZ + 360) and inside the post-hop compose window (target + 360). A frame
    // must run before the fresh span exists (poll, never sleep).
    await page.waitForFunction(
      (z) => __FFM_API.debugObstaclesNear(z + 150, 200).length > 3,
      target,
      { timeout: 90000 },
    );

    const sample = await page.evaluate((z) => ({
      difficulty: __FFM_API.state().difficulty,
      valid: __FFM_API.debugChunksValid(),
      discs: __FFM_API.debugObstaclesNear(z + 150, 200).map(d => ({ z: d.z, form: d.form ?? null, formPick: d.formPick ?? null })),
    }), target);

    assert.ok(sample.difficulty >= 0.8, `sampled difficulty ${sample.difficulty} must be ≥ 0.8`);
    assert.ok(sample.discs.length > 0, 'the deep span has obstacles');

    // group discs into rows: members sit within ±2 m of their row anchor and rows
    // are ≥22 m apart, so an 8 m z-gap separates rows without ambiguity
    const sorted = [...sample.discs].sort((a, b) => a.z - b.z);
    const rows = [];
    for (const d of sorted) {
      const last = rows[rows.length - 1];
      if (!last || d.z - last.maxZ > 8) rows.push({ maxZ: d.z, forms: new Set(), picks: new Set() });
      else last.maxZ = Math.max(last.maxZ, d.z);
      const r = rows[rows.length - 1];
      r.forms.add(d.form);
      r.picks.add(d.formPick);
    }
    for (const r of rows) {
      assert.equal(r.forms.size, 1, `a row carries exactly one formation id, saw ${[...r.forms].join(',')}`);
      assert.equal(r.picks.size, 1, `a row comes from exactly one pick, saw ${[...r.picks].join(',')}`);
    }
    const seen = rows.map(r => ({ id: [...r.forms][0], pick: [...r.picks][0] }));
    const distinct = new Set(seen.map(r => r.id).filter(Boolean));
    assert.ok(distinct.size >= 4,
      `≥4 distinct formations at depth, saw ${distinct.size}: ${[...distinct].join(',')}`);
    // depth proven directly: the gated ids are unlocked only at d ≥ 0.35
    const GATED = ['wideGate', 'offsetTurn', 'fork', 'chicane', 'riskLane'];
    assert.ok(seen.some(r => GATED.includes(r.id)),
      `a gated formation must appear at depth, saw only: ${[...distinct].join(',')}`);

    // No-repeat across adjacent PICKS, never adjacent rows: a breather consumes a
    // pick and emits no row, so `X → breather → X` is guard-legal yet yields two
    // adjacent rows with the same single-window id (measured: 7 such spans across
    // 60 seeds at compose speed 25 — the row metric is unsound; review I1).
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1], b = seen[i];
      if (!a.id || !b.id) continue;
      if (b.pick === a.pick) {
        assert.equal(b.id, a.id, `pick ${b.pick} changed formation mid-window`);
      } else if (b.pick === a.pick + 1) {
        assert.notEqual(b.id, a.id, `${b.id} repeats immediately into itself`);
      }
    }

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});
