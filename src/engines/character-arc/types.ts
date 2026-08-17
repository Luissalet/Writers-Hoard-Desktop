// ============================================
// Character Arc Tracker — Types
// ============================================
//
// A character arc answers: "Who does this character become, and why?"
//
// The core frame (adapted from K.M. Weiland and Robert McKee):
//   • Ghost      — the wound from the past that still shapes them
//   • Lie        — the false belief they hold at the start
//   • Truth      — the truth that will set them free
//   • Want       — what they consciously pursue (often rooted in the Lie)
//   • Need       — what they actually require to heal (rooted in the Truth)
//
// Arc beats then trace the character's interior journey over the story
// (Weak, Flaw, Denial, Commitment, Growth, Climax, Resolution).
// ============================================

export type ArcStatus = 'planning' | 'drafting' | 'revised' | 'done';

export type ArcBeatStage =
  | 'ghost'            // the foundational wound
  | 'weak'             // we meet them in their flawed state
  | 'flaw'             // the lie is tested
  | 'denial'           // they double down
  | 'inciting'         // something cracks the armor
  | 'commitment'       // they commit (or refuse) change
  | 'growth'           // they try on the truth
  | 'moment-of-truth'  // the final test
  | 'climax'           // the choice that proves who they are
  | 'resolution';      // the new normal

