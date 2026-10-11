// AdaptiveMusicController — momentum-reactive soundtrack.
//
// Full-track ladder: exactly one music track plays at a time. As normalized
// momentum (0..1) rises, the engine crossfades to the next rung of the ladder
// (calm -> mid -> high -> max) and back down. Tracks never restart, never jump
// in volume, and stay beat-locked because sources keep looping while only
// per-track gain ramps run.
//
// Design rules honored:
//  - clean API: setMomentum(0..1), play(), pause(), mute(), setVolume()
//  - configurable thresholds / volumes / transition durations / hysteresis
//  - optional playback-rate response (default OFF)
//  - audio starts only after a user gesture (play() resumes the context)
//  - missing/broken files skip that rung; never throws
//  - knows nothing about the game — game feeds it momentum, nothing else

const DEFAULT_CONFIG = {
  dir: 'assets/audio/music/',
  ladder: [
    { id: 'calm', file: 'calm.mp3', at: 0.0, volume: 0.9 },
    { id: 'mid', file: 'mid.mp3', at: 0.3, volume: 0.9 },
    { id: 'high', file: 'high.m4a', at: 0.6, volume: 0.95 },
    { id: 'max', file: 'max.m4a', at: 0.85, volume: 1.0 },
  ],
  menuTrack: { id: 'menu', file: 'menu.mp3', volume: 0.85 },
  transitionSeconds: 1.5,   // crossfade length between rungs
  hysteresis: 0.02,         // deadband so a hovering momentum doesn't stutter swaps
  loopCrossfadeSeconds: 0.35, // tail->head crossfade baked into each buffer (Suno songs have tails)
  playbackRateResponse: 0,  // 0 = off; e.g. 0.12 gives a subtle pitch/lift at max momentum
};

