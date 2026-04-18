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
  name: string;
  description: string;
  /** Suggested Lie → Truth pair with example prompts */
  prompts: {
    ghost: string;
    lie: string;
    truth: string;
    want: string;
    need: string;
  };
  beats: Array<{
    stage: ArcBeatStage;
    title: string;
    description: string;
    storyPosition?: number;
    emotion?: string;
  }>;
}

export const ARC_TEMPLATES: ArcTemplate[] = [
  {
    id: 'positive-change',
    name: 'Positive Change Arc',
    description: "Character accepts the truth, rejects the lie, and is transformed. (Save the Cat's default.)",
    prompts: {
      ghost: 'What past event still haunts them?',
      lie: 'What false belief do they start with?',
      truth: 'What truth must they embrace?',
      want: 'What do they consciously chase?',
      need: 'What do they actually need to heal?',
    },
    beats: [
      { stage: 'ghost', title: 'The Ghost', description: 'The wound that made them who they are.', storyPosition: 0, emotion: 'Numb' },
      { stage: 'weak', title: 'The Characteristic Moment', description: 'We meet them locked in the Lie.', storyPosition: 4, emotion: 'Defensive' },
      { stage: 'flaw', title: 'The First Test', description: 'The Lie is challenged and they cling to it.', storyPosition: 15, emotion: 'Uneasy' },
      { stage: 'denial', title: 'Doubling Down', description: 'They prove the Lie by chasing the Want harder.', storyPosition: 25, emotion: 'Determined' },
      { stage: 'inciting', title: 'A Glimpse of Truth', description: 'Someone or something offers the Truth. They resist.', storyPosition: 40, emotion: 'Confused' },
      { stage: 'commitment', title: 'Midpoint Choice', description: 'The character acknowledges the Truth exists, but still chooses the Lie.', storyPosition: 50, emotion: 'Torn' },
      { stage: 'growth', title: 'Living the Truth', description: 'Small experiments with the Truth — it works, briefly.', storyPosition: 65, emotion: 'Hopeful' },
      { stage: 'moment-of-truth', title: 'All Is Lost', description: 'The Lie collapses. Only the Truth remains.', storyPosition: 75, emotion: 'Broken' },
      { stage: 'climax', title: 'The Choice', description: 'They act on the Truth — sacrificing the Want to meet the Need.', storyPosition: 90, emotion: 'Resolved' },
      { stage: 'resolution', title: 'New Normal', description: 'The transformed character, walking in the Truth.', storyPosition: 100, emotion: 'Peaceful' },
    ],
  },
  {
    id: 'negative-fall',
    name: 'Negative Change — Fall Arc',
    description: 'Character is offered the Truth but chooses the Lie. They fall.',
    prompts: {
      ghost: 'What wound shaped them?',
      lie: 'What comfortable lie do they hold?',
      truth: 'What truth do they refuse?',
      want: 'What vice/goal drives them?',
      need: 'What redemption is offered?',
    },
    beats: [
      { stage: 'ghost', title: 'The Ghost', description: 'Where the rot started.', storyPosition: 0, emotion: 'Wounded' },
      { stage: 'weak', title: 'Flawed Equilibrium', description: 'They seem fine, but the Lie festers.', storyPosition: 10, emotion: 'Numb' },
      { stage: 'inciting', title: 'The Offer of Truth', description: 'An ally, love, or event offers a way out.', storyPosition: 25, emotion: 'Tempted' },
      { stage: 'denial', title: 'Rejection', description: 'They refuse the Truth, chase the Want.', storyPosition: 40, emotion: 'Resentful' },
      { stage: 'commitment', title: 'Point of No Return', description: 'They do something that cannot be undone.', storyPosition: 60, emotion: 'Cold' },
      { stage: 'moment-of-truth', title: 'Realization — Too Late', description: 'They see the Truth, but the price is already paid.', storyPosition: 80, emotion: 'Despair' },
      { stage: 'climax', title: 'The Fall', description: 'Consequences arrive in full.', storyPosition: 92, emotion: 'Ruined' },
      { stage: 'resolution', title: 'The Wreckage', description: 'Who they have become — and what it cost.', storyPosition: 100, emotion: 'Hollow' },
    ],
  },
  {
    id: 'negative-corruption',
    name: 'Negative Change — Corruption Arc',
    description: 'Character starts believing the Truth but is seduced into the Lie.',
    prompts: {
      ghost: 'What made them vulnerable?',
      lie: 'What corrupting belief will tempt them?',
      truth: 'What innocence do they start with?',
      want: 'What does the Lie promise them?',
      need: 'What would keep them pure?',
    },
    beats: [
      { stage: 'ghost', title: 'Seed of Weakness', description: 'A small hairline fracture in their conviction.', storyPosition: 0, emotion: 'Unsettled' },
      { stage: 'weak', title: 'Virtuous Start', description: 'We meet them at their best, believing the Truth.', storyPosition: 8, emotion: 'Hopeful' },
      { stage: 'inciting', title: 'First Temptation', description: 'The Lie whispers. They resist — barely.', storyPosition: 25, emotion: 'Tempted' },
      { stage: 'flaw', title: 'Small Compromise', description: 'A tiny surrender that seems harmless.', storyPosition: 40, emotion: 'Justifying' },
      { stage: 'commitment', title: 'Crossing the Line', description: 'They do something the old them would never do.', storyPosition: 60, emotion: 'Powerful' },
      { stage: 'denial', title: 'Burning Bridges', description: 'They push away those who remind them of the Truth.', storyPosition: 75, emotion: 'Isolated' },
      { stage: 'climax', title: 'Full Corruption', description: 'They become the thing they feared.', storyPosition: 92, emotion: 'Triumphant-Hollow' },
      { stage: 'resolution', title: 'The Mask', description: 'A monster wearing a familiar face.', storyPosition: 100, emotion: 'Cold' },
    ],
  },
  {
    id: 'negative-disillusionment',
    name: 'Negative Change — Disillusionment Arc',
    description: 'Character learns the Truth — and it crushes them.',
    prompts: {
      ghost: 'What illusion were they raised in?',
      lie: 'What comforting belief anchors them?',
      truth: 'What harsh reality will they uncover?',
      want: 'What do they pursue inside the illusion?',
      need: 'What does the truth cost them?',
    },
    beats: [
      { stage: 'weak', title: 'The Believer', description: 'They live inside a beautiful illusion.', storyPosition: 8, emotion: 'Sheltered' },
      { stage: 'inciting', title: 'First Crack', description: 'Something does not fit the Lie.', storyPosition: 25, emotion: 'Curious' },
      { stage: 'flaw', title: 'Deeper Investigation', description: 'They chase the inconsistency.', storyPosition: 45, emotion: 'Uneasy' },
      { stage: 'moment-of-truth', title: 'Revelation', description: 'The Truth lands — and the world changes.', storyPosition: 70, emotion: 'Devastated' },
      { stage: 'climax', title: 'Disillusioned Choice', description: 'They act in the bleak new world.', storyPosition: 90, emotion: 'Hardened' },
      { stage: 'resolution', title: 'After', description: 'Wiser, sadder, smaller.', storyPosition: 100, emotion: 'Weary' },
    ],
  },
  {
    id: 'flat',
    name: 'Flat Arc',
    description: 'Character holds the Truth from the start — and changes the world around them.',
    prompts: {
      ghost: 'What forged their conviction?',
      lie: 'What lie does the world around them hold?',
      truth: 'What truth do they carry into the story?',
      want: 'What mission do they pursue?',
      need: 'What must they preserve in themselves?',
    },
    beats: [
      { stage: 'weak', title: 'Grounded in Truth', description: 'We meet them already believing the Truth.', storyPosition: 5, emotion: 'Calm' },
      { stage: 'flaw', title: 'World Tests Them', description: 'The Lie of the world pushes against them.', storyPosition: 25, emotion: 'Steady' },
      { stage: 'inciting', title: 'Allies Doubt', description: 'Those around them waver.', storyPosition: 45, emotion: 'Patient' },
      { stage: 'moment-of-truth', title: 'Moment of Doubt', description: 'Even they flicker — then hold.', storyPosition: 70, emotion: 'Resolute' },
      { stage: 'climax', title: 'Truth Wins', description: 'They demonstrate the Truth at maximum cost.', storyPosition: 90, emotion: 'Triumphant' },
      { stage: 'resolution', title: 'Ripples', description: 'The world around them has shifted.', storyPosition: 100, emotion: 'Vindicated' },
    ],
  },
];