export interface CharacterArc {
  id: string;
  projectId: string;
  /** Free-form title — often "Anna's redemption" or "The Fall of Ivan" */
  title: string;
  /** Link to a codex entry (character), if one exists */
  characterId?: string;
  /** Display name of the character (kept separately for quick access) */
  characterName?: string;
  /** Which template (see ARC_TEMPLATES) was used — optional */
  templateId?: ArcTemplateId;
  /** Ghost: the past wound */
  ghost: string;
  /** The false belief */
  lie: string;
  /** The truth that frees them */
  truth: string;
  /** What they actively pursue */
  want: string;
  /** What they need to heal / grow */
  need: string;
  /** One-paragraph summary of the arc */
  summary: string;
  /** Overall status of the arc */
  status: ArcStatus;
  /** Optional hex color for visual coding */
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArcBeat {
  id: string;
  arcId: string;
  projectId: string;
  order: number;
  /** Which stage of the arc this beat belongs to */
  stage: ArcBeatStage;
  title: string;
  description: string;
  /** Short tag like "Hope", "Fear", "Determined" — drives the emotion chart */
  emotion?: string;
  /** 0-100, when in the story this beat fires */
  storyPosition?: number;
  /** Optional link to an Outline beat */
  linkedBeatId?: string;
  /** Optional link to a Scene */
  linkedSceneId?: string;
  status: ArcStatus;
  createdAt: number;
  updatedAt: number;
}

// ===== Arc Templates =====

export type ArcTemplateId =
  | 'positive-change'
  | 'negative-fall'
  | 'negative-corruption'
  | 'negative-disillusionment'
  | 'flat';

export interface ArcTemplate {
  id: ArcTemplateId;
  /** i18n key — resolve with t() before displaying */
  nameKey: string;
  /** i18n key — resolve with t() before displaying */
  descriptionKey: string;
  /** i18n keys for the Ghost → Need prompts, shown as placeholders in the editor */
  promptKeys: {
    ghost: string;
    lie: string;
    truth: string;
    want: string;
    need: string;
  };
  beats: Array<{
    stage: ArcBeatStage;
    /** i18n key — MUST be resolved before the beat is written to the DB */
    titleKey: string;
    /** i18n key — MUST be resolved before the beat is written to the DB */
    descriptionKey: string;
    storyPosition?: number;
    /** i18n key — MUST be resolved before the beat is written to the DB */
    emotionKey?: string;
  }>;
}

export const ARC_TEMPLATES: ArcTemplate[] = [
  {
    id: 'positive-change',
    nameKey: 'characterArc.template.positive-change.name',
    descriptionKey: 'characterArc.template.positive-change.description',
    promptKeys: {
      ghost: 'characterArc.template.positive-change.prompt.1',
      lie: 'characterArc.template.positive-change.prompt.2',
      truth: 'characterArc.template.positive-change.prompt.3',
      want: 'characterArc.template.positive-change.prompt.4',
      need: 'characterArc.template.positive-change.prompt.5',
    },
    beats: [
      { stage: 'ghost', titleKey: 'characterArc.template.positive-change.beat.1.title', descriptionKey: 'characterArc.template.positive-change.beat.1.description', storyPosition: 0, emotionKey: 'characterArc.template.positive-change.beat.1.emotion' },
      { stage: 'weak', titleKey: 'characterArc.template.positive-change.beat.2.title', descriptionKey: 'characterArc.template.positive-change.beat.2.description', storyPosition: 4, emotionKey: 'characterArc.template.positive-change.beat.2.emotion' },
      { stage: 'flaw', titleKey: 'characterArc.template.positive-change.beat.3.title', descriptionKey: 'characterArc.template.positive-change.beat.3.description', storyPosition: 15, emotionKey: 'characterArc.template.positive-change.beat.3.emotion' },
      { stage: 'denial', titleKey: 'characterArc.template.positive-change.beat.4.title', descriptionKey: 'characterArc.template.positive-change.beat.4.description', storyPosition: 25, emotionKey: 'characterArc.template.positive-change.beat.4.emotion' },
      { stage: 'inciting', titleKey: 'characterArc.template.positive-change.beat.5.title', descriptionKey: 'characterArc.template.positive-change.beat.5.description', storyPosition: 40, emotionKey: 'characterArc.template.positive-change.beat.5.emotion' },
      { stage: 'commitment', titleKey: 'characterArc.template.positive-change.beat.6.title', descriptionKey: 'characterArc.template.positive-change.beat.6.description', storyPosition: 50, emotionKey: 'characterArc.template.positive-change.beat.6.emotion' },
      { stage: 'growth', titleKey: 'characterArc.template.positive-change.beat.7.title', descriptionKey: 'characterArc.template.positive-change.beat.7.description', storyPosition: 65, emotionKey: 'characterArc.template.positive-change.beat.7.emotion' },
      { stage: 'moment-of-truth', titleKey: 'characterArc.template.positive-change.beat.8.title', descriptionKey: 'characterArc.template.positive-change.beat.8.description', storyPosition: 75, emotionKey: 'characterArc.template.positive-change.beat.8.emotion' },
      { stage: 'climax', titleKey: 'characterArc.template.positive-change.beat.9.title', descriptionKey: 'characterArc.template.positive-change.beat.9.description', storyPosition: 90, emotionKey: 'characterArc.template.positive-change.beat.9.emotion' },
      { stage: 'resolution', titleKey: 'characterArc.template.positive-change.beat.10.title', descriptionKey: 'characterArc.template.positive-change.beat.10.description', storyPosition: 100, emotionKey: 'characterArc.template.positive-change.beat.10.emotion' },
    ],
  },
  {
    id: 'negative-fall',
    nameKey: 'characterArc.template.negative-fall.name',
    descriptionKey: 'characterArc.template.negative-fall.description',
    promptKeys: {
      ghost: 'characterArc.template.negative-fall.prompt.1',
      lie: 'characterArc.template.negative-fall.prompt.2',
      truth: 'characterArc.template.negative-fall.prompt.3',
      want: 'characterArc.template.negative-fall.prompt.4',
      need: 'characterArc.template.negative-fall.prompt.5',
    },
    beats: [
      { stage: 'ghost', titleKey: 'characterArc.template.negative-fall.beat.1.title', descriptionKey: 'characterArc.template.negative-fall.beat.1.description', storyPosition: 0, emotionKey: 'characterArc.template.negative-fall.beat.1.emotion' },
      { stage: 'weak', titleKey: 'characterArc.template.negative-fall.beat.2.title', descriptionKey: 'characterArc.template.negative-fall.beat.2.description', storyPosition: 10, emotionKey: 'characterArc.template.negative-fall.beat.2.emotion' },
      { stage: 'inciting', titleKey: 'characterArc.template.negative-fall.beat.3.title', descriptionKey: 'characterArc.template.negative-fall.beat.3.description', storyPosition: 25, emotionKey: 'characterArc.template.negative-fall.beat.3.emotion' },
      { stage: 'denial', titleKey: 'characterArc.template.negative-fall.beat.4.title', descriptionKey: 'characterArc.template.negative-fall.beat.4.description', storyPosition: 40, emotionKey: 'characterArc.template.negative-fall.beat.4.emotion' },
      { stage: 'commitment', titleKey: 'characterArc.template.negative-fall.beat.5.title', descriptionKey: 'characterArc.template.negative-fall.beat.5.description', storyPosition: 60, emotionKey: 'characterArc.template.negative-fall.beat.5.emotion' },
      { stage: 'moment-of-truth', titleKey: 'characterArc.template.negative-fall.beat.6.title', descriptionKey: 'characterArc.template.negative-fall.beat.6.description', storyPosition: 80, emotionKey: 'characterArc.template.negative-fall.beat.6.emotion' },
      { stage: 'climax', titleKey: 'characterArc.template.negative-fall.beat.7.title', descriptionKey: 'characterArc.template.negative-fall.beat.7.description', storyPosition: 92, emotionKey: 'characterArc.template.negative-fall.beat.7.emotion' },
      { stage: 'resolution', titleKey: 'characterArc.template.negative-fall.beat.8.title', descriptionKey: 'characterArc.template.negative-fall.beat.8.description', storyPosition: 100, emotionKey: 'characterArc.template.negative-fall.beat.8.emotion' },
    ],
  },
  {
    id: 'negative-corruption',
    nameKey: 'characterArc.template.negative-corruption.name',
    descriptionKey: 'characterArc.template.negative-corruption.description',
    promptKeys: {
      ghost: 'characterArc.template.negative-corruption.prompt.1',
      lie: 'characterArc.template.negative-corruption.prompt.2',
      truth: 'characterArc.template.negative-corruption.prompt.3',
      want: 'characterArc.template.negative-corruption.prompt.4',
      need: 'characterArc.template.negative-corruption.prompt.5',
    },
    beats: [
      { stage: 'ghost', titleKey: 'characterArc.template.negative-corruption.beat.1.title', descriptionKey: 'characterArc.template.negative-corruption.beat.1.description', storyPosition: 0, emotionKey: 'characterArc.template.negative-corruption.beat.1.emotion' },
      { stage: 'weak', titleKey: 'characterArc.template.negative-corruption.beat.2.title', descriptionKey: 'characterArc.template.negative-corruption.beat.2.description', storyPosition: 8, emotionKey: 'characterArc.template.negative-corruption.beat.2.emotion' },
      { stage: 'inciting', titleKey: 'characterArc.template.negative-corruption.beat.3.title', descriptionKey: 'characterArc.template.negative-corruption.beat.3.description', storyPosition: 25, emotionKey: 'characterArc.template.negative-corruption.beat.3.emotion' },
      { stage: 'flaw', titleKey: 'characterArc.template.negative-corruption.beat.4.title', descriptionKey: 'characterArc.template.negative-corruption.beat.4.description', storyPosition: 40, emotionKey: 'characterArc.template.negative-corruption.beat.4.emotion' },
      { stage: 'commitment', titleKey: 'characterArc.template.negative-corruption.beat.5.title', descriptionKey: 'characterArc.template.negative-corruption.beat.5.description', storyPosition: 60, emotionKey: 'characterArc.template.negative-corruption.beat.5.emotion' },
      { stage: 'denial', titleKey: 'characterArc.template.negative-corruption.beat.6.title', descriptionKey: 'characterArc.template.negative-corruption.beat.6.description', storyPosition: 75, emotionKey: 'characterArc.template.negative-corruption.beat.6.emotion' },
      { stage: 'climax', titleKey: 'characterArc.template.negative-corruption.beat.7.title', descriptionKey: 'characterArc.template.negative-corruption.beat.7.description', storyPosition: 92, emotionKey: 'characterArc.template.negative-corruption.beat.7.emotion' },
      { stage: 'resolution', titleKey: 'characterArc.template.negative-corruption.beat.8.title', descriptionKey: 'characterArc.template.negative-corruption.beat.8.description', storyPosition: 100, emotionKey: 'characterArc.template.negative-corruption.beat.8.emotion' },
    ],
  },
  {
    id: 'negative-disillusionment',
    nameKey: 'characterArc.template.negative-disillusionment.name',
    descriptionKey: 'characterArc.template.negative-disillusionment.description',
    promptKeys: {
      ghost: 'characterArc.template.negative-disillusionment.prompt.1',
      lie: 'characterArc.template.negative-disillusionment.prompt.2',
      truth: 'characterArc.template.negative-disillusionment.prompt.3',
      want: 'characterArc.template.negative-disillusionment.prompt.4',
      need: 'characterArc.template.negative-disillusionment.prompt.5',
    },
    beats: [
      { stage: 'weak', titleKey: 'characterArc.template.negative-disillusionment.beat.1.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.1.description', storyPosition: 8, emotionKey: 'characterArc.template.negative-disillusionment.beat.1.emotion' },
      { stage: 'inciting', titleKey: 'characterArc.template.negative-disillusionment.beat.2.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.2.description', storyPosition: 25, emotionKey: 'characterArc.template.negative-disillusionment.beat.2.emotion' },
      { stage: 'flaw', titleKey: 'characterArc.template.negative-disillusionment.beat.3.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.3.description', storyPosition: 45, emotionKey: 'characterArc.template.negative-disillusionment.beat.3.emotion' },
      { stage: 'moment-of-truth', titleKey: 'characterArc.template.negative-disillusionment.beat.4.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.4.description', storyPosition: 70, emotionKey: 'characterArc.template.negative-disillusionment.beat.4.emotion' },
      { stage: 'climax', titleKey: 'characterArc.template.negative-disillusionment.beat.5.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.5.description', storyPosition: 90, emotionKey: 'characterArc.template.negative-disillusionment.beat.5.emotion' },
      { stage: 'resolution', titleKey: 'characterArc.template.negative-disillusionment.beat.6.title', descriptionKey: 'characterArc.template.negative-disillusionment.beat.6.description', storyPosition: 100, emotionKey: 'characterArc.template.negative-disillusionment.beat.6.emotion' },
    ],
  },
  {
    id: 'flat',
    nameKey: 'characterArc.template.flat.name',
    descriptionKey: 'characterArc.template.flat.description',
    promptKeys: {
      ghost: 'characterArc.template.flat.prompt.1',
      lie: 'characterArc.template.flat.prompt.2',
      truth: 'characterArc.template.flat.prompt.3',
      want: 'characterArc.template.flat.prompt.4',
      need: 'characterArc.template.flat.prompt.5',
    },
    beats: [
      { stage: 'weak', titleKey: 'characterArc.template.flat.beat.1.title', descriptionKey: 'characterArc.template.flat.beat.1.description', storyPosition: 5, emotionKey: 'characterArc.template.flat.beat.1.emotion' },
      { stage: 'flaw', titleKey: 'characterArc.template.flat.beat.2.title', descriptionKey: 'characterArc.template.flat.beat.2.description', storyPosition: 25, emotionKey: 'characterArc.template.flat.beat.2.emotion' },
      { stage: 'inciting', titleKey: 'characterArc.template.flat.beat.3.title', descriptionKey: 'characterArc.template.flat.beat.3.description', storyPosition: 45, emotionKey: 'characterArc.template.flat.beat.3.emotion' },
      { stage: 'moment-of-truth', titleKey: 'characterArc.template.flat.beat.4.title', descriptionKey: 'characterArc.template.flat.beat.4.description', storyPosition: 70, emotionKey: 'characterArc.template.flat.beat.4.emotion' },
      { stage: 'climax', titleKey: 'characterArc.template.flat.beat.5.title', descriptionKey: 'characterArc.template.flat.beat.5.description', storyPosition: 90, emotionKey: 'characterArc.template.flat.beat.5.emotion' },
      { stage: 'resolution', titleKey: 'characterArc.template.flat.beat.6.title', descriptionKey: 'characterArc.template.flat.beat.6.description', storyPosition: 100, emotionKey: 'characterArc.template.flat.beat.6.emotion' },
    ],
  },
];

export const ARC_STAGE_CONFIG: Record<ArcBeatStage, { labelKey: string; color: string; order: number }> = {
  ghost:            { labelKey: 'characterArc.stage.ghost',            color: '#6b7280', order: 0 },
  weak:             { labelKey: 'characterArc.stage.weak',    color: '#94a3b8', order: 1 },
  flaw:             { labelKey: 'characterArc.stage.flaw',      color: '#f59e0b', order: 2 },
  denial:           { labelKey: 'characterArc.stage.denial',           color: '#ef4444', order: 3 },
  inciting:         { labelKey: 'characterArc.stage.inciting',         color: '#f97316', order: 4 },
  commitment:       { labelKey: 'characterArc.stage.commitment',       color: '#8b5cf6', order: 5 },
  growth:           { labelKey: 'characterArc.stage.growth',           color: '#10b981', order: 6 },
  'moment-of-truth': { labelKey: 'characterArc.stage.moment-of-truth', color: '#3b82f6', order: 7 },
  climax:           { labelKey: 'characterArc.stage.climax',           color: '#c4973b', order: 8 },
  resolution:       { labelKey: 'characterArc.stage.resolution',       color: '#6366f1', order: 9 },
};

export const ARC_STATUS_CONFIG: Record<ArcStatus, { labelKey: string; color: string }> = {
  planning: { labelKey: 'characterArc.status.planning', color: 'bg-gray-500/20 text-gray-400' },
  drafting: { labelKey: 'characterArc.status.drafting', color: 'bg-blue-500/20 text-blue-400' },
  revised:  { labelKey: 'characterArc.status.revised',  color: 'bg-amber-500/20 text-amber-400' },
  done:     { labelKey: 'characterArc.status.done',     color: 'bg-green-500/20 text-green-400' },
};
