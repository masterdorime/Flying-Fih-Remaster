// TEMPORARY music test panel — remove before release.
// Slider drives the AdaptiveMusicController's momentum input directly so the
// soundtrack can be verified before it's connected to gameplay.

export function createMusicTestPanel(music) {
  const root = document.createElement('div');
  root.id = 'music-test';
  root.innerHTML = `
    <div class="mt-head">MUSIC TEST <span class="mt-warn">(temporary)</span></div>
    <label>Momentum <input id="mt-slider" type="range" min="0" max="100" value="0"><b id="mt-val">0%</b></label>
    <div class="mt-row">
      <button id="mt-play">Play</button>
      <button id="mt-pause">Pause</button>
      <button id="mt-mute">Mute</button>
    </div>
    <label>Volume <input id="mt-vol" type="range" min="0" max="100" value="100"><b id="mt-volval">100%</b></label>
    <div class="mt-state" id="mt-state">idle</div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #music-test { position: fixed; top: 10px; left: 10px; z-index: 70; width: 250px;
      background: rgba(6, 20, 32, .92); border: 1px solid rgba(125, 255, 154, .4); border-radius: 10px;
      padding: 12px 14px; color: #d7f7e3; font: 13px/1.5 ui-monospace, Consolas, monospace; }
    #music-test .mt-head { font-weight: 700; letter-spacing: .1em; margin-bottom: 8px; color: #7dff9a; }
    #music-test .mt-warn { color: #ffd54a; font-size: 10px; }
    #music-test label { display: grid; grid-template-columns: 62px 1fr auto; gap: 6px; align-items: center; margin: 6px 0; }
    #music-test input[type=range] { width: 100%; }
    #music-test .mt-row { display: flex; gap: 6px; margin: 8px 0; }
    #music-test button { flex: 1; cursor: pointer; font: inherit; padding: 5px 0; border-radius: 6px;
      border: 1px solid rgba(160, 220, 255, .4); background: rgba(77, 210, 255, .15); color: #eaf6ff; }
    #music-test .mt-state { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(125,255,154,.3);
      font-size: 11px; white-space: pre; color: #9fe8b8; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const slider = root.querySelector('#mt-slider');
  const val = root.querySelector('#mt-val');
  const vol = root.querySelector('#mt-vol');
  const volval = root.querySelector('#mt-volval');
  const state = root.querySelector('#mt-state');
  const muteBtn = root.querySelector('#mt-mute');

  slider.addEventListener('input', () => {
    val.textContent = slider.value + '%';
    if (!music.debugState().playing) music.play(); // slider drag counts as a gesture
    music.setMomentum(slider.value / 100);
    render();
  });
  vol.addEventListener('input', () => {
    volval.textContent = vol.value + '%';
    music.setVolume(vol.value / 100);
  });
  root.querySelector('#mt-play').addEventListener('click', () => { music.play(); render(); });
  root.querySelector('#mt-pause').addEventListener('click', () => { music.pause(); render(); });
  muteBtn.addEventListener('click', () => {
    music.mute(!(music.debugState().muted));
    render();
  });

  function render() {
    const s = music.debugState();
    state.textContent =
      `rung: ${s.rung ?? '-'}  tracks: ${s.tracksLoaded}\n` +
      `momentum: ${Math.round(s.momentum * 100)}%  playing: ${s.playing}  muted: ${s.muted}\n` +
      `volumes: ${Object.entries(s.targets).map(([k, v]) => `${k}:${v}`).join(' ')}`;
    muteBtn.textContent = s.muted ? 'Unmute' : 'Mute';
  }
  setInterval(render, 250);
  render();
  return root;
}
