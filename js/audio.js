// Audio system (PRD §19): real audio files when present, synthesized fallback otherwise.
// Master/music/SFX gains come from settings. Autoplay-safe: nothing is created
// until the first user gesture, and every call is failure-tolerant.

const SFX_FILES = {
  perfect: 'sfx/perfect.mp3',
  good: 'sfx/good.mp3',
  miss: 'sfx/miss.mp3',
  tierUp: 'sfx/power-up.mp3',
  tierDown: 'sfx/power-down.mp3',
  planeEnter: 'sfx/power-up.mp3',   // no dedicated plane sting in the pack; pitch-lifted power-up
  planeExit: 'sfx/power-down.mp3',
  coin: 'sfx/coin.mp3',
  collision: 'sfx/crash.mp3',
  collisionMajor: 'sfx/crash-big.mp3',
  splash: 'sfx/splash.mp3',
  ui: 'sfx/ui.mp3',
  runEnd: 'sfx/game-over.mp3',
};

const AMBIENT_FILES = {
  waves: 'ambient/waves.mp3',
  wind: 'ambient/wind.mp3',
};

// Per-SFX playback gain (master mix trim). Your perfect take is mastered louder
// than the rest, so it needs a cut; everything else plays at 1.
const SFX_GAIN = {
  perfect: 0.5,
};

const AUDIO_DIR = 'assets/audio/';

