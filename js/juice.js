// JuiceFeedbackSystem (PRD §18): DOM popups + speed lines + screen flash.
// DOM keeps popups readable at 110 speed and easy to verify in tests.

const injectStyles = (() => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const style = document.createElement('style');
    style.textContent = `
      .ffm-popup { position: fixed; left: 50%; top: 34%; transform: translate(-50%,-50%);
        font-size: 44px; font-weight: 800; letter-spacing: .08em; pointer-events: none;
        text-shadow: 0 3px 14px rgba(0,0,0,.45); animation: ffm-pop .8s ease-out forwards; z-index: 30; }
      @keyframes ffm-pop { 0% { opacity: 0; scale: .6; } 15% { opacity: 1; scale: 1.12; }
        30% { scale: 1; } 75% { opacity: 1; } 100% { opacity: 0; translate: 0 -46px; } }
      .ffm-speedlines { position: fixed; inset: 0; pointer-events: none; z-index: 20; opacity: 0;
        transition: opacity .25s; background:
          repeating-conic-gradient(from 0deg at 50% 50%, transparent 0deg 2deg, rgba(255,255,255,.06) 2deg 3deg);
        mask-image: radial-gradient(circle at 50% 50%, transparent 34%, black 78%); }
    `;
    document.head.appendChild(style);
  };
})();

export function createJuice() {
  injectStyles();

  const speedLines = document.createElement('div');
  speedLines.className = 'ffm-speedlines';
  document.body.appendChild(speedLines);
  const layer = document.createElement('div');
  layer.id = 'ffm-popups';
  document.body.appendChild(layer);

  function popup(text, color, small = false) {
    const el = document.createElement('div');
    el.className = 'ffm-popup';
    el.textContent = text;
    el.style.color = color;
    if (small) el.style.fontSize = '26px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  function setSpeedLines(intensity) {
    speedLines.style.opacity = String(Math.min(0.9, Math.max(0, intensity)));
  }

  function flashTier(color) {
    popup('TIER', color);
  }

  return { popup, setSpeedLines, flashTier, elements: { speedLines, layer } };
}
