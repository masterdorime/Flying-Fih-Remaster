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

// Formation ids that legitimately span TWO consecutive rows (config
// FORMATIONS.roster[*].windows === 2). A repeat of any OTHER id across adjacent
// rows is a no-repeat-guard violation.
const MULTI_WINDOW = new Set(['offsetTurn', 'fork', 'chicane']);

test('t21: formation variety — gated formations appear live at depth', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage('?seed=4242');
  try {
    await page.evaluate(() => __FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 20000 });

    // difficulty ramps on distance/time, NOT on z, so moving the fish alone
    // cannot reach d ≥ 0.8: move the ramp, then hop deep so fresh chunks are
    // composed at that difficulty (the t15 debugTeleportFar router precedent).
    const target = await page.evaluate(() => {
      __FFM_API.debugSetDistance(4500); // state.difficulty = min(1, 4500/5000) = 0.9
      const z = __FFM_API.state().position[2];
      __FFM_API.debugTeleportFar(z + 200);
      return __FFM_API.state().position[2];
    });

    // a frame must run before the fresh span is composed (poll, never sleep)
    await page.waitForFunction(
      (z) => __FFM_API.debugObstaclesNear(z + 160, 200).length > 0,
      target,
      { timeout: 90000 },
    );

    const sample = await page.evaluate((z) => ({
      difficulty: __FFM_API.state().difficulty,
      valid: __FFM_API.debugChunksValid(),
      discs: __FFM_API.debugObstaclesNear(z + 160, 200).map(d => ({ z: d.z, form: d.form ?? null })),
    }), target);

    assert.ok(sample.difficulty >= 0.8, `sampled difficulty ${sample.difficulty} must be ≥ 0.8`);
    assert.ok(sample.discs.length > 0, 'the deep span has obstacles');

    // group discs into rows: members sit within ±2 m of their row anchor and rows
    // are ≥22 m apart, so an 8 m z-gap separates rows without ambiguity
    const sorted = [...sample.discs].sort((a, b) => a.z - b.z);
    const rows = [];
    for (const d of sorted) {
      const last = rows[rows.length - 1];
      if (!last || d.z - last.maxZ > 8) rows.push({ maxZ: d.z, forms: new Set() });
      else last.maxZ = Math.max(last.maxZ, d.z);
      rows[rows.length - 1].forms.add(d.form);
    }
    for (const r of rows) {
      assert.equal(r.forms.size, 1, `a row carries exactly one formation id, saw ${[...r.forms].join(',')}`);
    }
    const ids = rows.map(r => [...r.forms][0]);
    const distinct = new Set(ids.filter(Boolean));
    assert.ok(distinct.size >= 4,
      `≥4 distinct formations at depth, saw ${distinct.size}: ${[...distinct].join(',')}`);

    // no-repeat across adjacent rows, allowing only a declared 2-window span
    for (let i = 1; i < ids.length; i++) {
      if (!ids[i] || ids[i] !== ids[i - 1]) continue;
      assert.ok(MULTI_WINDOW.has(ids[i]),
        `${ids[i]} repeats across adjacent rows but declares a single window`);
    }

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  } finally {
    await closePage(browser);
    await stopServer(server);
  }
});
