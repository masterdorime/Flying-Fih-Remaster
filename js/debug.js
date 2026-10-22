// Debug overlay (PRD §24.1). Toggle with F3. Read-only view of all game-critical state.

export function createDebug(root) {
  root.insertAdjacentHTML('beforeend', `
    <div id="ffm-debug" class="ffm-debug hidden"></div>
  `);
  const style = document.createElement('style');
  style.textContent = `
    .ffm-debug { position: fixed; top: 10px; right: 12px; z-index: 60; pointer-events: none;
      font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.55; color: #b8f5c8;
      background: rgba(4, 16, 26, .82); border: 1px solid rgba(125, 255, 154, .3); border-radius: 8px;
      padding: 10px 14px; min-width: 230px; white-space: pre; }
    .ffm-debug.hidden { display: none; }
  `;
  document.head.appendChild(style);
  const el = root.querySelector('#ffm-debug');

  function update(state, timing, fps, extra = '') {
    const windows = timing?.windows ?? { lead: 0, leadMax: 0, tick: 0, perfect: 0, good: 0 };
    const lines = [
      `phase      ${state.phase}`,
      `speed      ${state.speed.toFixed(1)}`,
      `gauge      ${state.gauge.toFixed(1)}`,
      `tier       ${state.tier}`,
      `loco       ${state.locomotion}`,
      `last       ${state.lastResult ?? '-'}`,
      `qte        at+${windows.lead.toFixed(2)}-${windows.leadMax.toFixed(2)}s tick ${windows.tick.toFixed(2)}  P+-${windows.perfect.toFixed(2)} G+-${windows.good.toFixed(2)}`,
      `chain      ${state.chain}`,
      `distance   ${state.distance.toFixed(1)}m`,
      `runTime    ${state.runTime.toFixed(1)}s`,
      `difficulty ${state.difficulty.toFixed(2)}`,
      `fps        ${fps}`,
    ];
    if (extra) lines.push(extra);
    el.textContent = lines.join('\n');
  }

  function toggle() { el.classList.toggle('hidden'); return !el.classList.contains('hidden'); }
  return { update, toggle };
}
