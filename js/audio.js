// Audio (PRD §19): everything synthesized with WebAudio — no audio assets.
// Master/music/SFX gains come from settings. Autoplay-safe: nothing is created
// until the first user gesture, and every call is failure-tolerant.

export function createAudio(settings, bus) {
  let ctx = null;
  let masterGain = null, musicGain = null, sfxGain = null;
  let musicNodes = null;
  const stats = { calls: {}, contextState: 'none' };

  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = settings.master;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = settings.music;
      musicGain.connect(masterGain);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = settings.sfx;
      sfxGain.connect(masterGain);
      stats.contextState = ctx.state;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function count(name) { stats.calls[name] = (stats.calls[name] ?? 0) + 1; }

  function resume() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    stats.contextState = ctx.state;
  }

  function applySettings(s) {
    Object.assign(settings, s);
    if (masterGain) masterGain.gain.value = settings.master;
    if (musicGain) musicGain.gain.value = settings.music;
    if (sfxGain) sfxGain.gain.value = settings.sfx;
  }

  // ---- one-shot synth voices ----
  function tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.5, slideTo = null, delay = 0 }) {
    if (!ensure()) return;
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(sfxGain);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch { /* audio is optional */ }
  }

  function noise({ dur = 0.2, gain = 0.4, cutoff = 1200 }) {
    if (!ensure()) return;
    try {
      const t0 = ctx.currentTime;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter); filter.connect(g); g.connect(sfxGain);
      src.start(t0);
    } catch { /* audio is optional */ }
  }

  // ---- event voices ----
  const sfx = {
    perfect() { count('perfect'); tone({ freq: 660, slideTo: 990, dur: 0.16, type: 'triangle', gain: 0.5 }); tone({ freq: 990, dur: 0.12, delay: 0.07, gain: 0.35 }); },
    good() { count('good'); tone({ freq: 520, dur: 0.1, type: 'sine', gain: 0.4 }); },
    miss() { count('miss'); tone({ freq: 200, slideTo: 90, dur: 0.25, type: 'sawtooth', gain: 0.4 }); },
    tierUp() { count('tierUp'); tone({ freq: 330, slideTo: 880, dur: 0.3, type: 'square', gain: 0.25 }); },
    tierDown() { count('tierDown'); tone({ freq: 440, slideTo: 160, dur: 0.35, type: 'square', gain: 0.25 }); },
    coin() { count('coin'); tone({ freq: 1200, dur: 0.07, type: 'sine', gain: 0.4 }); tone({ freq: 1800, dur: 0.09, delay: 0.06, gain: 0.35 }); },
    collision() { count('collision'); noise({ dur: 0.25, gain: 0.5, cutoff: 900 }); },
    collisionMajor() { count('collisionMajor'); noise({ dur: 0.4, gain: 0.7, cutoff: 500 }); tone({ freq: 140, slideTo: 60, dur: 0.3, type: 'sawtooth', gain: 0.4 }); },
    splash() { count('splash'); noise({ dur: 0.3, gain: 0.35, cutoff: 2400 }); },
    planeEnter() { count('planeEnter'); tone({ freq: 220, slideTo: 1320, dur: 0.5, type: 'sawtooth', gain: 0.3 }); },
    planeExit() { count('planeExit'); tone({ freq: 1320, slideTo: 220, dur: 0.5, type: 'sawtooth', gain: 0.3 }); },
    ui() { count('ui'); tone({ freq: 700, dur: 0.06, type: 'sine', gain: 0.3 }); },
  };

  // ---- music bed: intensity follows flight tier (PRD §19.2) ----
  const TIER_INTENSITY = { none: 0, low: 0.25, medium: 0.5, high: 0.75, max: 1 };
  let musicTarget = 0;

  function startMusic() {
    if (!ensure() || musicNodes) return;
    try {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const osc1 = ctx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 110;
      const osc2 = ctx.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = 165;
      const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 2;
      const pulseGain = ctx.createGain(); pulseGain.gain.value = 40;
      pulse.connect(pulseGain); pulseGain.connect(filter.frequency);
      osc1.connect(filter); osc2.connect(filter);
      filter.connect(musicGain);
      osc1.start(); osc2.start(); pulse.start();
      musicNodes = { filter, osc1, osc2, pulse };
    } catch { /* audio is optional */ }
  }

  function setMusicIntensity(tier) {
    musicTarget = TIER_INTENSITY[tier] ?? 0;
    if (musicNodes && ctx) {
      try { musicNodes.filter.frequency.value = 400 + musicTarget * 2600; } catch { /* ignore */ }
    }
  }

  // ---- event wiring ----
  if (bus) {
    bus.on('timing:result', ({ result }) => sfx[result]?.());
    bus.on('tier:up', sfx.tierUp);
    bus.on('tier:down', sfx.tierDown);
    bus.on('coin:collect', sfx.coin);
    bus.on('collision:minor', sfx.collision);
    bus.on('collision:major', sfx.collisionMajor);
    bus.on('plane:enter', () => { sfx.planeEnter(); setMusicIntensity('max'); });
    bus.on('plane:exit', sfx.planeExit);
    bus.on('run:start', () => { resume(); startMusic(); });
    bus.on('run:end', () => setMusicIntensity('none'));
  }

  return { resume, applySettings, setMusicIntensity, startMusic, sfx, stats };
}
