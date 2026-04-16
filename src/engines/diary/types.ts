export type DiaryMood = 'great' | 'good' | 'neutral' | 'low' | 'bad';

export interface DiaryEntry {
  id: string;
  projectId: string;
  /** The moment being recorded (ISO string: YYYY-MM-DDTHH:mm) */
  entryDate: string;
  /** Short title / headline (optional) */
  title: string;
  /** Rich text body */
  content: string;
  /** Optional mood tag */
  mood?: DiaryMood;
  /** Freeform tags */
  tags: string[];
  /** Pinned entries float to the top of the day */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export const MOOD_CONFIG: Record<DiaryMood, { label: string; emoji: string; color: string }> = {
  great: { label: 'Great', emoji: '\u2728', color: 'text-yellow-400' },
  good:  { label: 'Good',  emoji: '\ud83d\ude0a', color: 'text-green-400' },
  neutral: { label: 'Neutral', emoji: '\ud83d\ude10', color: 'text-gray-400' },
  low:   { label: 'Low',   emoji: '\ud83d\ude14', color: 'text-blue-400' },
  bad:   { label: 'Bad',   emoji: '\ud83d\ude1e', color: 'text-red-400' },
};
