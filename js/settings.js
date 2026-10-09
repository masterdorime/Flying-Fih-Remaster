// Settings: defaults, validation, and guarded localStorage access (PRD §21, §25).

const DEFAULTS = {
  master: 0.8,
  music: 0.5,
  sfx: 0.9,
  cameraShake: 0.7,
  postFx: 0.7,
  sensitivity: 1.0,
  assist: false,
};

const RANGES = {
  master: [0, 1], music: [0, 1], sfx: [0, 1], cameraShake: [0, 1], postFx: [0, 1], sensitivity: [0.2, 2],
};

export function defaultSettings() { return { ...DEFAULTS }; }

function clampNumber(v, [lo, hi], fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Merge unknown/corrupt stored data over defaults; clamps everything into range.
export function mergeSettings(stored) {
  const s = defaultSettings();
  if (!stored || typeof stored !== 'object') return s;
  for (const key of Object.keys(RANGES)) {
    if (key in stored) s[key] = clampNumber(stored[key], RANGES[key], DEFAULTS[key]);
  }
  s.assist = typeof stored.assist === 'boolean' ? stored.assist : DEFAULTS.assist;
  return s;
}

export function loadSettings(storage) {
  try {
    return mergeSettings(JSON.parse(storage.getItem('ffm.settings') || '{}'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem('ffm.settings', JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function loadBest(storage, key) {
  try {
    const v = Number(storage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveBest(storage, key, value) {
  try {
    storage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}
