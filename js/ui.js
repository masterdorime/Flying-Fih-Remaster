import { defaultSettings, loadSettings, saveSettings, mergeSettings, loadBest, saveBest } from './settings.js';

// Menus / pause / results / settings / tutorial (PRD §2, §3, §17, §25).
// All DOM; UI never mutates gameplay state directly — it calls commands.

export function createUi(root, { storage = globalThis.localStorage ?? memoryStorage() }) {
  let settings = loadSettings(storage);

  root.insertAdjacentHTML('beforeend', `
    <div id="ffm-menu" class="ffm-screen">
      <h1>FLYING FISH<br>MOMENTUM</h1>
      <p class="ffm-tag">Press at the right time. Preserve the momentum. Fly like a plane.</p>
      <div class="ffm-best">Best distance: <b id="ffm-best-menu">0</b> m</div>
      <div class="ffm-buttons">
        <button id="ffm-start">Start run</button>
        <button id="ffm-settings-btn">Settings</button>
        <button id="ffm-quit">Quit</button>
      </div>
      <div class="ffm-help">WASD steer &nbsp;·&nbsp; SPACE timing &nbsp;·&nbsp; ESC pause</div>
    </div>

    <div id="ffm-pause" class="ffm-screen hidden">
      <h2>PAUSED</h2>
      <div class="ffm-buttons">
        <button id="ffm-resume">Resume</button>
        <button id="ffm-restart">Restart run</button>
        <button id="ffm-menu-btn">Main menu</button>
      </div>
    </div>

    <div id="ffm-results" class="ffm-screen hidden">
      <h2 id="ffm-results-title">RUN OVER</h2>
      <div class="ffm-results-grid" id="ffm-results-grid"></div>
      <div id="ffm-newbest" class="ffm-newbest hidden">NEW BEST!</div>
      <div id="ffm-assist-badge" class="ffm-assist hidden">ASSIST MODE — not a record run</div>
      <div class="ffm-buttons">
        <button id="ffm-again">Run again</button>
        <button id="ffm-results-menu">Main menu</button>
      </div>
    </div>

    <div id="ffm-settings" class="ffm-screen hidden">
      <h2>SETTINGS</h2>
      <div class="ffm-settings" id="ffm-settings-body"></div>
      <div class="ffm-buttons">
        <button id="ffm-settings-back">Back</button>
      </div>
    </div>

    <div id="ffm-thanks" class="ffm-screen hidden">
      <h2>THANKS FOR PLAYING</h2>
      <p class="ffm-tag">You can close this tab.</p>
      <div class="ffm-buttons"><button id="ffm-thanks-back">Back to menu</button></div>
    </div>

    <div id="ffm-tutorial" class="ffm-tutorial hidden"><span id="ffm-tutorial-text"></span>
      <button id="ffm-tutorial-skip">Skip</button>
    </div>
  `);

  const style = document.createElement('style');
  style.textContent = `
    .ffm-screen { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; z-index: 40; color: #eaf6ff; font-family: "Segoe UI", system-ui, sans-serif; text-align: center;
      background: radial-gradient(circle at 50% 35%, rgba(20, 70, 105, .55), rgba(6, 24, 38, .88)); backdrop-filter: blur(3px); }
    .ffm-screen.hidden, .ffm-tutorial.hidden { display: none; }
    .ffm-screen h1 { font-size: clamp(40px, 7vw, 84px); margin: 0; letter-spacing: .06em; line-height: 1.02;
      text-shadow: 0 6px 30px rgba(0,0,0,.5); }
    .ffm-screen h2 { font-size: clamp(28px, 4vw, 48px); margin: 0 0 6px; letter-spacing: .14em; }
    .ffm-tag { opacity: .85; max-width: 520px; margin: 0 0 6px; }
    .ffm-best { font-size: 14px; opacity: .9; margin-bottom: 8px; }
    .ffm-buttons { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
    .ffm-buttons button { pointer-events: auto; cursor: pointer; font: inherit; font-weight: 700; font-size: 17px;
      padding: 12px 30px; border-radius: 12px; border: 1px solid rgba(160, 220, 255, .45); color: #eaf6ff;
      background: linear-gradient(180deg, rgba(77, 210, 255, .28), rgba(20, 70, 105, .5)); transition: transform .12s, box-shadow .12s; }
    .ffm-buttons button:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(0,0,0,.35); }
    .ffm-help { margin-top: 18px; font-size: 13px; opacity: .75; letter-spacing: .08em; }
    .ffm-results-grid { display: grid; grid-template-columns: repeat(2, minmax(150px, 200px)); gap: 8px 34px; margin: 8px 0; font-size: 16px; }
    .ffm-results-grid div { display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(160,220,255,.25); padding: 5px 0; }
    .ffm-results-grid b { color: #ffd54a; }
    .ffm-newbest { color: #7dff9a; font-weight: 800; letter-spacing: .2em; }
    .ffm-assist { color: #ffd54a; font-size: 13px; letter-spacing: .14em; }
    .ffm-settings { display: grid; gap: 12px; width: min(430px, 84vw); margin: 6px 0 12px; }
    .ffm-settings label { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: 15px; }
    .ffm-settings input[type=range] { grid-column: 1 / -1; }
    .ffm-settings .ffm-row { display: flex; justify-content: space-between; align-items: center; }
    .ffm-tutorial { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 45; pointer-events: none;
      background: rgba(8, 30, 46, .85); border: 1px solid rgba(160,220,255,.4); color: #eaf6ff; padding: 12px 22px;
      border-radius: 12px; font-family: "Segoe UI", system-ui, sans-serif; font-size: 17px; max-width: 76vw; text-align: center; }
    .ffm-tutorial button { pointer-events: auto; margin-left: 14px; }
  `;
  document.head.appendChild(style);

  const $ = id => root.querySelector('#' + id);
  const screens = { menu: $('ffm-menu'), pause: $('ffm-pause'), results: $('ffm-results'), settings: $('ffm-settings'), thanks: $('ffm-thanks') };
  const tutorial = $('ffm-tutorial');
  const tutorialText = $('ffm-tutorial-text');

  // ---- settings controls ----
  const sliderDefs = [
    ['master', 'Master volume', 0, 1, 0.05],
    ['music', 'Music volume', 0, 1, 0.05],
    ['sfx', 'SFX volume', 0, 1, 0.05],
    ['cameraShake', 'Camera shake', 0, 1, 0.05],
    ['postFx', 'Post FX intensity', 0, 1, 0.05],
    ['sensitivity', 'Input sensitivity', 0.2, 2, 0.05],
  ];
  const body = $('ffm-settings-body');
  body.innerHTML = sliderDefs.map(([key, label, min, max, step]) => `
    <label>${label}<span data-val="${key}">${settings[key].toFixed(2)}</span>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"></label>
  `).join('') + `
    <div class="ffm-row"><span>Assist mode (bigger timing windows, slower top speed)</span>
      <input type="checkbox" data-key="assist" ${settings.assist ? 'checked' : ''}></div>
  `;
  body.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.key;
      settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      const val = body.querySelector(`[data-val="${key}"]`);
      if (val) val.textContent = settings[key].toFixed(2);
      saveSettings(storage, settings);
      commands.onSettingsChange?.(settings);
    });
  });

  // ---- visibility ----
  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    if (!name) for (const el of Object.values(screens)) el.classList.add('hidden');
  }
  function showTutorial(text) {
    tutorialText.textContent = text;
    tutorial.classList.remove('hidden');
  }
  function hideTutorial() { tutorial.classList.add('hidden'); }

  function refreshBest() { $('ffm-best-menu').textContent = loadBest(storage, 'ffm.bestDistance').toFixed(0); }
  refreshBest();

  // ---- results ----
  function showResults(state) {
    const best = loadBest(storage, 'ffm.bestDistance');
    const isBest = state.distance > best && best > 0;
    if (state.distance > best) saveBest(storage, 'ffm.bestDistance', state.distance);
    const reason = state.endReason === 'CRASHED' ? 'CRASHED!' : state.endReason === 'OUT OF MOMENTUM' ? 'OUT OF MOMENTUM' : 'RUN OVER';
    const title = $('ffm-results-title');
    if (title) title.textContent = reason;
    const rows = [
      ['Distance', `${state.distance.toFixed(0)} m`],
      ['Duration', `${state.runTime.toFixed(1)} s`],
      ['Score', state.score.toFixed(0)],
      ['Highest tier', state.tier === 'max' ? 'MAX' : state.tier.toUpperCase()],
      ['Top speed', `${state.speed.toFixed(0)} u/s`],
      ['Shrimp', String(state.coins)],
      ['Perfect', String(state.counts.perfect)],
      ['Good', String(state.counts.good)],
      ['Miss', String(state.counts.miss)],
      ['Best chain', String(state.bestChain)],
    ];
    $('ffm-results-grid').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('ffm-newbest').classList.toggle('hidden', !isBest);
    $('ffm-assist-badge').classList.toggle('hidden', !state.assist);
    show('results');
  }

  // ---- commands the game layer provides ----
  const commands = {
    onStart: null, onPause: null, onResume: null, onRestart: null, onMenu: null, onSettingsChange: null, onSkipTutorial: null,
  };

  $('ffm-start').addEventListener('click', () => commands.onStart?.(settings));
  $('ffm-quit').addEventListener('click', () => show('thanks'));
  $('ffm-thanks-back').addEventListener('click', () => show('menu'));
  $('ffm-settings-btn').addEventListener('click', () => show('settings'));
  $('ffm-settings-back').addEventListener('click', () => { refreshBest(); show('menu'); });
  $('ffm-resume').addEventListener('click', () => commands.onResume?.());
  $('ffm-restart').addEventListener('click', () => commands.onRestart?.(settings));
  $('ffm-menu-btn').addEventListener('click', () => commands.onMenu?.());
  $('ffm-again').addEventListener('click', () => commands.onRestart?.(settings));
  $('ffm-results-menu').addEventListener('click', () => commands.onMenu?.());
  $('ffm-tutorial-skip').addEventListener('click', () => commands.onSkipTutorial?.());

  return { show, showTutorial, hideTutorial, showResults, refreshBest, commands, getSettings: () => settings, setSettings: (s) => { settings = mergeSettings(s); } };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}
