import { create } from 'zustand';
import { getSetting, setSetting } from '@/db/operations';

export type ReadingFace = 'serif' | 'sans' | 'mono';
export type ReadingSize = 'small' | 'medium' | 'large';
export type ReadingMeasure = 'narrow' | 'wide';
/** `flow` is the continuous column; `page` sets the text on sheets with page breaks. */
export type ReadingLayout = 'flow' | 'page';
export type ReadingPageSize = 'a4' | 'letter';
export type MotionPreference = 'system' | 'reduce' | 'full';

/** How the manuscript is set. Interface chrome is not affected. */
export interface ReadingPreferences {
  face: ReadingFace;
  size: ReadingSize;
  measure: ReadingMeasure;
  layout: ReadingLayout;
  /** Only read in the `page` layout; kept so switching back restores it. */
  pageSize: ReadingPageSize;
}

/**
 * Serif, because prose is read, not operated; and a bounded measure, because
 * an unbounded one turns a chapter on a wide monitor into a single 1400px
 * line. `wide` is the roomier of the two columns — about the text width of a
 * printed page — so the change from the old full-bleed layout is a correction
 * rather than a shock. The values themselves live in `index.css`, keyed by the
 * `data-reading-*` attributes the editor writes.
 */
const DEFAULT_READING: ReadingPreferences = {
  face: 'serif',
  size: 'medium',
  measure: 'wide',
  layout: 'flow',
  pageSize: 'a4',
};

const READING_KEY = 'ui_reading';
const MOTION_KEY = 'ui_motion';
const FACES: readonly ReadingFace[] = ['serif', 'sans', 'mono'];
const SIZES: readonly ReadingSize[] = ['small', 'medium', 'large'];
const MEASURES: readonly ReadingMeasure[] = ['narrow', 'wide'];
const LAYOUTS: readonly ReadingLayout[] = ['flow', 'page'];
const PAGE_SIZES: readonly ReadingPageSize[] = ['a4', 'letter'];
const MOTION_PREFERENCES: readonly MotionPreference[] = ['system', 'reduce', 'full'];

function applyMotionPreference(preference: MotionPreference): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = preference;
  }
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function parseReading(raw: string | undefined): ReadingPreferences {
  if (!raw) return DEFAULT_READING;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return DEFAULT_READING;
    const record = stored as Record<string, unknown>;
    return {
      face: pick(FACES, record.face, DEFAULT_READING.face),
      size: pick(SIZES, record.size, DEFAULT_READING.size),
      measure: pick(MEASURES, record.measure, DEFAULT_READING.measure),
      layout: pick(LAYOUTS, record.layout, DEFAULT_READING.layout),
      pageSize: pick(PAGE_SIZES, record.pageSize, DEFAULT_READING.pageSize),
    };
  } catch {
    return DEFAULT_READING;
  }
}

interface AppState {
  sidebarOpen: boolean;
  searchOpen: boolean;
  currentProjectId: string | null;
  showEngineManager: boolean;
  reading: ReadingPreferences;
  readingLoaded: boolean;
  motion: MotionPreference;
  motionLoaded: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
  setCurrentProject: (id: string | null) => void;
  setShowEngineManager: (open: boolean) => void;
  setReading: (patch: Partial<ReadingPreferences>) => Promise<void>;
  loadReading: () => Promise<void>;
  setMotion: (preference: MotionPreference) => Promise<void>;
  loadMotion: () => Promise<void>;
}

// One read per process, shared by every caller. The editor and the settings
// modal both ask; neither of them knows about the other.
let readingRead: Promise<void> | null = null;
let motionRead: Promise<void> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  sidebarOpen: true,
  searchOpen: false,
  currentProjectId: null,
  showEngineManager: false,
  reading: DEFAULT_READING,
  readingLoaded: false,
  motion: 'system',
  motionLoaded: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setShowEngineManager: (open) => set({ showEngineManager: open }),

  setReading: async (patch) => {
    const reading = { ...get().reading, ...patch };
    set({ reading, readingLoaded: true });
    await setSetting(READING_KEY, JSON.stringify(reading));
  },

  loadReading: async () => {
    if (get().readingLoaded) return;
    // A settings table that cannot be read leaves the defaults standing, and
    // is not retried on every keystroke of every editor.
    readingRead ??= getSetting(READING_KEY)
      .then((raw) => {
        // A preference changed while the read was in flight wins over it.
        if (get().readingLoaded) return;
        set({ reading: parseReading(raw), readingLoaded: true });
      })
      .catch(() => {
        set({ readingLoaded: true });
      });
    await readingRead;
  },

  setMotion: async (motion) => {
    set({ motion, motionLoaded: true });
    applyMotionPreference(motion);
    await setSetting(MOTION_KEY, motion);
  },

  loadMotion: async () => {
    if (get().motionLoaded) return;
    motionRead ??= getSetting(MOTION_KEY)
      .then((raw) => {
        if (get().motionLoaded) return;
        const motion = pick(MOTION_PREFERENCES, raw, 'system');
        set({ motion, motionLoaded: true });
        applyMotionPreference(motion);
      })
      .catch(() => {
        set({ motionLoaded: true });
        applyMotionPreference(get().motion);
      });
    await motionRead;
  },
}));
