import { create } from 'zustand';
import { getSetting, setSetting } from '@/db/operations';

/**
 * The writer's choice about ghost text (the faint continuation after the
 * cursor). Global, like the reading preferences: it is how this person
 * writes, not a property of one book. OFF until they turn it on — a model
 * answering while you type is something you ask for.
 */
export const GHOST_TEXT_KEY = 'ui_ghost_text';

/** Only an explicit 'true' turns it on; a missing or damaged value is off. */
export function parseGhostSetting(raw: string | null | undefined): boolean {
  return raw === 'true';
}

interface GhostTextState {
  enabled: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

// One read per process, shared by every editor that asks.
let read: Promise<void> | null = null;

export const useGhostTextStore = create<GhostTextState>((set, get) => ({
  enabled: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    read ??= getSetting(GHOST_TEXT_KEY)
      .then((raw) => {
        // A toggle clicked while the read was in flight wins over it.
        if (get().loaded) return;
        set({ enabled: parseGhostSetting(raw), loaded: true });
      })
      .catch(() => {
        set({ loaded: true });
      });
    await read;
  },

  setEnabled: async (enabled) => {
    set({ enabled, loaded: true });
    await setSetting(GHOST_TEXT_KEY, String(enabled));
  },
}));