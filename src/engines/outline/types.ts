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
  /** Tags */
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** Pre-built story structure templates */
export interface BeatSheetTemplate {
  id: string;
  name: string;
  description: string;
  beats: Array<{
    level: OutlineBeat['level'];
    title: string;
    description: string;
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
    name: 'Save the Cat!',
    description: '15-beat story structure popularized by Blake Snyder',
    beats: [
      {
        level: 'beat',
        title: 'Opening Image',
        description: 'A snapshot of the protagonist\'s world before the journey',
        storyPosition: 0,
        color: BEAT_COLORS['save-the-cat-setup'],
      },
      {
        level: 'beat',
        title: 'Theme Stated',
        description: 'A question or challenge is posed to the protagonist',
        storyPosition: 5,
        color: BEAT_COLORS['save-the-cat-setup'],
      },
      {
        level: 'beat',
        title: 'Set-Up',
        description: 'Establish the protagonist\'s world and what\'s wrong',
        storyPosition: 8,
        color: BEAT_COLORS['save-the-cat-setup'],
      },
      {
        level: 'beat',
        title: 'Catalyst / Inciting Incident',
        description: 'Event that kicks off the journey',
        storyPosition: 10,
        color: BEAT_COLORS['save-the-cat-catalyst'],
      },
      {
        level: 'beat',
        title: 'Debate',
        description: 'Protagonist hesitates or considers the journey',
        storyPosition: 18,
        color: BEAT_COLORS['save-the-cat-debate'],
      },
      {
        level: 'beat',
        title: 'Break Into Two',
        description: 'Protagonist commits to the journey',
        storyPosition: 25,
        color: BEAT_COLORS['save-the-cat-debate'],
      },
      {
        level: 'beat',
        title: 'B Story',
        description: 'Introduction of the love interest or mentor',
        storyPosition: 22,
        color: BEAT_COLORS['save-the-cat-fun'],
      },
      {
        level: 'beat',
        title: 'Fun & Games',
        description: 'The "promise of the premise" - what the audience came to see',
        storyPosition: 38,
        color: BEAT_COLORS['save-the-cat-fun'],
      },
      {
        level: 'beat',
        title: 'Midpoint',
        description: 'Apparent victory or new stakes introduced',
        storyPosition: 50,
        color: BEAT_COLORS['save-the-cat-midpoint'],
      },
      {
        level: 'beat',
        title: 'Bad Guys Close In',
        description: 'Stakes rise and doubts accumulate',
        storyPosition: 62,
        color: BEAT_COLORS['save-the-cat-bad'],
      },
      {
        level: 'beat',
        title: 'All Is Lost',
        description: 'The lowest point - major setback or death moment',
        storyPosition: 75,
        color: BEAT_COLORS['save-the-cat-bad'],
      },
      {
        level: 'beat',
        title: 'Dark Night of the Soul',
        description: 'Reflection and regrouping after the loss',
        storyPosition: 78,
        color: BEAT_COLORS['save-the-cat-dark'],
      },
      {
        level: 'beat',
        title: 'Break Into Three',
        description: 'Inspiration or new strategy emerges',
        storyPosition: 80,
        color: BEAT_COLORS['save-the-cat-finale'],
      },
      {
        level: 'beat',
        title: 'Finale',
        description: 'Final battle or confrontation with stakes',
        storyPosition: 90,
        color: BEAT_COLORS['save-the-cat-finale'],
      },
      {
        level: 'beat',
        title: 'Final Image',
        description: 'Mirror of opening image showing transformation',
        storyPosition: 100,
        color: BEAT_COLORS['save-the-cat-final'],
      },
    ],
  },
  {
    id: 'three-act',
    name: 'Three-Act Structure',
    description: 'Classic three-act dramatic structure',
    beats: [
      {
        level: 'act',
        title: 'Act 1: Setup',
        description: 'Establish the protagonist and their world',
        storyPosition: 5,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'beat',
        title: 'Inciting Incident',
        description: 'Event that disrupts the status quo',
        storyPosition: 10,
        color: '#f59e0b',
      },
      {
        level: 'beat',
        title: 'First Plot Point',
        description: 'Protagonist commits to action',
        storyPosition: 25,
        color: '#f59e0b',
      },
      {
        level: 'act',
        title: 'Act 2: Rising Action',
        description: 'Complications and escalation',
        storyPosition: 35,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'beat',
        title: 'Midpoint',
        description: 'Turning point that raises stakes',
        storyPosition: 50,
        color: '#f97316',
      },
      {
        level: 'beat',
        title: 'Crisis',
        description: 'Final challenge before the climax',
        storyPosition: 75,
        color: '#ef4444',
      },
      {
        level: 'act',
        title: 'Act 3: Resolution',
        description: 'Climax and resolution',
        storyPosition: 85,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'beat',
        title: 'Climax',
        description: 'Final confrontation and decision',
        storyPosition: 95,
        color: '#8b5cf6',
      },
      {
        level: 'beat',
        title: 'Denouement',
        description: 'Aftermath and new normal',
        storyPosition: 100,
        color: '#6366f1',
      },
    ],
  },
  {
    id: 'heros-journey',
    name: "Hero's Journey",
    description: "Joseph Campbell's monomyth structure",
    beats: [
      {
        level: 'beat',
        title: 'Ordinary World',
        description: "The hero's normal life before the adventure",
        storyPosition: 0,
        color: '#6b7280',
      },
      {
        level: 'beat',
        title: 'Call to Adventure',
        description: 'Event or challenge that prompts the journey',
        storyPosition: 5,
        color: '#f59e0b',
      },
      {
        level: 'beat',
        title: 'Refusal of the Call',
        description: 'Hero hesitates or refuses the challenge',
        storyPosition: 12,
        color: '#ef4444',
      },
      {
        level: 'beat',
        title: 'Meeting the Mentor',
        description: 'Encounter with guide, ally, or magical helper',
        storyPosition: 20,
        color: '#10b981',
      },
      {
        level: 'beat',
        title: 'Crossing the Threshold',
        description: 'Hero commits and enters the special world',
        storyPosition: 28,
        color: '#8b5cf6',
      },
      {
        level: 'beat',
        title: 'Tests, Allies, and Enemies',
        description: 'Learning the rules and meeting key characters',
        storyPosition: 40,
        color: '#3b82f6',
      },
      {
        level: 'beat',
        title: 'Approach to the Inmost Cave',
        description: 'Preparation for the major ordeal',
        storyPosition: 55,
        color: '#f97316',
      },
      {
        level: 'beat',
        title: 'The Ordeal',
        description: 'Life-or-death challenge; highest stakes moment',
        storyPosition: 70,
        color: '#ef4444',
      },
      {
        level: 'beat',
        title: 'Reward (Seizing the Sword)',
        description: 'Hero survives and obtains the prize',
        storyPosition: 80,
        color: '#10b981',
      },
      {
        level: 'beat',
        title: 'The Road Back',
        description: 'Return journey with new understanding',
        storyPosition: 85,
        color: '#3b82f6',
      },
      {
        level: 'beat',
        title: 'Resurrection',
        description: 'Final test using lessons learned',
        storyPosition: 95,
        color: '#8b5cf6',
      },
      {
        level: 'beat',
        title: 'Return with the Elixir',
        description: 'Hero comes home transformed',
        storyPosition: 100,
        color: '#6366f1',
      },
    ],
  },
  {
    id: 'five-act',
    name: 'Five-Act Structure',
    description: 'Shakespearean five-act dramatic structure',
    beats: [
      {
        level: 'act',
        title: 'Act 1: Exposition',
        description: 'Introduction of setting, characters, and conflict',
        storyPosition: 8,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'act',
        title: 'Act 2: Rising Action',
        description: 'Development of conflict and complications',
        storyPosition: 28,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'act',
        title: 'Act 3: Climax',
        description: 'Peak of tension and turning point of action',
        storyPosition: 50,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'act',
        title: 'Act 4: Falling Action',
        description: 'Consequences and movement toward resolution',
        storyPosition: 72,
        color: BEAT_COLORS['act'],
      },
      {
        level: 'act',
        title: 'Act 5: Denouement',
        description: 'Resolution and restoration of order',
        storyPosition: 100,
        color: BEAT_COLORS['act'],
      },
    ],
  },
];

export const BEAT_STATUS_CONFIG = {
  empty: { label: 'Empty', color: 'bg-gray-500/20 text-gray-400', icon: 'circle' },
  outlined: { label: 'Outlined', color: 'bg-blue-500/20 text-blue-400', icon: 'check-circle' },
  drafted: { label: 'Drafted', color: 'bg-amber-500/20 text-amber-400', icon: 'edit' },
  done: { label: 'Done', color: 'bg-green-500/20 text-green-400', icon: 'check-circle-2' },
};

export const BEAT_LEVEL_INDENT = {
  act: 'pl-0',
  chapter: 'pl-4',
  scene: 'pl-8',
  beat: 'pl-12',
};

export const BEAT_LEVEL_LABEL = {
  act: 'Act',
  chapter: 'Chapter',
  scene: 'Scene',
  beat: 'Beat',
};
