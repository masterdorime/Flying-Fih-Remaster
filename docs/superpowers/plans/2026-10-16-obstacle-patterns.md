# Obstacle Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace random obstacle scatter with validated freeform pattern rows (slalom, wall-with-gap, center block, clusters) so the center is sometimes occupied but every chunk keeps a ≥3 m swimmable gap per row, and nudge gates out of obstacle footprints at spawn.

**Architecture:** Pure layout stays in `js/worldgen.js` (pattern composers + `validateChunkGaps` + re-roll/fallback; `generateChunk` gains a `speed` parameter for speed-scaled row spacing); pure gate math `resolveGateOverlap` joins the QTE functions in `js/timing.js`; `js/world.js` renders from specs, exposes a live `obstaclesNear` query, and drops the corridor clamp; `js/game.js` passes speed and nudges each gate at spawn. Collision, gauge/chain/scoring, coins, flight, HUD/audio, tutorial: untouched.

**Tech Stack:** vanilla ES modules, Three.js r170 (vendored, no build), node:test unit suite, Playwright browser suite driving `window.__FFM_API`.

**Spec:** `docs/superpowers/specs/2026-10-16-obstacle-patterns-design.md`

## Global Constraints

- Gap rule: `PATTERN.minGap = 3.0` per row (2 × PLAYER_RADIUS 1.1 + 0.8 margin); validator groups rows with `PATTERN.rowBand = 5`.
- Rows: `rows = min(round(lerp(2, 7, d)), 1 + floor(95 / spacing))`, `spacing = clamp(speed × 0.35, 18, 40)`; rows at chunk-local `z = 20 + i × spacing + rng × 6`, capped at 115; intra-row z spread ≤ 4.
- Catalog (all four from the start, uniform pick): slalom (1 obstacle, alternating ±(5–10) via threaded `prevSlalomSign`), wall (gap center ∈ [−11, 11], width ∈ [3.2, 5.0], fill from ±14 cycling the kind list from an rng start index, `wallMax` 6), center block (1–2 obstacles, |x| ≤ 4), cluster (2–3 in an 8 m clump, z jitter ±2). Every spec records its `pattern` id.
- Kinds/radii/grounding (`kindsFor`, rock 2.6 / buoy 1.1 / boat 3.4 / container 2.2, buoy y 1.2 else 0.7) and mover probability/formulas (`lerp(0, 0.55, d)`) unchanged; a mover is flagged only if both sweep extremes preserve the row gap (no extra rng draws on the static path).
- Re-roll: up to 8 attempts (`seed + attempt`), then fallback single static rock at x = +10.
- Gate nudge: `GATE.nudgeMargin = 1.6`, query window `GATE.nudgeHalfRange = 6`, overlap test `|dz| ≤ 5`; push to nearest clear side, clamp ±14, single nearest-first pass (best-effort, never fails a spawn).
- TDD: every behavior change ships with a watched-RED test first. Retirements are grep-verified before commit.
- Repo flow: commits to `main` directly, message style `feat:|fix:|docs: <summary> (suite: X/X unit, Y/Y browser)`.
- Browser tests: poll with `page.waitForFunction(fn, null, {timeout})` — zero-arg predicates MUST pass `null` as the second argument; never fixed sleeps for sim assertions; generous wall budgets (software GL is slow); the harness binds :8123 itself, so stop any dev server before a run.
- Rebuild `flying-fish-momentum.zip` on ship (repo agreement §7) — after the branch review, at the very end.

## Review Focus

