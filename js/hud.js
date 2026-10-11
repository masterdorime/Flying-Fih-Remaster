import { GAUGE, GAMEOVER, FLIGHT } from './config.js';

// In-run HUD (PRD §17): gauge with tier ticks, tier label, speed, distance, coins, chain.

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
    .ffm-charge { margin-top: 10px; text-align: center; }
    .ffm-charge-label { color: #ffd54a; font-size: 15px; font-weight: 700; letter-spacing: .22em;
      text-shadow: 0 2px 10px rgba(0,0,0,.6); animation: ffm-charge-pulse .5s infinite alternate; }
    .ffm-charge-bar { margin: 7px auto 0; width: 78%; height: 12px; border-radius: 7px;
      background: rgba(8, 30, 46, .72); border: 1px solid rgba(255, 140, 120, .55); overflow: hidden; }
    .ffm-charge-fill { height: 100%; width: 0%; border-radius: 7px;
      background: linear-gradient(90deg, #ffd54a, #ff9430, #ff4d6d); transition: width .08s linear; }
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
      chargeLabel.textContent = `MASH SPACE — ${left.toFixed(1)}s TO BLOW`;
    } else {
      chargeMeter.classList.add('hidden');
    }
  }

  return { update };
}
