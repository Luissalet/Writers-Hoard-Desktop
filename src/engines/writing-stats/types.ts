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