export function createAudio(settings, bus) {
  let ctx = null;
  let masterGain = null, musicGain = null, sfxGain = null;
  let musicNodes = null;
  const stats = { calls: {}, contextState: 'none', filesLoaded: 0, filesMissing: [] };

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

  function getContext() { return ensure(); }
  function musicBus() { ensure(); return musicGain; }

  // ---- file loading (one-shots + ambient loops) ----
  const sfxBuffers = new Map();
  const ambient = { nodes: null, buffers: {}, windGain: null };

  async function loadFiles() {
    if (!ensure()) return { loaded: 0, missing: [] };
    const missing = [];
    const jobs = [];
    for (const [name, rel] of Object.entries(SFX_FILES)) {
      jobs.push(loadBuffer(AUDIO_DIR + rel).then(b => {
        if (b) sfxBuffers.set(name, b); else missing.push(rel);
      }));
    }
    for (const [name, rel] of Object.entries(AMBIENT_FILES)) {
      jobs.push(loadBuffer(AUDIO_DIR + rel).then(b => {
        if (b) ambient.buffers[name] = b; else missing.push(rel);
      }));
    }
    await Promise.allSettled(jobs);
    stats.filesLoaded = sfxBuffers.size + Object.keys(ambient.buffers).length;
    stats.filesMissing = missing;
    return { loaded: stats.filesLoaded, missing };
  }

  async function loadBuffer(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.arrayBuffer();
      return await ctx.decodeAudioData(raw);
    } catch (err) {
      console.warn('[audio] missing or unreadable:', url, err.message);
      return null;
    }
  }

  function playBuffer(buffer, { gain = 1, rate = 1 } = {}) {
    if (!ensure() || !buffer) return false;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g); g.connect(sfxGain);
      src.start();
      return true;
    } catch { return false; }
  }

  function fire(name, { rate = 1 } = {}) {
    count(name);
    const gain = SFX_GAIN[name] ?? 1;
    const buffer = sfxBuffers.get(name);
    if (buffer) playBuffer(buffer, { gain, rate });
    else synthFallback[name]?.();
  }

  // ---- one-shot synth voices (fallback when a file is missing) ----
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

  // ---- event voices: file first, synth fallback ----
  const synthFallback = {
    perfect() { tone({ freq: 660, slideTo: 990, dur: 0.16, type: 'triangle', gain: 0.5 }); tone({ freq: 990, dur: 0.12, delay: 0.07, gain: 0.35 }); },
    good() { tone({ freq: 520, dur: 0.1, type: 'sine', gain: 0.4 }); },
    miss() { tone({ freq: 200, slideTo: 90, dur: 0.25, type: 'sawtooth', gain: 0.4 }); },
    tierUp() { tone({ freq: 330, slideTo: 880, dur: 0.3, type: 'square', gain: 0.25 }); },
    tierDown() { tone({ freq: 440, slideTo: 160, dur: 0.35, type: 'square', gain: 0.25 }); },
    planeEnter() { tone({ freq: 220, slideTo: 1320, dur: 0.5, type: 'sawtooth', gain: 0.3 }); },
    planeExit() { tone({ freq: 1320, slideTo: 220, dur: 0.5, type: 'sawtooth', gain: 0.3 }); },
    coin() { tone({ freq: 1200, dur: 0.07, type: 'sine', gain: 0.4 }); tone({ freq: 1800, dur: 0.09, delay: 0.06, gain: 0.35 }); },
    collision() { noise({ dur: 0.25, gain: 0.5, cutoff: 900 }); },
    collisionMajor() { noise({ dur: 0.4, gain: 0.7, cutoff: 500 }); tone({ freq: 140, slideTo: 60, dur: 0.3, type: 'sawtooth', gain: 0.4 }); },
    splash() { noise({ dur: 0.3, gain: 0.35, cutoff: 2400 }); },
    ui() { tone({ freq: 700, dur: 0.06, type: 'sine', gain: 0.3 }); },
    runEnd() { tone({ freq: 300, slideTo: 120, dur: 0.6, type: 'triangle', gain: 0.4 }); },
  };

  const sfx = {
    perfect: () => fire('perfect'),
    good: () => fire('good'),
    miss: () => fire('miss'),
    tierUp: () => fire('tierUp'),
    tierDown: () => fire('tierDown'),
    coin: () => fire('coin'),
    collision: () => fire('collision'),
    collisionMajor: () => fire('collisionMajor'),
    splash: () => fire('splash'),
    ui: () => fire('ui'),
    runEnd: () => fire('runEnd'),
    planeEnter: () => fire('planeEnter', { rate: 1.12 }), // no dedicated plane sting; pitch-lifted power-up
    planeExit: () => fire('planeExit'),
  };

  // ---- ambient loops: waves (always) + wind (volume follows speed) ----
  function startAmbient() {
    if (!ensure() || ambient.nodes) return;
    try {
      ambient.nodes = [];
      if (ambient.buffers.waves) {
        const src = loopSource(ambient.buffers.waves, 0.05);
        ambient.nodes.push(src);
      }
      if (ambient.buffers.wind) {
        ambient.windGain = ctx.createGain();
        ambient.windGain.gain.value = 0;
        const src = ctx.createBufferSource();
        src.buffer = ambient.buffers.wind;
        src.loop = true;
        src.connect(ambient.windGain);
        ambient.windGain.connect(musicGain); // wind sits with music, not SFX
        src.start();
        ambient.nodes.push(src);
      }
    } catch { /* ambient is optional */ }
  }

  function loopSource(buffer, gainValue) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gainValue;
    src.connect(g);
    g.connect(musicGain);
    src.start();
    return src;
  }

  function stopAmbient() {
    if (!ambient.nodes) return;
    for (const src of ambient.nodes) { try { src.stop(); } catch { /* already stopped */ } }
    ambient.nodes = null;
    ambient.windGain = null;
  }

  // wind intensity 0..1 rises with speed
  function setWind(intensity) {
    if (!ambient.windGain || !ctx) return;
    try {
      ambient.windGain.gain.setTargetAtTime(Math.min(0.22, Math.max(0, intensity * 0.22)), ctx.currentTime, 0.3);
    } catch { /* optional */ }
  }

  // ---- synth music bed (fallback when adaptive music files are absent) ----
  const TIER_INTENSITY = { none: 0, low: 0.25, medium: 0.5, high: 0.75, max: 1 };

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
    } catch { /* music is optional */ }
  }

  function stopMusic() {
    if (!musicNodes) return;
    for (const node of Object.values(musicNodes)) {
      try { node.stop?.(); node.disconnect?.(); } catch { /* ignore */ }
    }
    musicNodes = null;
  }

  function setMusicIntensity(tier) {
    const target = TIER_INTENSITY[tier] ?? 0;
    if (musicNodes && ctx) {
      try { musicNodes.filter.frequency.value = 400 + target * 2600; } catch { /* ignore */ }
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
    bus.on('plane:enter', sfx.planeEnter);
    bus.on('plane:exit', sfx.planeExit);
    bus.on('run:end', sfx.runEnd);
    bus.on('run:start', () => { resume(); startAmbient(); }); // music: synth vs files decided in main.js
    bus.on('ui:menu', stopAmbient);
  }

  return {
    resume, applySettings, setMusicIntensity, startMusic, stopMusic, stopAmbient, setWind,
    loadFiles, sfx, stats, getContext, musicBus,
  };
}
