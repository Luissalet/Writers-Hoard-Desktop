import type { Annotation } from '@/engines/annotations/types';
import type { DialogBlock, Scene } from '@/engines/dialog-scene/types';
import type { OutlineBeat } from '@/engines/outline/types';
import type { WritingSession } from '@/engines/writing-stats/types';
import type { EntityLink } from '@/types/projectTools';
import type { Tag, Writing } from '@/types';

export type NarrativeXrayLocale = 'en' | 'es';

export type NarrativeEvidenceEngine =
  | 'writings'
  | 'outline'
  | 'dialog-scene'
  | 'annotations'
  | 'writing-stats'
  | string;

/** A stable route back to the row that supports a measurement. */
export interface NarrativeEvidence {
  id: string;
  engineId: NarrativeEvidenceEngine;
  entityType: string;
  entityId: string;
  title: string;
  excerpt?: string;
  /** Plain-text offsets. They are omitted for evidence without a text range. */
  range?: { start: number; end: number };
  detail?: string;
}

export interface NarrativeXrayInput {
  projectId: string;
  locale?: NarrativeXrayLocale;
  writings: readonly Writing[];
  outlineBeats: readonly OutlineBeat[];
  scenes: readonly Scene[];
  dialogBlocks: readonly DialogBlock[];
  writingSessions: readonly WritingSession[];
  annotations: readonly Annotation[];
  tags: readonly Tag[];
  entityLinks: readonly EntityLink[];
}

export interface TextMeasure {
  words: number;
  sentences: number;
  paragraphs: number;
  averageSentenceWords: number;
  medianSentenceWords: number;
  averageParagraphWords: number;
  questions: number;
  exclamations: number;
  shortSentences: number;
}

export interface ProseVoiceProfile {
  writingId: string;
  title: string;
  order: number;
  measure: TextMeasure;
  /** Surface pronoun markers per 1,000 words; this does not claim a POV. */
  referenceMarkers: {
    firstPerson: number;
    secondPerson: number;
    thirdPerson: number;
  };
  recurringTerms: Array<{ term: string; count: number; evidence: NarrativeEvidence[] }>;
  evidence: NarrativeEvidence[];
}

export interface CharacterVoiceProfile {
  characterKey: string;
  characterId?: string;
  characterName: string;
  lineCount: number;
  words: number;
  medianLineWords: number;
  questions: number;
  exclamations: number;
  recurringTerms: Array<{ term: string; count: number; evidence: NarrativeEvidence[] }>;
  evidence: NarrativeEvidence[];
}

export interface NarrativeRhythmUnit {
  id: string;
  source: 'writing' | 'scene' | 'outline-beat';
  title: string;
  order: number;
  measure: TextMeasure;
  plannedWords?: number;
  explicitDialogBlocks?: number;
  explicitActionBlocks?: number;
  annotationCount: number;
  evidence: NarrativeEvidence;
}

export interface CreationRhythmDay {
  date: string;
  words: number;
  durationSeconds: number;
  sessionCount: number;
  sessionTypes: WritingSession['type'][];
  evidence: NarrativeEvidence[];
}

/**
 * Observable markers often used when discussing scene energy. There is no
 * combined score: a short sentence and an exclamation remain different facts.
 */
export interface NarrativeEnergyUnit {
  id: string;
  source: NarrativeRhythmUnit['source'];
  title: string;
  order: number;
  words: number;
  shortSentencesPer100Words: number;
  questionsPer100Words: number;
  exclamationsPer100Words: number;
  explicitDialogShare?: number;
  explicitActionShare?: number;
  evidence: NarrativeEvidence[];
}

export type NarrativeThreadOrigin = 'tag' | 'entity-link';

export interface NarrativeThread {
  id: string;
  origin: NarrativeThreadOrigin;
  label: string;
  color?: string;
  relation?: string;
  evidence: NarrativeEvidence[];
  entityKeys: string[];
}

export interface NarrativeXrayCoverage {
  writings: number;
  outlineBeats: number;
  scenes: number;
  dialogBlocks: number;
  annotations: number;
  writingSessions: number;
  entityLinks: number;
}

export interface NarrativeXrayModel {
  projectId: string;
  locale: NarrativeXrayLocale;
  coverage: NarrativeXrayCoverage;
  voice: {
    prose: ProseVoiceProfile[];
    characters: CharacterVoiceProfile[];
  };
  rhythm: {
    narrative: NarrativeRhythmUnit[];
    creation: CreationRhythmDay[];
  };
  energy: NarrativeEnergyUnit[];
  threads: NarrativeThread[];
}
