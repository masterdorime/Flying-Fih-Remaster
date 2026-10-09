import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, mergeSettings, loadSettings, saveSettings } from '../../js/settings.js';

test('defaults are within documented ranges', () => {
  const s = defaultSettings();
  assert.equal(s.master, 0.8);
  assert.equal(s.assist, false);
});

test('merge clamps out-of-range and rejects garbage', () => {
  const s = mergeSettings({ master: 99, music: -5, sfx: 'x', sensitivity: 0.05, assist: 'yes' });
  assert.equal(s.master, 1);
  assert.equal(s.music, 0);
  assert.equal(s.sfx, 0.9);            // garbage -> default
  assert.equal(s.sensitivity, 0.2);    // clamped to min
  assert.equal(s.assist, false);       // non-boolean -> default
});

test('load/save round-trip through storage, tolerating hostile storage', () => {
  const map = new Map();
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const saved = mergeSettings({ assist: true, master: 0.3 });
  saveSettings(storage, saved);
  const loaded = loadSettings(storage);
  assert.equal(loaded.assist, true);
  assert.equal(loaded.master, 0.3);

  const broken = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); } };
  assert.deepEqual(loadSettings(broken), defaultSettings());
  assert.equal(saveSettings(broken, saved), false);
});
