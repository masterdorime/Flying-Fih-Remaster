// Tiny event bus. Systems emit; UI/camera/juice/audio subscribe. Keeps modules decoupled (PRD §34.7).

export function createEventBus() {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch (err) { console.error('listener error for', type, err); }
      }
    },
  };
}

// Shared bus for the whole game.
export const bus = createEventBus();