export function createAdaptiveMusicController({ ctx, destination, config = {} }) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
    ladder: config.ladder ?? DEFAULT_CONFIG.ladder,
  };

  const tracks = new Map(); // id -> { id, file, buffer, gain, source, rungIndex|null, volume }
  const failed = new Set();
  let musicBus = null;   // music volume + mute, before destination
  let muteGain = null;
  let volume = 1;
  let muted = false;
  let playing = false;
  let pendingPlay = false;
  let currentRung = -1;      // ladder index
  let momentum = 0;
  let lastSwapAt = -Infinity;
  let started = false;

  function now() { return ctx ? ctx.currentTime : 0; }

  function ensureGraph() {
    if (!ctx || musicBus) return;
    musicBus = ctx.createGain();
    musicBus.gain.value = volume;
    muteGain = ctx.createGain();
    muteGain.gain.value = muted ? 0 : 1;
    musicBus.connect(muteGain);
    muteGain.connect(destination ?? ctx.destination);
  }

  // ---- loading ----
  async function loadTrack(entry) {
    if (!ctx) return null;
    const url = cfg.dir + encodeURIComponent(entry.file);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const raw = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);
    return applyLoopCrossfade(decoded, cfg.loopCrossfadeSeconds);
  }

  // Bake a short tail->head crossfade so songs that end with an outro still
  // loop seamlessly. Mixes the final F samples into the first F samples with
  // equal-power curves, then shortens the loop region accordingly.
  function applyLoopCrossfade(buffer, seconds) {
    if (!seconds || seconds <= 0) return buffer;
    try {
      const F = Math.min(Math.floor(buffer.sampleRate * seconds), Math.floor(buffer.length / 4));
      if (F < 64) return buffer;
      const ch = buffer.numberOfChannels;
      const N = buffer.length;
      for (let c = 0; c < ch; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < F; i++) {
          const t = i / F;
          const fadeIn = Math.sin((t * Math.PI) / 2);       // tail rises in
          const fadeOut = Math.cos((t * Math.PI) / 2);      // head falls out
          data[i] = data[i] * fadeOut + data[N - F + i] * fadeIn;
        }
      }
      buffer._loopEnd = N - F; // consumers use this as loopEnd
    } catch { /* buffer edit is best-effort */ }
    return buffer;
  }

  function makeSource(track) {
    const src = ctx.createBufferSource();
    src.buffer = track.buffer;
    src.loop = true;
    if (track.buffer._loopEnd && track.buffer._loopEnd > 48000) {
      src.loopEnd = track.buffer._loopEnd / track.buffer.sampleRate;
    }
    return src;
  }

  function wireTrack(entry, buffer, rungIndex) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const track = { id: entry.id, file: entry.file, buffer, gain, source: null, rungIndex, volume: entry.volume ?? 1, target: 0 };
    tracks.set(entry.id, track);
    if (started) attachSource(track);
    return track;
  }

  // Single place that moves a track's volume. Keeps a JS-side target as the
  // source of truth for the ramp (param.value is unreliable in headless
  // browsers without an audio device, and the panel/tests need a stable readout).
  function setTrackGain(track, value, seconds) {
    track.target = value;
    ramp(track.gain, value, seconds);
  }

  function attachSource(track) {
    if (track.source) return;
    try {
      const src = makeSource(track);
      src.connect(track.gain);
      track.gain.connect(musicBus);
      src.start(now() + 0.05); // tiny delay lets all sources start together
      track.source = src;
    } catch { /* audio optional */ }
  }

  async function load(files) {
    if (!ctx) return { loaded: 0, failed: [] };
    ensureGraph();
    const entries = [];
    if (files) entries.push(...files);
    else {
      cfg.ladder.forEach((rung, i) => entries.push({ ...rung, rungIndex: i }));
      if (cfg.menuTrack) entries.push({ ...cfg.menuTrack, rungIndex: -1 });
    }
    const results = await Promise.allSettled(entries.map(async entry => {
      const buffer = await loadTrack(entry);
      wireTrack(entry, buffer, entry.rungIndex ?? -1);
      return entry.id;
    }));
    const failedIds = results.map((r, i) => ({ r, id: entries[i].id }))
      .filter(x => x.r.status === 'rejected')
      .map(x => { failed.add(x.id); return x.id; });
    // a play() that arrived while loading (first click before tracks decoded)
    // must not be swallowed — start as soon as the tracks are ready
    if (pendingPlay) play();
    return { loaded: results.filter(r => r.status === 'fulfilled').length, failed: failedIds };
  }

  // ---- transport ----
  function play() {
    if (!ctx) return false;
    pendingPlay = false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    ensureGraph();
    if (playing) return true;
    if (tracks.size === 0) { pendingPlay = true; return false; } // load() may finish later
    started = true;
    playing = true;
    for (const track of tracks.values()) attachSource(track);
    // enter the calm rung silently (no audible jump on first play)
    if (menuActive) applyMenuVisibility(cfg.transitionSeconds);
    else applyRung(rungForMomentum(momentum), 0.001, true);
    return true;
  }

  function pause() {
    if (!playing) return;
    playing = false;
    // fade the bus out but keep sources looping: no restart, no sync loss
    ramp(musicBus.gain, 0, cfg.transitionSeconds);
  }

  function resumePlayback() {
    if (!playing) play();
  }

  function mute(m) {
    muted = !!m;
    if (muteGain) ramp(muteGain.gain, muted ? 0 : 1, 0.15);
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    if (musicBus) musicBus.gain.value = volume;
  }

  // ---- intensity ----
  function rungForMomentum(m) {
    let idx = 0;
    for (let i = 0; i < cfg.ladder.length; i++) {
      if (m >= cfg.ladder[i].at - cfg.hysteresis) idx = i;
    }
    return idx;
  }

  function applyRung(index, fadeSeconds = cfg.transitionSeconds, silent = false) {
    const target = tracks.get(cfg.ladder[index]?.id);
    if (!target) return;
    if (currentRung === index) {
      if (playing) setTrackGain(target, target.volume, fadeSeconds);
      return;
    }
    const previous = currentRung >= 0 ? tracks.get(cfg.ladder[currentRung]?.id) : null;
    currentRung = index;
    if (previous) setTrackGain(previous, 0, fadeSeconds);
    setTrackGain(target, target.volume, fadeSeconds);
    if (playing) ramp(musicBus.gain, volume, silent ? 0.001 : fadeSeconds);
  }

  function setMomentum(m) {
    momentum = Math.min(1, Math.max(0, m));
    if (cfg.playbackRateResponse > 0) applyPlaybackRate();
    if (!playing) return currentRungId();
    if (menuActive) applyMenuVisibility();
    else applyRung(rungForMomentum(momentum));
    return currentRungId();
  }

  function applyPlaybackRate() {
    for (const track of tracks.values()) {
      if (!track.source) continue;
      try {
        track.source.playbackRate.setTargetAtTime(1 + momentum * cfg.playbackRateResponse, now(), 0.2);
      } catch { /* rate tweak is optional */ }
    }
  }

  function currentRungId() {
    return currentRung >= 0 ? cfg.ladder[currentRung]?.id : null;
  }

  function ramp(param, value, seconds) {
    if (!param) return;
    try {
      const t = now();
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(value, t + Math.max(0.01, seconds));
    } catch { param.value = value; }
  }

  // menu track plays over the calm rung when the game is in menus
  let menuActive = false;
  function applyMenuVisibility(seconds = cfg.transitionSeconds) {
    const menu = tracks.get(cfg.menuTrack?.id);
    if (!menu) return;
    for (const track of tracks.values()) {
      if (track.id === menu.id) continue;
      setTrackGain(track, 0, seconds);
    }
    setTrackGain(menu, menuActive && playing ? menu.volume : 0, seconds);
  }
  function setMenuMode(on) {
    if (!cfg.menuTrack || !tracks.has(cfg.menuTrack.id)) return;
    menuActive = !!on;
    applyMenuVisibility();
  }

  function debugState() {
    const gains = {};
    const targets = {};
    for (const track of tracks.values()) {
      gains[track.id] = Number(track.gain.gain.value.toFixed(3));
      targets[track.id] = Number(track.target.toFixed(2));
    }
    return {
      rung: currentRungId(), momentum, playing, muted, volume, menuActive,
      tracksLoaded: tracks.size, failed: [...failed], gains, targets,
      sources: Object.fromEntries([...tracks].map(([k, t]) => [k, !!t.source])),
      busGain: musicBus ? Number(musicBus.gain.value.toFixed(3)) : null,
      ctxTime: ctx ? Number(ctx.currentTime.toFixed(2)) : null,
      contextState: ctx?.state,
    };
  }

  return {
    load, play, pause, resumePlayback, mute, setVolume, setMomentum, setMenuMode,
    hasFiles: () => tracks.size > 0,
    currentRungId,
    debugState,
    config: cfg,
  };
}