1. **Gate nudged into a second footprint**: the single nearest-first pass can push a gate out of one rock and into another; a reasonable person expects every gate enterable. Pinned by the Task 1 unit test `resolveGateOverlap` with two overlapping discs asserting center-clearance of the nearest and a finite in-bounds result.
2. **Two movers, one row, out of phase**: checking all-minus/all-plus extremes misses joint extremes (A at +range while B at −range); a reasonable person expects the gap open at all times, not just at the instants tested. Pinned by the Task 1 validator unit test with two out-of-phase movers in one row asserting the row passes only if the swept envelope holds the gap (validator expands each mover to its full `[base−range−r, base+range+r]` envelope — strictly stronger than the spec's both-extremes check; adopted as a controller ruling, spec §3.2 amended accordingly).
3. **Wall truncated by `wallMax`**: a 6-obstacle stop can leave the far side unfenced — a second gap. A reasonable person just sees more room (fairer, not less fair). Pinned by the Task 1 unit test asserting wall rows have *a* max gap ≥ 3.2 (not exactly one gap).
4. **Rows built slow, arrived fast**: spacing uses build-time speed; a player braking to 8 then boosting to 110 meets 18 m rows at 0.16 s intervals; a reasonable person expects consecutive gaps to stay reachable. Pinned by the existing t15 acceptance (`misses ≤ 2`) staying green in Task 3 — the scripted fairness gate.
5. **`world.update` arity change**: any caller besides `game.js:289` passing the old 4-arg shape would feed `speed = undefined` → NaN row spacing; a reasonable person expects no silent NaN layout. Pinned by the Task 2 grep-verification step (all `world.update(`/`buildChunk(` callers enumerated; only `game.js` may call them) plus the suite staying green.

---

### Task 1: Pure pattern core + validator + nudge math (unit TDD)

**Files:**
- Modify: `js/config.js` (add `PATTERN` block; add `GATE.nudgeMargin`/`nudgeHalfRange`; delete `DIFFICULTY.obstacleDensityStart/End`)
- Modify: `js/worldgen.js` (rewrite `generateChunk` as pattern composer with `(index, difficulty, seed, speed)` signature; add `validateChunkGaps`; delete `hasSafeCorridor`)
- Modify: `js/timing.js` (add `resolveGateOverlap`)
- Rewrite: `tests/unit/worldgen.test.js` (keep: determinism/difficultyAt/mulberry32/lerp/grounding/lane-bounds/kind-validity; replace: corridor test → gap tests, count test → row-budget test)
- Modify: `tests/unit/timing.test.js` (append nudge tests; existing QTE tests untouched)

**Interfaces:**
- Consumes: nothing (foundation task). Reads `WORLD`/`DIFFICULTY`/`PATTERN`/`GATE` from config, `RADII` local.
- Produces: `generateChunk(index, difficulty, seed, speed) -> { index, difficulty, obstacles: [{ kind, x, y, z, radius, moving, phase, speed, range, pattern }] }` (chunk-local z); `validateChunkGaps(chunk) -> boolean` (movers expanded to swept envelopes); `resolveGateOverlap(gateX, gateZ, discs) -> number` (discs: `[{ x, z, radius }]`); config `PATTERN { minGap: 3.0, rowBand: 5, spacingSeconds: 0.35, spacingMin: 18, spacingMax: 40, rowZ0: 20, rowZ1: 115, wallMax: 6, maxAttempts: 8 }`, `GATE.nudgeMargin: 1.6`, `GATE.nudgeHalfRange: 6`.

- [ ] **Step 1: Rewrite the unit tests (RED)**

In `tests/unit/worldgen.test.js`: keep the `difficultyAt` / determinism-structure / grounding / `mulberry32` / `lerp` / lane-bounds / kind tests, updating `generateChunk` calls to the 4-arg form `(i, d, seed, speed)`. Replace the `hasSafeCorridor` test and the obstacle-count test with:

```js
import { generateChunk, validateChunkGaps, difficultyAt, mulberry32, lerp } from '../../js/worldgen.js';
import { WORLD, PATTERN } from '../../js/config.js';

test('validator: blocked row fails, gapped rows pass, exact boundary holds', () => {
  const at = (x, r) => ({ x, radius: r, z: 50, moving: false });
  assert.equal(validateChunkGaps({ obstacles: [
    at(-10.5, 3.5), at(-3.5, 3.5), at(3.5, 3.5), at(10.5, 3.5),
  ] }), false); // fully fenced: every gap is 0
  assert.equal(validateChunkGaps({ obstacles: [
    at(-11, 3), at(-5, 3), at(5, 3), at(11, 3),
  ] }), true); // 4 m center gap
  assert.equal(validateChunkGaps({ obstacles: [at(-8, 6), at(7, 6)] }), true); // max gap exactly 3.0
  assert.equal(validateChunkGaps({ obstacles: [at(-8, 6), at(6.9, 6)] }), false); // max gap 2.9
});

test('validator: movers are judged by their swept envelope', () => {
  const stat = (x, r) => ({ x, radius: r, z: 50, moving: false });
  const mov = (x, r, range) => ({ x, radius: r, z: 50, moving: true, range });
  assert.equal(validateChunkGaps({ obstacles: [stat(-12, 2), mov(0, 2, 4), stat(12, 2)] }), true);
  assert.equal(validateChunkGaps({ obstacles: [stat(-12, 2), mov(0, 2, 6), stat(12, 2)] }), false);
  // two out-of-phase movers: envelopes [-6.5,-1.5] and [1.5,6.5] hold 3 m gaps
  assert.equal(validateChunkGaps({ obstacles: [
    stat(-12, 2.5), mov(-4, 2, 0.5), mov(4, 2, 0.5), stat(12, 2.5),
  ] }), true);
  // …but widen the sweep and the envelope closes the row
  assert.equal(validateChunkGaps({ obstacles: [
    stat(-12, 2.5), mov(-4, 2, 2), mov(4, 2, 2), stat(12, 2.5),
  ] }), false);
});

test('every generated chunk is valid, at every difficulty and speed', () => {
  for (const speed of [8, 25, 110]) {
    for (let d = 0; d <= 1.0001; d += 0.1) {
      for (let i = 0; i < 40; i++) {
        const c = generateChunk(i, d, 7, speed);
        assert.ok(validateChunkGaps(c), `chunk ${i} d=${d.toFixed(1)} speed=${speed} invalid`);
      }
    }
  }
});

test('patterns: walls hold a swimmable gap, slaloms alternate, center gets occupied', () => {
  const seen = new Set();
  let totalSlalom = 0, centerSeen = false;
  for (let i = 0; i < 30; i++) {
    const signs = [];
    for (const o of generateChunk(i, 0.5, 1337, 25).obstacles) {
      seen.add(o.pattern);
      if (o.pattern === 'slalom') signs.push(Math.sign(o.x));
      if (Math.abs(o.x) + o.radius < 5) centerSeen = true;
    }
    assert.ok(signs.every((s, k) => k === 0 || s !== signs[k - 1]), `slalom rows alternate in chunk ${i}`);
    totalSlalom += signs.length;
  }
  assert.ok(seen.size >= 2, `at least two pattern shapes appear (${[...seen]})`);
  assert.ok(totalSlalom >= 2, 'slalom rows occurred');
  assert.ok(centerSeen, 'the old corridor gets occupied');
  // every wall row keeps a swimmable gap (a wallMax-truncated wall may show a
  // second gap — fairer, not a failure — so this asserts max gap, not exactly one)
  for (let i = 0; i < 60; i++) {
    const walls = generateChunk(i, 0.8, 21, 40).obstacles.filter(o => o.pattern === 'wall');
    const rows = [];
    for (const o of [...walls].sort((a, b) => a.z - b.z)) {
      const row = rows.find(r => Math.abs(r[0].z - o.z) <= 5);
      (row ?? rows[rows.push([]) - 1]).push(o);
    }
    for (const row of rows) {
      const iv = row.map(o => [o.x - o.radius, o.x + o.radius]).sort((a, b) => a[0] - b[0]);
      let maxGap = Math.max(0, iv[0][0] + 14);
      for (let k = 1; k < iv.length; k++) maxGap = Math.max(maxGap, iv[k][0] - iv[k - 1][1]);
      maxGap = Math.max(maxGap, 14 - iv[iv.length - 1][1]);
      assert.ok(maxGap >= 3.2, `wall row keeps a swimmable gap (${maxGap.toFixed(2)})`);
    }
  }
});

test('row budget scales with difficulty, capped by speed-spaced fit', () => {
  const rowsOf = (c) => {
    const zs = [...c.obstacles].sort((a, b) => a.z - b.z).map(o => o.z);
    let n = 0, last = -1e9;
    for (const z of zs) { if (z - last > 5) { n++; last = z; } }
    return n;
  };
  assert.equal(rowsOf(generateChunk(1, 0, 5, 25)), 2);   // min(round(lerp(2,7,0)), fit) = 2
  assert.equal(rowsOf(generateChunk(1, 1, 5, 25)), 6);   // 7 capped by fit at spacing 18
  assert.equal(rowsOf(generateChunk(1, 1, 5, 110)), 3);  // 1 + floor(95 / 38.5)
  const slow = generateChunk(2, 0.5, 9, 8).obstacles.map(o => o.z.toFixed(2)).join();
  const fast = generateChunk(2, 0.5, 9, 110).obstacles.map(o => o.z.toFixed(2)).join();
  assert.notEqual(slow, fast); // spacing follows speed at fixed seed
});

In `tests/unit/timing.test.js`, append (existing imports extended with `resolveGateOverlap`):

```js
test('resolveGateOverlap: inside footprint pushes to nearest clear side', () => {
  const discs = [{ x: 2, z: 100, radius: 2.6 }];
  assert.equal(resolveGateOverlap(2, 100, discs), 2 + 2.6 + 1.6); // pushed +x
  assert.equal(resolveGateOverlap(-3, 100, discs), -3);            // far: unchanged
  assert.equal(resolveGateOverlap(0, 200, discs), 0);              // far in z: unchanged
  assert.equal(resolveGateOverlap(13.5, 100, [{ x: 13, z: 100, radius: 2 }]), 14); // clamped
  const two = [{ x: 1, z: 100, radius: 2 }, { x: -1, z: 100, radius: 2 }];
  const out = resolveGateOverlap(0.2, 100, two);
  assert.ok(Number.isFinite(out) && Math.abs(out) <= 14, `finite in-bounds result (${out})`);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `node --test tests/unit/worldgen.test.js tests/unit/timing.test.js`
Expected: FAIL — `generateChunk` has no 4th parameter behavior / `validateChunkGaps` and `resolveGateOverlap` are not exported / `PATTERN` undefined. (The old corridor/count tests are already replaced, so failures must be missing-function failures, not assertion drift — read the output to confirm.)

- [ ] **Step 3: Implement config in `js/config.js`**

Add after the `GATE` block:

```js
// Obstacle patterns (Phase 3): freeform rows with a validated gap — see
// js/worldgen.js. Rows scale with speed; shapes never unlock by tier.
export const PATTERN = {
  minGap: 3.0,        // minimum lateral gap per row (2 x 1.1 fish + 0.8 margin)
  rowBand: 5,         // validator z-grouping window (generator keeps intra-row spread <= 4)
  spacingSeconds: 0.35, // row spacing = clamp(speed * this, min, max)
  spacingMin: 18,     // meters between rows (slow swim)
  spacingMax: 40,     // meters between rows (max flight… swim-relevant: arrival speed)
  rowZ0: 20,          // rows placed within chunk-local z
  rowZ1: 115,
  wallMax: 6,         // max obstacles per wall row
  maxAttempts: 8,     // validation re-rolls before the fallback row
};
```

In `GATE`: add `nudgeMargin: 1.6, nudgeHalfRange: 6`. Delete `DIFFICULTY.obstacleDensityStart/End` (dead — this step's grep sweep must show zero references outside this deletion).

- [ ] **Step 4: Implement `js/worldgen.js`**

Replace the scatter body of `generateChunk` with the pattern composer per the Interfaces block (rows formula, four shapes, kind cycling from an rng start index, threaded `prevSlalomSign`, mover pre-check at both extremes with no extra rng draws on the static path, re-roll loop with `maxAttempts`, fallback rock at +10). Add `validateChunkGaps` (row grouping by `rowBand`, mover swept envelopes, sweep for max gap ≥ `minGap`). Delete `hasSafeCorridor`. Keep `mulberry32`, `lerp`, `difficultyAt`, `RADII`/`RADIUS_TABLE`, `kindsFor`, grounding rules.

- [ ] **Step 5: Implement `resolveGateOverlap` in `js/timing.js`**

```js
export function resolveGateOverlap(gateX, gateZ, discs) {
  let x = gateX;
  const near = discs
    .filter(d => Math.abs(d.z - gateZ) <= 5)
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
  for (const d of near) {
    const need = d.radius + GATE.nudgeMargin;
    const dx = x - d.x;
    if (Math.abs(dx) < need) x = d.x + (dx >= 0 ? need : -need);
  }
  return Math.min(WORLD_HALF, Math.max(-WORLD_HALF, x));
}
```

(Import what the file needs: `GATE` from `./config.js` already imported? Check — `timing.js` imports `GATE, ASSIST` (and `QTE` since Phase 2). Lane bound: use `WORLD.laneHalfWidth` — add the `WORLD` import if absent. The step names the source; the implementer wires it.)

- [ ] **Step 6: Run the unit files — GREEN**

Run: `node --test tests/unit/worldgen.test.js tests/unit/timing.test.js`
Expected: PASS, all tests in both files.

- [ ] **Step 7: Rename sweep + full unit suite**

Grep `js/` and `tests/` for `hasSafeCorridor|obstacleDensity`. Expected: zero references (fix any stragglers — none should exist outside deleted code).

Run: `npm test`
Expected: full unit suite green (record the new test count for the commit message).

- [ ] **Step 8: Commit**

```bash
git add js/config.js js/worldgen.js js/timing.js tests/unit/worldgen.test.js tests/unit/timing.test.js
git commit -m "feat: obstacle patterns — validated freeform rows + gate nudge math (suite: XX/XX unit)"
```

---

### Task 2: World wiring + retirements + t10 (browser TDD)

**Files:**
- Modify: `js/world.js` (`buildChunk` speed param; `update` speed param; `obstaclesNear`; mover clamp → lane-only; `debugCorridorClear` → `debugChunksValid`; add `debugCenterOccupied`; `clampX` corridor floor updated or helper retired if orphaned)
- Modify: `js/game.js` (`world.update` call gains `state.speed`; `trySpawnGate` nudges via `resolveGateOverlap` + `world.obstaclesNear`; `debugCorridorClear` → `debugChunksValid`; add `debugCenterOccupied` passthrough)
- Modify: `js/main.js` (`debugCorridorClear` → `debugChunksValid`; add `debugCenterOccupied` to `__FFM_API`)
- Modify: `tests/browser/t10-world.mjs` (§4 rewrite + center-occupied proof)
- Modify: `HANDOFF.md` (§9 status — stays untracked per §10)

**Interfaces:**
- Consumes: Task 1's `generateChunk(index, difficulty, seed, speed)`, `validateChunkGaps`, `resolveGateOverlap`, `PATTERN`/`GATE.nudge*` config.
- Produces: `world.obstaclesNear(z, halfRange) -> [{ x, z, radius }]` (live mesh positions); `world.debugChunksValid() -> boolean`; `world.debugCenterOccupied() -> boolean` (`|x| + radius < 5`); `game.debugChunksValid()`; `game.debugCenterOccupied()`; `__FFM_API.debugChunksValid()`; `__FFM_API.debugCenterOccupied()`.

- [ ] **Step 1: Rewrite t10 §4 + center proof (RED)**

Replace t10 section 4 with:

```js
// 4. every live chunk validates: each obstacle row keeps a swimmable gap
// (patterns replaced the always-clear corridor — validity is per-row now)
await page.waitForFunction(() => window.__FFM_API.state().distance > 200, null, { timeout: 90000 });
const chunksValid = await page.evaluate(() => window.__FFM_API.debugChunksValid());
assert(chunksValid, 'all live chunks keep a >= 3 m gap per row');
// the old corridor gets occupied: swim through patterned water, not an empty lane
const centerOccupied = await page.evaluate(async () => {
  const api = window.__FFM_API;
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 25));
    if (api.debugCenterOccupied()) return true;
  }
  return api.debugCenterOccupied();
});
assert(centerOccupied, 'an obstacle sits inside the old corridor within a minute');
```

Keep t10 sections 1–3 and 5 byte-identical.

- [ ] **Step 2: Run to verify RED**

Run: `node tests/browser/t10-world.mjs` (stop any dev server first — the harness binds :8123 itself)
Expected: FAIL — `__FFM_API.debugChunksValid is not a function`.

- [ ] **Step 3: Implement `js/world.js`**

- `buildChunk(index, difficulty, speed)` → `generateChunk(index, difficulty, 1337, speed)`.
- `update(dt, playerPos, playerRadius, difficulty, speed, onCollision)` — trailing `speed`, forwarded to `buildChunk` via `ensureChunks`.
- Mover motion: drop the corridor floor (`Math.max(limit, mag)`) → clamp to lane bounds only.
- Add `obstaclesNear(z, halfRange)`: iterate live chunks' obstacles, return `{ x: mesh.position.x, z: mesh.position.z, radius: spec.radius }` for `|z − mesh.z| ≤ halfRange`.
- Replace `debugCorridorClear` with `debugChunksValid` (every live chunk passes `validateChunkGaps` — import it) and add `debugCenterOccupied` (any live obstacle with `|mesh.x| + spec.radius < WORLD.corridorHalfWidth`).
- `clampX`: update to lane-only clamp or delete if no callers remain (grep decides).

- [ ] **Step 4: Implement `js/game.js` + `js/main.js`**

- `game.js` world-update call: append `state.speed` as the new trailing argument.
- `trySpawnGate`: after `createGate(...)`, insert `activeGate.x = resolveGateOverlap(activeGate.x, activeGate.z, world.obstaclesNear(activeGate.z, GATE.nudgeHalfRange));` with a one-line comment (gate nudged out of obstacle footprints at spawn; best-effort).
- Import `resolveGateOverlap` alongside the existing `./timing.js` imports.
- `debugCorridorClear` → `debugChunksValid` passthrough; add `debugCenterOccupied` passthrough.
- `main.js`: same two `__FFM_API` entries renamed/added.

- [ ] **Step 5: Run t10 — GREEN**

Run: `node tests/browser/t10-world.mjs`
Expected: `PASS t10-world`.

- [ ] **Step 6: Grep-verification + commit**

Grep `js/`, `tests/`, `index.html` for `debugCorridorClear|hasSafeCorridor|obstacleDensity|corridorHalfWidth` (last one must survive only where legitimately used — movers no longer, validator no longer; check each hit). Movable-feast check: `clampX` resolved one way or the other.

```bash
git add js/world.js js/game.js js/main.js tests/browser/t10-world.mjs
git commit -m "feat: pattern world wiring — speed-spaced rows, live nudge, validity hooks (suite: XX/XX unit, 15/15 browser)"
```

---

### Task 3: Full-suite verification + handoff

**Files:**
- Modify: `HANDOFF.md` (§9 Phase 3 shipped, §3–§5 updates — stays untracked per §10)

**Interfaces:**
- Consumes: Tasks 1–2 (all code landed).
- Produces: nothing tracked; the deliverable is a green suite and an accurate handoff.

- [ ] **Step 1: Full suite**

Run: `npm run test:all`
Expected: unit + browser all green (record verbatim counts). t15's `misses ≤ 2` budget is the scripted fairness gate for reachable gaps — confirm its summary explicitly. If t19/t20 hit wall-clock under load, re-run them individually.

- [ ] **Step 2: Update `HANDOFF.md`**

Mark Phase 3 shipped (§9: commits, suite counts, `validateChunkGaps`, `PATTERN` block, `resolveGateOverlap`, `generateChunk` 4-arg form, `hasSafeCorridor`/`debugCorridorClear`/`obstacleDensity` retirements); update §3 rows (`worldgen.js`, `world.js`, `timing.js` nudge), §4 numbers (`PATTERN` values, rows formula, `GATE.nudge*`), §5 tests (worldgen rewrite, t10 §4). Leave the file untracked. No commit for this task (all tracked work landed in Tasks 1–2; the zip rebuilds at ship).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-16-obstacle-patterns.md`. Please review the plan. Does it capture what you want?
