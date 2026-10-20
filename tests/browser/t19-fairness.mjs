// t19 — obstacle fairness in the running game (2026-10-18 spec §4):
// live row windows at multiple speeds, steering-driven zero-crash passes at
// 25 and 70 u/s, the honest side-pass regression (grazing just outside a
// hull capsule misses; the old 4-6.5 m spheres would have hit), and the
// gate-clearance ruling: every spawned ring must not overlap/enclose a hull.
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
      // Pick the side that stays INSIDE the lane. The lateral setter clamps to
      // WORLD.laneHalfWidth, so aiming beyond the edge silently pulls the fish back toward the
      // hull it is supposed to miss — with a hull near the lane edge the probe was destroying
      // its own clearance (observed: target x -13.15, offset wanted -15.45, clamped to -14,
      // leaving 0.85 m against a 1.94 m capsule). Prefer the side nearer the lane centre.
      const off = target.radius + 1.45;
      const sides = [target.x + off, target.x - off]
        .filter(v => Math.abs(v) <= 14)
        .sort((a, b) => Math.abs(a) - Math.abs(b));
      const held = sides.length ? sides[0] : target.x;
      __FFM_API.debugHoldLateral(held);
      const stats = () => __FFM_API.debugAudioStats().calls;
      const before = (stats().collision ?? 0);
      const startX = __FFM_API.state().position[0];
      // pass ONLY the target hull: once the fish is past its capsule tail the
      // geometry claim is proven. Later rows sit ≥22 m off and are unrelated
      // to this regression (their own lanes can legitimately hold hulls).
      const targetTail = target.z + (target.rz ?? target.radius) + 3;
      const deadline = performance.now() + 8000;
      while (__FFM_API.state().position[2] < targetTail && performance.now() < deadline) {
        await new Promise(r => setTimeout(r, 80));
      }
      const endX = __FFM_API.state().position[0];
      return {
        collided: (stats().collision ?? 0) > before,
        crossed: __FFM_API.state().position[2] >= targetTail,
        target: { x: +target.x.toFixed(2), z: +target.z.toFixed(2), r: +target.radius.toFixed(2) },
        held: +held.toFixed(2),
        drift: +(endX - startX).toFixed(2),
        offset: 0,
      };
    });
    assert.equal(sidePass.collided, false,
      `side pass outside the hull capsule must miss (target ${JSON.stringify(sidePass.target)}, held x ${sidePass.held}, drift ${sidePass.drift}, crossed ${sidePass.crossed})`);
    assert.equal(sidePass.crossed, true, 'the fish crossed the hull plane during the probe');

    // ---- 4: gate-clearance ruling in the live game (2026-10-18 ruling) ----
    // Every spawned ring must not overlap/enclose a hull: for each observed
    // spawn, no obstacle disc may sit within (rz + mouth) of the gate plane AND
    // within (rx + mouth) of the gate center. Servo keeps the fish alive; the
    // sample is per-spawn (post-placement), so restart segments are composable.
    await page.evaluate(() => __FFM_API.debugRestart());
    await page.waitForFunction(() => __FFM_API.debugObstacleCount() > 0, null, { timeout: 8000 });
    const gateRuling = await page.evaluate(async ({ segBudgetS, segments, speed, capSpeed }) => {
      const sampled = [];
      const violations = [];
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
        return best;
      };
      const ctx = { rtLast: null, dtSim: 0.017, targetX: 0, committedZ: -99, committedTail: 9 };
      const steer = (want, cap) => {
        const st0 = __FFM_API.state();
        if (ctx.rtLast != null && st0.runTime > ctx.rtLast) {
          ctx.dtSim = Math.max(0.008, Math.min(0.08, st0.runTime - ctx.rtLast));
        }
        ctx.rtLast = st0.runTime;
        const x = st0.position[0];
        const step = Math.max(-cap * ctx.dtSim, Math.min(cap * ctx.dtSim, (want - x) * 0.5));
        __FFM_API.debugSetLateral(Math.max(-14, Math.min(14, x + step)));
      };
      // Audit-ready payload (2026-10-18 t19 layout-lottery failure): per
      // violation, capture the run seed, the full +-30 disc inventory, and an
      // in-page legality scan mirroring spec §7 exactly (search space = the
      // ideal plane + forward dz 4..20, x grid +-laneHalfWidth; legal means a
      // mouth+margin edge gap to every disc whose (rz ?? radius) + mouth band
      // touches that plane). legalCount > 0 => the resolver missed a legal
      // candidate (production bug); legalCount 0 => the sanctioned
      // saturating-water fallback fired (clearest-x at the ideal plane).
      const { resolveGatePlacement } = await import('/js/timing.js');
      const { WORLD, GATE } = await import('/js/config.js');
      const MIN_CLEAR = GATE.mouthRadius + GATE.clearanceMargin;
      const fmt = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : String(v));
      const legalityScan = (g, discs) => {
        const near = (z) => discs.filter(d => Math.abs(d.z - z) <= (d.rz ?? d.radius) + GATE.mouthRadius);
        const clear = (z, x) => {
          let c = Infinity;
          for (const d of near(z)) c = Math.min(c, Math.abs(x - d.x) - (d.rx ?? d.radius));
          return c;
        };
        const xGrid = [];
        for (let x = -WORLD.laneHalfWidth; x <= WORLD.laneHalfWidth + 1e-9; x += 0.5) xGrid.push(x);
        const legal = [];
        let best = { c: -Infinity };
        for (let dz = 0; dz <= GATE.zShiftMax; dz += 4) {
          const z = g.z + dz;
          for (const x of [...xGrid, g.x]) {
            const c = clear(z, x);
            if (c > best.c) best = { c: fmt(c), z: Math.round(z * 100) / 100, x: Math.round(x * 100) / 100 };
            if (c >= MIN_CLEAR) legal.push({ z: Math.round(z * 100) / 100, x: Math.round(x * 100) / 100, c: fmt(c) });
          }
        }
        let echo = null;
        try { const p = resolveGatePlacement(g.x, g.z, discs); echo = { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }; }
        catch (e) { echo = 'ERR ' + String(e); }
        return { minClear: MIN_CLEAR, legalCount: legal.length, legalSample: legal.slice(0, 5), best, echo };
      };
      const sampleGate = (g) => {
        const discs = __FFM_API.debugObstaclesNear(g.z, 30);
        for (const d of discs) {
          // the ruling band itself (rz + mouth), float eps only: production
          // guarantees the bar within it — discs beyond it are past the hull
          // tip by design and physically clear. An earlier +0.25 fudge
          // over-flagged just-out-of-band neighbours (delta-z 4.13-4.27 vs
          // band 4.06, 3+ m past 1 m hulls) as false overlaps.
          const inBand = Math.abs(d.z - g.z) <= (d.rz ?? d.radius) + 3.0 + 1e-6;
          const lat = Math.abs(d.x - g.x) - (d.rx ?? d.radius);
          if (inBand && lat < 3.8 - 1e-6) {
            const entry = {
              seed: runSeed,
              gate: { id: g.id, x: +g.x.toFixed(2), z: +g.z.toFixed(2), y: +g.y.toFixed(2) },
              disc: { x: +d.x.toFixed(2), z: +d.z.toFixed(2), rx: +(d.rx ?? d.radius).toFixed(2), rz: +(d.rz ?? d.radius).toFixed(2), kind: d.kind, moving: !!d.moving },
              lat: +lat.toFixed(2),
              scan: legalityScan(g, discs),
              near: discs
                .map(k => ({ x: +k.x.toFixed(2), z: +k.z.toFixed(2), rx: +(k.rx ?? k.radius).toFixed(2), rz: +(k.rz ?? k.radius).toFixed(2), kind: k.kind, moving: !!k.moving }))
                .sort((a, b) => a.z - b.z),
            };
            violations.push(entry);
            console.log('GATE-SPAWN-VIOLATION ' + JSON.stringify(entry));
          }
        }
        sampled.push(g.id);
      };
      let runSeed = null;
      for (let seg = 0; seg < segments && sampled.length < 30; seg++) {
        __FFM_API.debugRestart();
        await new Promise(r => setTimeout(r, 400));
        runSeed = __FFM_API.seed();
        __FFM_API.setGauge(75); // tier high: hull-dense rows, gates spawn into capsules
        const cap = capSpeed;   // settle cap mirroring phase 2's high-tier servo
        __FFM_API.debugSetSpeed(speed);
        const stats = () => __FFM_API.debugAudioStats().calls;
        const t0 = stats().collision ?? 0;
        const rt0 = __FFM_API.state().runTime;
        ctx.rtLast = null; ctx.committedZ = -99; ctx.committedTail = 9;
        let lastGateId = null;
        while (__FFM_API.state().runTime - rt0 < segBudgetS && (stats().collision ?? 0) === t0) {
          __FFM_API.setGauge(75);
          const st = __FFM_API.state();
          const fz = st.position[2];
          const all = __FFM_API.debugObstaclesNear(fz + 45, 45);
          if (fz > ctx.committedZ + ctx.committedTail) {
            const rowsAhead = groupRows(all.filter(d => d.z > fz - 1));
            if (!rowsAhead.length) { ctx.committedZ = fz + 70; ctx.committedTail = 9; ctx.targetX = 0; }
            else {
              ctx.committedZ = rowsAhead[0].anchor;
              ctx.committedTail = Math.max(...rowsAhead[0].members.map(d => d.rz ?? d.radius)) + 1.2;
              const span = widestSpan(rowsAhead[0].members);
              ctx.targetX = span ? (span[0] + span[1]) / 2 : 0;
            }
          }
          steer(ctx.targetX, cap);
          const g = __FFM_API.gate();
          if (g && g.id !== lastGateId) { lastGateId = g.id; sampleGate(g); }
          await new Promise(r => setTimeout(r, 60));
        }
      }
      return { sampledCount: sampled.length, sampledUnique: new Set(sampled).size, violations };
    }, { segBudgetS: 45, segments: 3, speed: 70, capSpeed: 99 });
    assert.ok(gateRuling.sampledCount >= 25,
      `gate spawns observed (${gateRuling.sampledCount}, unique ${gateRuling.sampledUnique}) — sampling too thin`);
    assert.equal(gateRuling.violations.length, 0,
      `gate spawn overlaps: ${JSON.stringify(gateRuling.violations.slice(0, 6))}`);

    assert.deepEqual(consoleErrors, [], `console errors: ${JSON.stringify(consoleErrors)}`);
  } finally {
    await closePage(browser);
    stopServer(server);
  }
});
