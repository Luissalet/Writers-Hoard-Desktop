export type BeatStatus = 'empty' | 'outlined' | 'drafted' | 'done';

export interface Outline {
  id: string;
  projectId: string;
  title: string;
  templateId?: string; // which beat sheet template was used
  createdAt: number;
  updatedAt: number;
}

export interface OutlineBeat {
  id: string;
  outlineId: string;
  projectId: string;
  order: number;
  /** Hierarchy: 'act' | 'chapter' | 'scene' | 'beat' */
  level: 'act' | 'chapter' | 'scene' | 'beat';
  /** Parent beat ID for nesting (acts contain chapters contain scenes) */
  parentId?: string;
  title: string;
  description: string;
  /** Percentage through the story (0-100) — for beat sheet positioning */
  storyPosition?: number;
  status: BeatStatus;
  /** Optional link to a Writing document */
  linkedWritingId?: string;
  /** Optional link to a Scene in dialog-scene engine */
  linkedSceneId?: string;
  /** Color for visual coding */
  color?: string;
  /** Word count target for this beat */
  wordTarget?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Pre-built story structure templates.
 *
 * Every user-facing string here is an i18n KEY, not display text — resolve it
 * with `t()`. This matters twice over: template text is COPIED into
 * `OutlineBeat` rows when an outline is seeded, so it must be resolved at the
 * SEED site as well as at the render site. Otherwise the author's project
 * stores raw keys (or English) forever, whatever the UI language is later.
 */
export interface BeatSheetTemplate {
  id: string;
  nameKey: string;
  descriptionKey: string;
  beats: Array<{
    level: OutlineBeat['level'];
    titleKey: string;
    descriptionKey: string;
    storyPosition?: number;
    color?: string;
  }>;
}

// ===== Beat Sheet Templates =====

const BEAT_COLORS = {
  'act': '#c4973b', // gold
  'chapter': '#7c5cbf', // purple
  'scene': '#4a9e6d', // green
  'beat': '#4a7ec4', // blue
  'save-the-cat-setup': '#e8b661',
  'save-the-cat-catalyst': '#f59e0b',
  'save-the-cat-debate': '#d97706',
  'save-the-cat-fun': '#10b981',
  'save-the-cat-midpoint': '#f97316',
  'save-the-cat-bad': '#ef4444',
  'save-the-cat-dark': '#6b7280',
  'save-the-cat-finale': '#8b5cf6',
  'save-the-cat-final': '#6366f1',
};

export const BEAT_SHEET_TEMPLATES: BeatSheetTemplate[] = [
  {
    id: 'save-the-cat',
    nameKey: 'outline.template.save-the-cat.name',
    descriptionKey: 'outline.template.save-the-cat.description',
    beats: [
      { level: 'beat', storyPosition: 0, color: BEAT_COLORS['save-the-cat-setup'],
        titleKey: 'outline.template.save-the-cat.beat.1.title',
        descriptionKey: 'outline.template.save-the-cat.beat.1.description' },
      { level: 'beat', storyPosition: 5, color: BEAT_COLORS['save-the-cat-setup'],
        titleKey: 'outline.template.save-the-cat.beat.2.title',
        descriptionKey: 'outline.template.save-the-cat.beat.2.description' },
      { level: 'beat', storyPosition: 8, color: BEAT_COLORS['save-the-cat-setup'],
        titleKey: 'outline.template.save-the-cat.beat.3.title',
        descriptionKey: 'outline.template.save-the-cat.beat.3.description' },
      { level: 'beat', storyPosition: 10, color: BEAT_COLORS['save-the-cat-catalyst'],
        titleKey: 'outline.template.save-the-cat.beat.4.title',
        descriptionKey: 'outline.template.save-the-cat.beat.4.description' },
      { level: 'beat', storyPosition: 18, color: BEAT_COLORS['save-the-cat-debate'],
        titleKey: 'outline.template.save-the-cat.beat.5.title',
        descriptionKey: 'outline.template.save-the-cat.beat.5.description' },
      { level: 'beat', storyPosition: 25, color: BEAT_COLORS['save-the-cat-debate'],
        titleKey: 'outline.template.save-the-cat.beat.6.title',
        descriptionKey: 'outline.template.save-the-cat.beat.6.description' },
      { level: 'beat', storyPosition: 22, color: BEAT_COLORS['save-the-cat-fun'],
        titleKey: 'outline.template.save-the-cat.beat.7.title',
        descriptionKey: 'outline.template.save-the-cat.beat.7.description' },
      { level: 'beat', storyPosition: 38, color: BEAT_COLORS['save-the-cat-fun'],
        titleKey: 'outline.template.save-the-cat.beat.8.title',
        descriptionKey: 'outline.template.save-the-cat.beat.8.description' },
      { level: 'beat', storyPosition: 50, color: BEAT_COLORS['save-the-cat-midpoint'],
        titleKey: 'outline.template.save-the-cat.beat.9.title',
        descriptionKey: 'outline.template.save-the-cat.beat.9.description' },
      { level: 'beat', storyPosition: 62, color: BEAT_COLORS['save-the-cat-bad'],
        titleKey: 'outline.template.save-the-cat.beat.10.title',
        descriptionKey: 'outline.template.save-the-cat.beat.10.description' },
      { level: 'beat', storyPosition: 75, color: BEAT_COLORS['save-the-cat-bad'],
        titleKey: 'outline.template.save-the-cat.beat.11.title',
        descriptionKey: 'outline.template.save-the-cat.beat.11.description' },
      { level: 'beat', storyPosition: 78, color: BEAT_COLORS['save-the-cat-dark'],
        titleKey: 'outline.template.save-the-cat.beat.12.title',
        descriptionKey: 'outline.template.save-the-cat.beat.12.description' },
      { level: 'beat', storyPosition: 80, color: BEAT_COLORS['save-the-cat-finale'],
        titleKey: 'outline.template.save-the-cat.beat.13.title',
        descriptionKey: 'outline.template.save-the-cat.beat.13.description' },
      { level: 'beat', storyPosition: 90, color: BEAT_COLORS['save-the-cat-finale'],
        titleKey: 'outline.template.save-the-cat.beat.14.title',
        descriptionKey: 'outline.template.save-the-cat.beat.14.description' },
      { level: 'beat', storyPosition: 100, color: BEAT_COLORS['save-the-cat-final'],
        titleKey: 'outline.template.save-the-cat.beat.15.title',
        descriptionKey: 'outline.template.save-the-cat.beat.15.description' },
    ],
  },
  {
    id: 'three-act',
    nameKey: 'outline.template.three-act.name',
    descriptionKey: 'outline.template.three-act.description',
    beats: [
      { level: 'act', storyPosition: 5, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.three-act.beat.1.title',
        descriptionKey: 'outline.template.three-act.beat.1.description' },
      { level: 'beat', storyPosition: 10, color: '#f59e0b',
        titleKey: 'outline.template.three-act.beat.2.title',
        descriptionKey: 'outline.template.three-act.beat.2.description' },
      { level: 'beat', storyPosition: 25, color: '#f59e0b',
        titleKey: 'outline.template.three-act.beat.3.title',
        descriptionKey: 'outline.template.three-act.beat.3.description' },
      { level: 'act', storyPosition: 35, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.three-act.beat.4.title',
        descriptionKey: 'outline.template.three-act.beat.4.description' },
      { level: 'beat', storyPosition: 50, color: '#f97316',
        titleKey: 'outline.template.three-act.beat.5.title',
        descriptionKey: 'outline.template.three-act.beat.5.description' },
      { level: 'beat', storyPosition: 75, color: '#ef4444',
        titleKey: 'outline.template.three-act.beat.6.title',
        descriptionKey: 'outline.template.three-act.beat.6.description' },
      { level: 'act', storyPosition: 85, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.three-act.beat.7.title',
        descriptionKey: 'outline.template.three-act.beat.7.description' },
      { level: 'beat', storyPosition: 95, color: '#8b5cf6',
        titleKey: 'outline.template.three-act.beat.8.title',
        descriptionKey: 'outline.template.three-act.beat.8.description' },
      { level: 'beat', storyPosition: 100, color: '#6366f1',
        titleKey: 'outline.template.three-act.beat.9.title',
        descriptionKey: 'outline.template.three-act.beat.9.description' },
    ],
  },
  {
    id: 'heros-journey',
    nameKey: 'outline.template.heros-journey.name',
    descriptionKey: 'outline.template.heros-journey.description',
    beats: [
      { level: 'beat', storyPosition: 0, color: '#6b7280',
        titleKey: 'outline.template.heros-journey.beat.1.title',
        descriptionKey: 'outline.template.heros-journey.beat.1.description' },
      { level: 'beat', storyPosition: 5, color: '#f59e0b',
        titleKey: 'outline.template.heros-journey.beat.2.title',
        descriptionKey: 'outline.template.heros-journey.beat.2.description' },
      { level: 'beat', storyPosition: 12, color: '#ef4444',
        titleKey: 'outline.template.heros-journey.beat.3.title',
        descriptionKey: 'outline.template.heros-journey.beat.3.description' },
      { level: 'beat', storyPosition: 20, color: '#10b981',
        titleKey: 'outline.template.heros-journey.beat.4.title',
        descriptionKey: 'outline.template.heros-journey.beat.4.description' },
      { level: 'beat', storyPosition: 28, color: '#8b5cf6',
        titleKey: 'outline.template.heros-journey.beat.5.title',
        descriptionKey: 'outline.template.heros-journey.beat.5.description' },
      { level: 'beat', storyPosition: 40, color: '#3b82f6',
        titleKey: 'outline.template.heros-journey.beat.6.title',
        descriptionKey: 'outline.template.heros-journey.beat.6.description' },
      { level: 'beat', storyPosition: 55, color: '#f97316',
        titleKey: 'outline.template.heros-journey.beat.7.title',
        descriptionKey: 'outline.template.heros-journey.beat.7.description' },
      { level: 'beat', storyPosition: 70, color: '#ef4444',
        titleKey: 'outline.template.heros-journey.beat.8.title',
        descriptionKey: 'outline.template.heros-journey.beat.8.description' },
      { level: 'beat', storyPosition: 80, color: '#10b981',
        titleKey: 'outline.template.heros-journey.beat.9.title',
        descriptionKey: 'outline.template.heros-journey.beat.9.description' },
      { level: 'beat', storyPosition: 85, color: '#3b82f6',
        titleKey: 'outline.template.heros-journey.beat.10.title',
        descriptionKey: 'outline.template.heros-journey.beat.10.description' },
      { level: 'beat', storyPosition: 95, color: '#8b5cf6',
        titleKey: 'outline.template.heros-journey.beat.11.title',
        descriptionKey: 'outline.template.heros-journey.beat.11.description' },
      { level: 'beat', storyPosition: 100, color: '#6366f1',
        titleKey: 'outline.template.heros-journey.beat.12.title',
        descriptionKey: 'outline.template.heros-journey.beat.12.description' },
    ],
  },
  {
    id: 'five-act',
    nameKey: 'outline.template.five-act.name',
    descriptionKey: 'outline.template.five-act.description',
    beats: [
      { level: 'act', storyPosition: 8, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.five-act.beat.1.title',
        descriptionKey: 'outline.template.five-act.beat.1.description' },
      { level: 'act', storyPosition: 28, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.five-act.beat.2.title',
        descriptionKey: 'outline.template.five-act.beat.2.description' },
      { level: 'act', storyPosition: 50, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.five-act.beat.3.title',
        descriptionKey: 'outline.template.five-act.beat.3.description' },
      { level: 'act', storyPosition: 72, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.five-act.beat.4.title',
        descriptionKey: 'outline.template.five-act.beat.4.description' },
      { level: 'act', storyPosition: 100, color: BEAT_COLORS['act'],
        titleKey: 'outline.template.five-act.beat.5.title',
        descriptionKey: 'outline.template.five-act.beat.5.description' },
    ],
  },
];

export const BEAT_STATUS_CONFIG = {
  empty: { labelKey: 'outline.status.empty', color: 'bg-gray-500/20 text-gray-400', icon: 'circle' },
  outlined: { labelKey: 'outline.status.outlined', color: 'bg-blue-500/20 text-blue-400', icon: 'check-circle' },
  drafted: { labelKey: 'outline.status.drafted', color: 'bg-amber-500/20 text-amber-400', icon: 'edit' },
  done: { labelKey: 'outline.status.done', color: 'bg-green-500/20 text-green-400', icon: 'check-circle-2' },
};

export const BEAT_LEVEL_INDENT = {
  act: 'pl-0',
  chapter: 'pl-4',
  scene: 'pl-8',
  beat: 'pl-12',
};

/** i18n keys, not display text — resolve with `t()` at the render site. */
export const BEAT_LEVEL_LABEL = {
  act: 'outline.level.act',
  chapter: 'outline.level.chapter',
  scene: 'outline.level.scene',
  beat: 'outline.level.beat',
};
