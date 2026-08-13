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

export const MOOD_CONFIG: Record<DiaryMood, { labelKey: string; emoji: string; color: string }> = {
  great: { labelKey: 'diary.mood.great', emoji: '\u2728', color: 'text-yellow-400' },
  good:  { labelKey: 'diary.mood.good',  emoji: '\ud83d\ude0a', color: 'text-green-400' },
  neutral: { labelKey: 'diary.mood.neutral', emoji: '\ud83d\ude10', color: 'text-gray-400' },
  low:   { labelKey: 'diary.mood.low',   emoji: '\ud83d\ude14', color: 'text-blue-400' },
  bad:   { labelKey: 'diary.mood.bad',   emoji: '\ud83d\ude1e', color: 'text-red-400' },
};
