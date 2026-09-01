export interface WritingSession {
  id: string;
  projectId: string;
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** Words written in this session */
  wordCount: number;
  /** Duration in seconds */
  duration: number;
  /** Type of session */
  type: 'freewrite' | 'sprint' | 'edit' | 'outline';
  /** Optional notes about the session */
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface WritingGoal {
  id: string;
  projectId: string;
  /** 'daily' | 'project' | 'deadline' */
  type: 'daily' | 'project' | 'deadline';
  /** Target word count */
  targetWords: number;
  /** For deadline goals: ISO date string */
  deadline?: string;
  /** Whether the goal is active */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WritingStatsData {
  todayWords: number;
  todayTime: number;
  streak: number;
  totalWords: number;
  averageDaily: number;
  last7Days: Array<{ date: string; words: number }>;
}

// ============================================================================
// Writing sprints
// ============================================================================
//
// A sprint is a timed writing window with an optional word target. Unlike
// `WritingSession` these are NOT Dexie rows — they live in the `settings`
// store as one small versioned payload per project. See ./sprints.ts.

/** A sprint that has finished, as kept in the per-project sprint log. */
export interface SprintRecord {
  id: string;
  projectId: string;
  /** Wall-clock ms when the writer started it. */
  startedAt: number;
  /** Wall-clock ms when it ended: its scheduled end, or when it was stopped. */
  endedAt: number;
  /** Words the writer aimed for. `0` when they set no target. */
  targetWords: number;
  /** Net words added across the whole project inside the window. */
  actualWords: number;
  /** The writing that was open when the sprint began, when there was one. */
  writingId?: string;
  /** Present only when the writer ended it before the clock ran out. */
  stopped?: true;
}

/** The sprint currently running, rehydrated from the settings store. */
export interface ActiveSprint {
  id: string;
  projectId: string;
  startedAt: number;
  /**
   * The instant the sprint is due to end. Remaining time is always
   * `endsAt - now`, never a counter — that is what lets it survive a
   * re-render, a route change and a restart of the app.
   */
  endsAt: number;
  /** `0` when the writer set no target. */
  targetWords: number;
  /** The project's total word count at the moment the sprint started. */
  baselineWords: number;
  writingId?: string;
}

/** Last sprint setup, so starting the next one is a single click. */
export interface SprintPrefs {
  durationMinutes: number;
  /** `0` means "no target". */
  targetWords: number;
}
