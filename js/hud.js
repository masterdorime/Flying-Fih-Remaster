import { GAUGE, GAMEOVER, FLIGHT } from './config.js';

// In-run HUD (PRD §17): gauge with tier ticks, tier label, speed, distance, coins, chain.
// Also carries the ring-triggered QTE cue. The cue is a VIEW only: the clock (start, target,
// deadline) lives in js/timing.js and the tick/beat events are thrown by js/game.js, so the HUD and
// the auto-miss can never disagree about the moment.

export function createHud(root) {
  root.insertAdjacentHTML('beforeend', `
    <div id="ffm-hud" class="ffm-hud hidden">
      <div class="ffm-gauge-wrap">
        <div class="ffm-tier-label" id="ffm-tier">SWIMMING</div>
        <div class="ffm-gauge">
          <div class="ffm-gauge-fill" id="ffm-gauge-fill"></div>
          <div class="ffm-gauge-tick" style="left:${(GAUGE.lowMax / GAUGE.max) * 100}%"></div>
          <div class="ffm-gauge-tick" style="left:${(GAUGE.mediumMax / GAUGE.max) * 100}%"></div>
          <div class="ffm-gauge-tick ffm-gauge-tick-max" style="left:${(GAUGE.maxThreshold / GAUGE.max) * 100}%"></div>
        </div>
        <div id="ffm-charge-meter" class="ffm-charge hidden">
          <div class="ffm-charge-label" id="ffm-charge-label">MASH SPACE — OVERFILL THE GAUGE</div>
          <div class="ffm-charge-bar"><div class="ffm-charge-fill" id="ffm-charge-fill"></div></div>
        </div>
      </div>
      <div id="ffm-qte" class="ffm-qte hidden">
        <svg class="ffm-qte-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ffm-qte-track" cx="50" cy="50" r="44"></circle>
          <!-- THE TARGET: where the moment is, marked BEFORE anything moves (closing style). The clock
               style marks it with the gold band instead, which is also static. -->
          <circle id="ffm-qte-target" class="ffm-qte-target" cx="50" cy="50" r="44"></circle>
          <!-- CLOSING: an inner ring shrinks onto the marked target and lands on it at the moment -->
          <circle id="ffm-qte-close" class="ffm-qte-close" cx="50" cy="50" r="44"></circle>
          <!-- CLOCK: a hand TICKS around the dial; the gold band is one tick wide, so it IS the Perfect
               window, and the tick count to it is drawn per ring -->
          <circle id="ffm-qte-zone" class="ffm-qte-zone" cx="50" cy="50" r="44"></circle>
          <circle id="ffm-qte-dot" class="ffm-qte-dot" cx="50" cy="6" r="4.5"></circle>
        </svg>
        <div class="ffm-qte-key">SPACE</div>
      </div>
      <div class="ffm-stats">
        <div><span id="ffm-speed">0</span> <i>u/s</i></div>
        <div><span id="ffm-distance">0</span> <i>m</i></div>
        <div class="ffm-coin-count">🦐 <span id="ffm-coins">0</span></div>
        <div class="ffm-wings" id="ffm-wings"></div>
        <div id="ffm-chain-wrap" class="ffm-chain hidden">CHAIN <span id="ffm-chain">0</span></div>
      </div>
    </div>
  `);
  const style = document.createElement('style');
  style.textContent = `
    .ffm-hud { position: fixed; inset: 0; pointer-events: none; z-index: 25; font-family: "Segoe UI", system-ui, sans-serif; }
    .ffm-gauge-wrap { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(560px, 72vw); }
    .ffm-tier-label { text-align: center; color: #eaf6ff; font-size: 13px; letter-spacing: .28em; text-transform: uppercase; margin-bottom: 6px;
      text-shadow: 0 2px 8px rgba(0,0,0,.5); }
    .ffm-gauge { position: relative; height: 16px; border-radius: 9px; background: rgba(8, 30, 46, .72);
      border: 1px solid rgba(160, 220, 255, .35); overflow: visible; box-shadow: inset 0 2px 6px rgba(0,0,0,.35); }
    .ffm-gauge-fill { height: 100%; width: 0%; border-radius: 9px;
      background: linear-gradient(90deg, #4dd2ff, #7dff9a 35%, #ffd54a 68%, #ff4d6d);
      transition: width .12s linear; box-shadow: 0 0 12px rgba(120, 220, 255, .55); }
    .ffm-gauge-tick { position: absolute; top: -3px; bottom: -3px; width: 2px; background: rgba(230, 245, 255, .55); }
    .ffm-gauge-tick-max { background: #ff4d6d; box-shadow: 0 0 8px #ff4d6d; }
    .ffm-stats { position: absolute; top: 18px; left: 22px; display: flex; gap: 26px; color: #eaf6ff;
      font-size: 26px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,.5); }
    .ffm-stats i { font-size: 12px; font-style: normal; opacity: .7; }
    .ffm-coin-count { color: #ffd54a; }
    .ffm-wings { color: #ff8fa3; letter-spacing: .18em; font-size: 20px; align-self: center; }
    .ffm-wings span.lost { opacity: .22; filter: grayscale(1); }
    .ffm-chain { color: #7dff9a; font-size: 18px; align-self: center; }
    .ffm-charge { margin-top: 6px; text-align: center; opacity: .92; }
    .ffm-charge-label { color: #ffd54a; font-size: 12px; font-weight: 700; letter-spacing: .18em;
      text-shadow: 0 2px 10px rgba(0,0,0,.6); animation: ffm-charge-pulse .5s infinite alternate; }
    .ffm-charge-bar { margin: 5px auto 0; width: 46%; height: 8px; border-radius: 6px;
      background: rgba(8, 30, 46, .72); border: 1px solid rgba(255, 140, 120, .55); overflow: hidden; }
    .ffm-charge-fill { height: 100%; width: 0%; border-radius: 6px;
      background: linear-gradient(90deg, #ffd54a, #ff9430, #ff4d6d); transition: width .08s linear; }
    #ffm-qte { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
      width: 112px; height: 112px; display: flex; align-items: center; justify-content: center;
      pointer-events: none; }
    .ffm-qte-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
    .ffm-qte-track { fill: none; stroke: rgba(8, 30, 46, .72); stroke-width: 8; }
    /* the marked target: where the moment is. Visible from the first frame, so the player is never
       inferring the timing from motion alone. */
    .ffm-qte-target { fill: none; stroke: rgba(234, 246, 255, .40); stroke-width: 1.5; }
    /* THE BEAT: one tick around the moment, the target lights and the key goes solid */
    .ffm-qte.beat .ffm-qte-target { stroke: #ffd54a; stroke-width: 3.5;
      filter: drop-shadow(0 0 9px rgba(255, 213, 74, .85)); }
    .ffm-qte.beat .ffm-qte-key { color: #12222e; background: #ffd54a;
      text-shadow: none; box-shadow: 0 0 12px rgba(255, 213, 74, .8); }
    /* CLOSING: the inner ring starts outside the marked target and lands exactly on it */
    .ffm-qte-close { fill: none; stroke: #4dd2ff; stroke-width: 3;
      filter: drop-shadow(0 0 6px rgba(77, 210, 255, .6)); }
    /* CLOCK: the gold band (the Perfect window) and the ticking hand. No CSS transform here — the
       rotation is set per frame, in the SAME convention as the hand, so "the hand is on the band" cannot
       drift between two coordinate systems (it did: the band sat a full tick clockwise of the hand). */
    .ffm-qte-zone { fill: none; stroke: #ffd54a; stroke-width: 8; stroke-linecap: butt;
      filter: drop-shadow(0 0 6px rgba(255, 213, 74, .6)); }
    .ffm-qte-dot { fill: #ffffff; stroke: rgba(8, 30, 46, .85); stroke-width: 1.5; }
    /* past the moment: the cue must not keep claiming the moment (a late press still scores Good) */
    .ffm-qte.late .ffm-qte-target { stroke: rgba(234, 246, 255, .16); }
    .ffm-qte.late .ffm-qte-close, .ffm-qte.late .ffm-qte-dot, .ffm-qte.late .ffm-qte-zone { opacity: .4; }
    .ffm-qte-key { position: relative; color: #eaf6ff; font-size: 14px; font-weight: 700;
      letter-spacing: .22em; text-indent: .22em; text-transform: uppercase;
      text-shadow: 0 2px 8px rgba(0,0,0,.55); border-radius: 7px; padding: 3px 7px;
      background: linear-gradient(to top, rgba(255, 213, 74, .5) var(--fill, 0%), transparent var(--fill, 0%)); }
    @keyframes ffm-charge-pulse { from { opacity: .65; } to { opacity: 1; } }
  `;
  document.head.appendChild(style);

  const el = root.querySelector('#ffm-hud');
  const fill = root.querySelector('#ffm-gauge-fill');
  const tierEl = root.querySelector('#ffm-tier');
  const speedEl = root.querySelector('#ffm-speed');
  const distEl = root.querySelector('#ffm-distance');
  const coinsEl = root.querySelector('#ffm-coins');
  const chainWrap = root.querySelector('#ffm-chain-wrap');
  const chainEl = root.querySelector('#ffm-chain');
  const wingsEl = root.querySelector('#ffm-wings');
  const chargeMeter = root.querySelector('#ffm-charge-meter');
  const chargeFill = root.querySelector('#ffm-charge-fill');
  const chargeLabel = root.querySelector('#ffm-charge-label');
  const qteEl = root.querySelector('#ffm-qte');
  const keyEl = root.querySelector('.ffm-qte-key');
  const targetEl = root.querySelector('#ffm-qte-target');
  const closeEl = root.querySelector('#ffm-qte-close');
  const zoneEl = root.querySelector('#ffm-qte-zone');
  const dotEl = root.querySelector('#ffm-qte-dot');
  const WING_GLYPH = '✦'; // one per remaining wing; lost wings dim out
  const TIER_LABEL = { none: 'SWIMMING', low: 'LOW FLIGHT', medium: 'MEDIUM FLIGHT', high: 'HIGH FLIGHT', max: 'MAX FLIGHT' };

  function update(state) {
    if (state.phase !== 'run' && state.phase !== 'tutorial' && state.phase !== 'paused') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const pct = Math.min(100, (state.gauge / GAUGE.max) * 100);
    fill.style.width = pct.toFixed(1) + '%';
    tierEl.textContent = TIER_LABEL[state.tier] ?? state.tier;
    tierEl.style.color = state.tier === 'max' ? '#ff4d6d' : state.tier === 'high' ? '#ff9430' : '#eaf6ff';
    speedEl.textContent = state.speed.toFixed(0);
    distEl.textContent = state.distance.toFixed(0);
    coinsEl.textContent = String(state.coins);
    // wings only show once you've lost one (no clutter early)
    const total = GAMEOVER.wings;
    if (state.wings < total) {
      wingsEl.innerHTML = Array.from({ length: total }, (_, i) =>
        `<span class="${i < state.wings ? '' : 'lost'}">${WING_GLYPH}</span>`).join('');
    } else {
      wingsEl.textContent = '';
    }
    if (state.chain > 1) { chainWrap.classList.remove('hidden'); chainEl.textContent = String(state.chain); }
    else chainWrap.classList.add('hidden');

    // SPAM-QTE charge meter: only during the launch ritual, driven by locomotion
    if (state.locomotion === 'charge') {
      chargeMeter.classList.remove('hidden');
      chargeFill.style.width = Math.min(100, (state.gauge / GAUGE.max) * 100).toFixed(1) + '%';
      const left = Math.max(0, FLIGHT.launchChargeSeconds - state.chargeTime);
      chargeLabel.textContent = `MASH SPACE — ${left.toFixed(1)}s TO BLOW · A/D STEERS`;
    } else {
      chargeMeter.classList.add('hidden');
    }
  }

  // THE QTE CUE (2026-10-22, second pass). The player's report was "can't tell when to press", and the
  // cause was that the moment existed ONLY as motion converging. So:
  //   - the TARGET is marked statically, before anything moves (the clock's gold band, or a ring the
  //     closing circle lands on);
  //   - the beat is a SECOND channel at the moment (target lights, key goes solid, and a sound fires from
  //     game.js) — motion is never the only feedback;
  //   - the hand TICKS in discrete steps, because a countable beat is readable where smooth motion is only
  //     feelable, and the tick count to the target is drawn per ring;
  //   - the drain arc is GONE: it said "hurry" while the cue says "wait".
  const QTE_ARC = 276.5; // 2πr for the r-44 ring
  const SWEEP_DEG = 300; // how far the hand travels across the whole window
  const CLOSE_SPAN = 26; // how far outside the target the closing ring starts (r units)
  function updateQte(qte, runTime) {
    if (!qte) { qteEl.classList.add('hidden'); qteEl.classList.remove('beat', 'late'); qteEl.dataset.mode = ''; qteEl.dataset.phase = ''; return; }
    qteEl.classList.remove('hidden');
    const mode = qte.style ?? 'closing';
    qteEl.dataset.mode = mode;

    const elapsed = runTime - qte.startedAt;
    const lead = Math.max(1e-6, qte.targetAt - qte.startedAt);
    const ticks = Math.max(1, Math.round(lead / qte.tick)); // the drawn tick count to the target
    const toMoment = Math.min(1, Math.max(0, elapsed / lead));

    // the key IS the surface: it fills toward the moment, so the cue lives on the thing you press
    keyEl.style.setProperty('--fill', `${(toMoment * 100).toFixed(1)}%`);

    // THE BEAT: one tick either side of the moment. `dataset.beat` is what the tests read — a still
    // cannot prove a flash, and this is the assertion that the second channel actually fired.
    const atMoment = Math.abs(elapsed - lead) < qte.tick / 2;
    qteEl.classList.toggle('beat', atMoment);
    qteEl.dataset.beat = atMoment ? '1' : '0';
    // AFTER the moment the cue must stop claiming the moment: a late press still scores Good for another
    // 0.38 s, and a cue frozen on the target reads as "perfect". The mark dims — a STATE change, not
    // motion, because a moving element here would read as "still going" or "hurry", which is exactly the
    // mistake the drain arc made.
    const late = elapsed > lead + qte.tick / 2;
    qteEl.classList.toggle('late', late);
    qteEl.dataset.phase = late ? 'late' : (atMoment ? 'now' : 'run');

    if (mode === 'clock') {
      closeEl.style.display = 'none';
      targetEl.style.display = 'none'; // the gold band IS this style's static target
      zoneEl.style.display = '';
      dotEl.style.display = '';
      // the hand moves in DISCRETE ticks and holds still between them
      const idx = Math.floor(elapsed / qte.tick);
      const degPerTick = SWEEP_DEG / (ticks + Math.ceil(qte.goodHalf / qte.tick));
      // The dot is AUTHORED at (50, 6) — 12 o'clock — and the band is centred there, so theta 0 IS the
      // band. Do NOT add an offset here: a -90 (the value an earlier sweep used, derived from the path's
      // default 3-o'clock start) lands the hand at 9 o'clock while the band sits at 12, so the cue times
      // the wrong moment. An ANGLE-ONLY assertion could not see that — the acceptance still caught it.
      dotEl.setAttribute('transform', `rotate(${(degPerTick * (idx - ticks)).toFixed(1)} 50 50)`);
      const halfDeg = degPerTick; // the half-width is one tick, so the band IS the Perfect window (±1 tick)
      zoneEl.setAttribute('stroke-dasharray', `${(2 * halfDeg) / 360 * QTE_ARC} ${QTE_ARC}`);
      zoneEl.setAttribute('stroke-dashoffset', '0');
      // The circle's path starts at 3 o'clock, so -90 brings the dash's start to 12; -halfDeg more centres
      // the dash there. Expressed as a rotation of the element, in the SAME convention as the hand above,
      // so the two cannot disagree — which they did: the band began AT the hand and ran a tick clockwise.
      zoneEl.setAttribute('transform', `rotate(${(-90 - halfDeg).toFixed(1)} 50 50)`);
      return;
    }

    zoneEl.style.display = 'none';
    dotEl.style.display = 'none';
    closeEl.style.display = '';
    targetEl.style.display = '';
    // the closing ring travels in and lands exactly ON the marked target at the moment
    closeEl.setAttribute('r', (44 + CLOSE_SPAN * (1 - toMoment)).toFixed(2));
  }

  return { update, updateQte };
}
