import { GAUGE, GAMEOVER, FLIGHT } from './config.js';
import { dialAngles } from './timing.js';

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
          <!-- THE PAINTED DIAL (clock style). The whole turn is white = Miss, with the Good (yellow) and
               Perfect (red) windows painted on top in window TIME at a fixed degrees-per-second, so the
               zones keep their size at every ring and the GROUP's position is what moves per trigger.
               The edge is wider than the zones: plain white would vanish against the sky/sea the cue sits
               on, and the dial would stop reading as a band. -->
          <circle id="ffm-qte-dial-edge" class="ffm-qte-dial-edge" cx="50" cy="50" r="44"></circle>
          <circle id="ffm-qte-dial" class="ffm-qte-dial" cx="50" cy="50" r="44"></circle>
          <path id="ffm-qte-good" class="ffm-qte-good" d=""></path>
          <path id="ffm-qte-perfect" class="ffm-qte-perfect" d=""></path>
          <!-- THE NEEDLE: a stick from behind the key out to the rim, with a tip dot that sits ON the band
               exactly at the moment. One group, one rotation, one convention (0 deg = 12 o'clock). -->
          <g id="ffm-qte-hand" class="ffm-qte-hand">
            <line class="ffm-qte-needle" x1="50" y1="50" x2="50" y2="8"></line>
            <circle id="ffm-qte-dot" class="ffm-qte-dot" cx="50" cy="6" r="4.5"></circle>
          </g>
          <!-- CLOSING style: an inner ring shrinks onto the marked target and lands on it at the moment -->
          <circle id="ffm-qte-target" class="ffm-qte-target" cx="50" cy="50" r="44"></circle>
          <circle id="ffm-qte-close" class="ffm-qte-close" cx="50" cy="50" r="44"></circle>
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
    /* The cue sits UPPER-MIDDLE, not at the bottom (2026-10-22, user: "the qte page currently sitting on
       bottom which is not ergonomical, player need to divide the focus to diffrent part of screen
       everytime"). The bottom already carries the gauge and the charge meter, and the gaze during play is
       on the fish and the water ahead — centre and up toward the horizon — so the cue was in the one busy
       corner the eye is not in. 12% puts it in the sky band the eye already scans for the next ring,
       ABOVE the horizon (≈45%) and clear of the grade popups (fixed at top: 34%, 44px tall), which also
       keeps it out of the way of the water being steered through. */
    #ffm-qte { position: fixed; left: 50%; top: 12%; transform: translateX(-50%);
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
    /* THE PAINTED DIAL (clock style): white = Miss, yellow = Good, red = Perfect, all measured in window
       time at one rate, so the zones cannot disagree with the grading. */
    .ffm-qte-dial-edge { fill: none; stroke: rgba(8, 30, 46, .72); stroke-width: 11; }
    .ffm-qte-dial { fill: none; stroke: rgba(246, 250, 255, .94); stroke-width: 8; }
    .ffm-qte-good { fill: none; stroke: #ffd54a; stroke-width: 8; stroke-linecap: butt; }
    .ffm-qte-perfect { fill: none; stroke: #ff5e5b; stroke-width: 8; stroke-linecap: butt;
      filter: drop-shadow(0 0 4px rgba(255, 94, 91, .55)); }
    /* THE NEEDLE: dark, because the zones under it are white/yellow/red — a white hand would vanish on
       its own dial — with a white tip dot for the point that has to sit on the band. */
    .ffm-qte-needle { stroke: #0b2029; stroke-width: 2.6; stroke-linecap: round; }
    .ffm-qte-dot { fill: #ffffff; stroke: rgba(8, 30, 46, .9); stroke-width: 1.5; }
    /* the beat lights the Perfect zone, the tip and the key — the moment on three channels at once */
    .ffm-qte.beat .ffm-qte-perfect { filter: drop-shadow(0 0 11px rgba(255, 94, 91, .95)); }
    .ffm-qte.beat .ffm-qte-dot { fill: #ffd54a; stroke: #10222e; }
    /* past the moment: the cue must not keep claiming the moment (a late press still scores Good) */
    .ffm-qte.late .ffm-qte-target { stroke: rgba(234, 246, 255, .16); }
    .ffm-qte.late .ffm-qte-dial, .ffm-qte.late .ffm-qte-dial-edge, .ffm-qte.late .ffm-qte-good,
    .ffm-qte.late .ffm-qte-perfect, .ffm-qte.late .ffm-qte-needle, .ffm-qte.late .ffm-qte-hand,
    .ffm-qte.late .ffm-qte-close, .ffm-qte.late .ffm-qte-dot { opacity: .4; }
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
  // the painted dial (clock style) and its needle
  const dialEls = ['#ffm-qte-dial-edge', '#ffm-qte-dial', '#ffm-qte-good', '#ffm-qte-perfect', '#ffm-qte-hand']
    .map((sel) => root.querySelector(sel));
  const goodEl = root.querySelector('#ffm-qte-good');
  const perfectEl = root.querySelector('#ffm-qte-perfect');
  const handEl = root.querySelector('#ffm-qte-hand');
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

  // THE QTE CUE (2026-10-22, third pass). The player's reports, in order: first "can't tell when to
  // press", then "the perfect, good, miss is not randomize they also need to have red area(perfect, small)
  // yellow area(good, medium) white area(miss, large) ... i dont see any stick indicator like clock
  // needle". So:
  //   - the CLOCK style PAINTS its windows: the turn is white (Miss) with the Good (yellow) and Perfect
  //     (red) windows on top, sized in window TIME at one rate (js/timing.js dialAngles), so the paint
  //     cannot disagree with the grading;
  //   - the ZONES keep their size and the MOMENT's position on the dial moves per trigger. The old cue
  //     did the opposite — bands pinned at 12 o'clock, needle speed varying — so every ring looked
  //     identical and the drawn variation was invisible;
  //   - a NEEDLE: a stick out to the rim with a tip dot that sits on the band (a bare dot read as no
  //     pointer at all);
  //   - the beat is a SECOND channel at the moment (the red zone lights, the tip lights, the key goes
  //     solid, and a sound fires from game.js) — motion is never the only feedback;
  //   - past the moment the draw dims: a STATE change, not motion, because a moving element there reads
  //     as "still going" or "hurry", which is the mistake the drain arc made;
  //   - the drain arc is GONE for that reason.
  const CLOSE_SPAN = 26; // how far outside the target the closing ring starts (r units)
  const DIAL_R = 44;     // the dial's radius, in viewBox units
  const dialPt = (deg) => {
    const rad = (deg - 90) * Math.PI / 180; // -90 puts 0 deg at 12 o'clock; positive runs clockwise
    return [50 + DIAL_R * Math.cos(rad), 50 + DIAL_R * Math.sin(rad)];
  };
  // Arcs as EXPLICIT geometry, in one stated convention. This replaced stroke-dasharray + dashoffset,
  // which carries a second one (the circle path starts at 3 o'clock and the pattern's phase comes from the
  // offset) — that is how the band once ended up a full tick clockwise of the hand.
  const arcPath = (a0, a1) => {
    const [x0, y0] = dialPt(a0), [x1, y1] = dialPt(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${DIAL_R} ${DIAL_R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const showDial = (on) => { for (const el of dialEls) el.style.display = on ? '' : 'none'; };
  function updateQte(qte, runTime) {
    if (!qte) { qteEl.classList.add('hidden'); qteEl.classList.remove('beat', 'late'); qteEl.dataset.mode = ''; qteEl.dataset.phase = ''; return; }
    qteEl.classList.remove('hidden');
    const mode = qte.style ?? 'closing';
    qteEl.dataset.mode = mode;

    const elapsed = runTime - qte.startedAt;
    const lead = Math.max(1e-6, qte.targetAt - qte.startedAt);
    const toMoment = Math.min(1, Math.max(0, elapsed / lead));

    // the key IS the surface: it fills toward the moment, so the cue lives on the thing you press
    keyEl.style.setProperty('--fill', `${(toMoment * 100).toFixed(1)}%`);

    // THE BEAT: one tick either side of the moment. `dataset.beat` is what the tests read — a still
    // cannot prove a flash, and this is the assertion that the second channel actually fired.
    const atMoment = Math.abs(elapsed - lead) < qte.tick / 2;
    qteEl.classList.toggle('beat', atMoment);
    qteEl.dataset.beat = atMoment ? '1' : '0';
    // AFTER the moment the cue must stop claiming the moment: a late press still scores Good for another
    // 0.38 s, and a cue frozen on the target reads as "perfect". The draw dims — a STATE change, not
    // motion, because a moving element here would read as "still going" or "hurry", which is exactly the
    // mistake the drain arc made.
    const late = elapsed > lead + qte.tick / 2;
    qteEl.classList.toggle('late', late);
    qteEl.dataset.phase = late ? 'late' : (atMoment ? 'now' : 'run');

    if (mode === 'clock') {
      closeEl.style.display = 'none';
      targetEl.style.display = 'none'; // the painted dial IS this style's target
      showDial(true);
      const d = dialAngles(qte, elapsed);
      // the two windows, painted where they actually are in TIME — so they sit somewhere new each ring
      goodEl.setAttribute('d', arcPath(d.centre - d.goodHalfDeg, d.centre + d.goodHalfDeg));
      perfectEl.setAttribute('d', arcPath(d.centre - d.perfectHalfDeg, d.centre + d.perfectHalfDeg));
      // the needle steps in whole ticks at a CONSTANT degrees-per-second, so its speed is the same every
      // ring and it is the PAINTED MOMENT that moves. The tip is authored at 12 o'clock, so 0 deg IS the
      // band's centre — do NOT offset it (a -90, from the path's 3-o'clock start, put the hand at 9
      // o'clock while the band sat at 12; an angle-only assertion could not see that, the still did).
      const idx = Math.floor(elapsed / qte.tick);
      handEl.setAttribute('transform', `rotate(${(idx * qte.tick * d.degPerSec).toFixed(2)} 50 50)`);
      return;
    }

    showDial(false);
    closeEl.style.display = '';
    targetEl.style.display = '';
    // the closing ring travels in and lands exactly ON the marked target at the moment
    closeEl.setAttribute('r', (44 + CLOSE_SPAN * (1 - toMoment)).toFixed(2));
  }

  return { update, updateQte };
}