export const ARC_STAGE_CONFIG: Record<ArcBeatStage, { label: string; color: string; order: number }> = {
  ghost:            { label: 'Ghost',            color: '#6b7280', order: 0 },
  weak:             { label: 'Weak / Flawed',    color: '#94a3b8', order: 1 },
  flaw:             { label: 'Flaw Tested',      color: '#f59e0b', order: 2 },
  denial:           { label: 'Denial',           color: '#ef4444', order: 3 },
  inciting:         { label: 'Inciting',         color: '#f97316', order: 4 },
  commitment:       { label: 'Commitment',       color: '#8b5cf6', order: 5 },
  growth:           { label: 'Growth',           color: '#10b981', order: 6 },
  'moment-of-truth': { label: 'Moment of Truth', color: '#3b82f6', order: 7 },
  climax:           { label: 'Climax',           color: '#c4973b', order: 8 },
  resolution:       { label: 'Resolution',       color: '#6366f1', order: 9 },
};

export const ARC_STATUS_CONFIG: Record<ArcStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-gray-500/20 text-gray-400' },
  drafting: { label: 'Drafting', color: 'bg-blue-500/20 text-blue-400' },
  revised:  { label: 'Revised',  color: 'bg-amber-500/20 text-amber-400' },
  done:     { label: 'Done',     color: 'bg-green-500/20 text-green-400' },
};
