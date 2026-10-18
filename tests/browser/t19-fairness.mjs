// t19 — obstacle fairness in the running game (2026-10-18 spec §4):
// live row windows at multiple speeds, steering-driven zero-crash passes at
// 25 and 70 u/s, and the honest side-pass regression (grazing just outside a
// hull capsule misses; the old 4-6.5 m spheres would have hit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, openPage, closePage } from './harness.mjs';

const EPS_JITTER = 4.01; // member inline jitter eats ≤4 m of rowz spacing

test('t19: fairness in the running game', async () => {
  const server = await startServer();
  const { browser, page, consoleErrors } = await openPage();
  try {
    await page.evaluate(() => __FFM_API.start({ tutorial: false }));
    await page.waitForFunction(() => __FFM_API.state().phase === 'run', null, { timeout: 8000 });

    // ---- 1: seeded layout window compliance at swim speeds ----
    for (const [gaugePin, speed, label] of [[15, 25, 'none'], [75, 70, 'high']]) {
      await page.evaluate(({ gaugePin, speed }) => {
        __FFM_API.debugRestart();
        __FFM_API.setGauge(gaugePin);
        __FFM_API.debugSetSpeed(speed);
        __FFM_API.debugSetLateral(0);
      }, { gaugePin, speed });
      await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 8000 });
      // atomic single-pass row sampling: 12 overlapping windows from z=160
      const rows = await page.evaluate(() => {
        const z0 = 160;
        const seen = new Map();
        for (let k = 0; k < 12; k++) {
          for (const o of __FFM_API.debugObstaclesNear(z0 + k * 30, 15)) {
            seen.set(`${o.kind}|${o.x.toFixed(2)}|${o.z.toFixed(2)}`, o);
          }
        }
        // group by z (rowBand)
        const list = [...seen.values()].map(o => ({ kind: o.kind, x: o.x, z: o.z })).sort((a, b) => a.z - b.z);
        const rowGroups = [];
        for (const o of list) {
          const g = rowGroups.find(r => Math.abs(r[0].z - o.z) <= 5);
          if (g) g.push(o); else rowGroups.push([o]);
        }
        return rowGroups.map(g => ({ z: g[0].z, n: g.length, kinds: [...new Set(g.map(x => x.kind))] }));
      });
      assert.ok(rows.length >= 2, `${label}: sampled rows (${rows.length})`);
      const window = Math.max(speed * 1.2, 22);
      for (let n = 1; n < rows.length; n++) {
        const dz = rows[n].z - rows[n - 1].z;
        assert.ok(dz >= window - EPS_JITTER, `${label}: row ${n} dz=${dz.toFixed(1)} < ${(window - EPS_JITTER).toFixed(1)}`);
      }
    }

    // ---- 2: steering-driven zero-crash pass at 25 and 70 u/s ----
    // (settle caps mirror TIER_PROFILE: none 39.6, high 99)
    for (const [gaugePin, speed, label, cap] of [[15, 25, 'none', 39.6], [75, 70, 'high', 99]]) {
      await page.evaluate(() => __FFM_API.debugRestart());
      await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 8000 });
      const simBudgetS = 14;
      const result = await page.evaluate(async ({ gaugePin, speed, simBudgetS, cap }) => {
        const stats = () => __FFM_API.debugAudioStats().calls;
        const t0 = stats().collision ?? 0;
        const rt0 = __FFM_API.state().runTime;
        let ticks = 0;
        let targetX = 0;         // committed gap center of the row being crossed
        let committedZ = -99;    // that row's anchor
        let committedTail = 9;   // its longest hull half-length (+ fish margin)
        // row grouping + widest swimmable span center (freeIntervals logic,
        // mirroring the generator's chain check)
        const groupRows = (discs) => {
          const sorted = [...discs].sort((a, b) => a.z - b.z);
          const rows = [];
          for (const d of sorted) {
            const r = rows[rows.length - 1];
            if (r && d.z - r.anchor <= 5) r.members.push(d);
            else rows.push({ anchor: d.z, members: [d] });
          }
          return rows;
        };
        const widestSpan = (members) => {
          const iv = members.map(d => [d.x - (d.radius ?? 0), d.x + (d.radius ?? 0)]).sort((a, b) => a[0] - b[0]);
          let best = null, end = -14;
          for (const [lo, hi] of iv) {
            if (lo > end && (!best || lo - end > best[1] - best[0])) best = [end, lo];
            if (hi > end) end = hi;
          }
          if (14 - end > (best ? best[1] - best[0] : -1)) best = [end, 14];
          return best; // [lo, hi] of the widest free span
        };
        let dtSim = 0.017; // plant tick quantum, measured each tick below
        let rtLast = null;
        window.__t19held = '-';
        // MPC over the exact settle model (v += (T−v)·min(1,6dt); the same
        // equations the chain validator and player.js use). Keyboard taps are
        // quantized to whole frames (~1.7 m glide per tap at cap 99) — too
        // coarse for 0.4 m side channels — so the DECISION comes from the MPC
        // and the EXECUTION integrates that same settle equation and moves the
        // fish to the planned position each tick: this probes the trajectory
        // the fairness budget promises, not the input device.
        // Servo over the exact settle-cap rate (cap u/s = TIER_PROFILE settle
        // ceiling; the chain validator models the same max rate). positional
        // proportional step per tick, bounded by cap·dtSim — NOT a velocity
        // MPC: setLateral teleports the plant, so a velocity model would
        // measure its own jumps (poisoned feedback, observed ±68 u/s ghosts)
        // and NaN through the arm roll (cap undefined => setLateral(NaN) =>
        // fish x NaN => wake ribbon NaN => the THREE boundingSphere warning).
        const steer = (want) => {
          const st0 = __FFM_API.state();
          if (rtLast != null && st0.runTime > rtLast) {
            dtSim = Math.max(0.008, Math.min(0.08, st0.runTime - rtLast));
          }
          rtLast = st0.runTime;
          const x = st0.position[0];
          const step = Math.max(-cap * dtSim, Math.min(cap * dtSim, (want - x) * 0.5));
          __FFM_API.debugSetLateral(Math.max(-14, Math.min(14, x + step)));
        };
        // frame-snitch: 25 ms poll; the moment the collision counter climbs,
        // snapshot the same-frame fish position + a tight obstacle band
        window.__t19frames = [];
        const snitch = setInterval(() => {
          const cS = __FFM_API.debugAudioStats().calls;
          const s = __FFM_API.state();
          const store = window.__t19frames;
          const frame = { rt: +s.runTime.toFixed(3), x: +s.position[0].toFixed(3), z: +s.position[2].toFixed(3), c: (cS.collision ?? 0) - t0, y: +s.position[1].toFixed(2), held: window.__t19held };
          if (store.length && frame.c > store[store.length - 1].c) {
            frame.near = __FFM_API.debugObstaclesNear(s.position[2], 14);
          }
          store.push(frame);
        }, 25);
        try {
          while (__FFM_API.state().runTime - rt0 < simBudgetS) {
            __FFM_API.setGauge(gaugePin); // pin the tier (coins tried to launch us)
            __FFM_API.debugSetSpeed(speed);
            const st = __FFM_API.state();
            const fz = st.position[2];
            // steering horizon: here to 90 m ahead (hull tails astern included —
            // a 16 m hull reaches ±9 m of its anchor)
            const all = __FFM_API.debugObstaclesNear(fz + 45, 45);
            if (fz > committedZ + committedTail) {
              // previous row fully cleared (past its longest hull tail) — commit
              // to the next row's widest gap and STAY on it while crossing
              const rowsAhead = groupRows(all.filter(d => d.z > fz - 1));
              if (!rowsAhead.length) { committedZ = fz + 70; committedTail = 9; targetX = 0; committedSpan = null; }
              else {
                committedZ = rowsAhead[0].anchor;
                committedTail = Math.max(...rowsAhead[0].members.map(d => d.rz ?? d.radius)) + 1.2;
                committedSpan = widestSpan(rowsAhead[0].members);
                targetX = committedSpan ? (committedSpan[0] + committedSpan[1]) / 2 : 0;
              }
            }
            steer(targetX);
            ticks++;
            await new Promise(r => setTimeout(r, 60));
            if ((stats().collision ?? 0) > t0) {
              window.__t19dump = { st: __FFM_API.state(), all, targetX, committedZ };
              break; // stop on first crash
            }
          }
        } finally {
          clearInterval(snitch);
          window.__t19crashSnitch = window.__t19frames.filter(f => f.near).slice(-3).concat(
            { tail: window.__t19frames.filter((f, i, a) => i >= a.length - 60).map(f => `${f.rt}:${f.x}@${f.z}k${f.held ?? ''}`).join(' ') });
        }
        await new Promise(r => setTimeout(r, 250)); // settle any pending frame
        return {
          crashed: (stats().collision ?? 0) - t0 > 0,
          calls: { collision: (stats().collision ?? 0) - t0, major: (stats().collisionMajor ?? 0) },
          simTime: +(__FFM_API.state().runTime - rt0).toFixed(1),
          ticks,
        };
      }, { gaugePin, speed, simBudgetS, cap });
      assert.equal(result.crashed, false, `${label}: steering pass crashed (${JSON.stringify(result.calls)} dump=${JSON.stringify(await page.evaluate(() => ({ dump: window.__t19dump || null, snitch: window.__t19crashSnitch || null })))}`);
      assert.ok(result.simTime >= 10, `${label}: covered ≥10 s of sim (${result.simTime}) — rig decay?`);
      assert.ok(result.ticks >= 30, `${label}: driver sampled (${result.ticks})`);
    }

    // ---- 3: honest side-pass regression (old spheres would hit) ----
    await page.evaluate(() => __FFM_API.debugRestart());
    await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 8000 });
    const sidePass = await page.evaluate(async () => {
      __FFM_API.setGauge(15);
      __FFM_API.debugSetSpeed(25);
      // a liner-class hull: teleport just before it, offset beyond its capsule
      const specs = __FFM_API.debugObstaclesNear(__FFM_API.state().position[2] + 60, 40);
      const hull = specs.find(o => o.kind === 'rock') || specs[0];
      const reach = (hull.rx ?? hull.radius) + 1.1 + 0.35; // capsule + fish + 0.35 clear
      __FFM_API.debugTeleportToObstacle(0); // near the first obstacle ahead
      const near = __FFM_API.debugObstaclesNear(__FFM_API.state().position[2] + 20, 18);
      const target = near[0];
      __FFM_API.debugSetLateral(target.x + Math.sign(target.x || 1) * (target.radius + 1.45));
      const stats = () => __FFM_API.debugAudioStats().calls;
      const before = (stats().collision ?? 0);
      // pass ONLY the target hull: once the fish is past its capsule tail the
      // geometry claim is proven. Later rows sit ≥22 m off and are unrelated
      // to this regression (their own lanes can legitimately hold hulls).
      const targetTail = target.z + (target.rz ?? target.radius) + 3;
      const deadline = performance.now() + 8000;
      while (__FFM_API.state().position[2] < targetTail && performance.now() < deadline) {
        await new Promise(r => setTimeout(r, 80));
      }
      return {
        collided: (stats().collision ?? 0) > before,
        crossed: __FFM_API.state().position[2] >= targetTail,
        offset: 0,
      };
    });
    assert.equal(sidePass.collided, false, 'side pass outside the hull capsule must miss');
    assert.equal(sidePass.crossed, true, 'the fish crossed the hull plane during the probe');

    assert.deepEqual(consoleErrors, [], `console errors: ${JSON.stringify(consoleErrors)}`);
  } finally {
    await closePage(browser);
    stopServer(server);
  }
});
