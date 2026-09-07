export type ReadAloudLocale = 'es' | 'en';

export type ReadAloudMode = 'read-aloud' | 'table-read';

export type ReadAloudGranularity = 'sentence' | 'block';

export type ReadAloudBlockKind =
  | 'prose'
  | 'dialogue'
  | 'stage-direction'
  | 'action'
  | 'transition'
  | 'note'
  | 'slug';

/**
 * A read-only projection of canonical writing or screenplay data. The feature
 * deliberately owns no content table: hosts rebuild these blocks from the
 * current writing/scene whenever they open the reader.
 */
export interface ReadAloudBlock {
  id: string;
  sourceId: string;
  sourceKind: 'writing' | 'dialog-block';
  kind: ReadAloudBlockKind;
  text: string;
  label?: string;
  characterId?: string;
  characterName?: string;
  characterColor?: string;
}

export interface ReadAloudSegment extends ReadAloudBlock {
  segmentId: string;
  blockIndex: number;
  segmentIndex: number;
  startOffset: number;
  endOffset: number;
}

export interface ReadAloudVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
}

export interface SpeechBoundary {
  charIndex: number;
  charLength: number;
}

export interface SpeechRequest {
  text: string;
  lang: string;
  rate: number;
  voiceURI?: string;
  onStart: () => void;
  onBoundary: (boundary: SpeechBoundary) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

/** Browser-independent seam used by both the Web Speech adapter and tests. */
export interface SpeechDriver {
  readonly supported: boolean;
  readonly boundaryEvents: boolean;
  speak(request: SpeechRequest): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): ReadAloudVoice[];
  subscribeVoices?(listener: () => void): () => void;
}

export type ReadAloudPlaybackStatus =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'finished'
  | 'unsupported'
  | 'error';

export interface ReadAloudSnapshot {
  status: ReadAloudPlaybackStatus;
  activeIndex: number;
  completedIndexes: readonly number[];
  activeCharIndex: number;
  rate: number;
  error?: string;
  supported: boolean;
  boundaryEvents: boolean;
}

export interface ReadAloudNoteAnchor {
  sourceId: string;
  sourceKind: ReadAloudBlock['sourceKind'];
  blockId: string;
  segmentId: string;
  segmentIndex: number;
  startOffset: number;
  endOffset: number;
  quote: string;
  characterId?: string;
  characterName?: string;
}

export interface CharacterVoiceAssignment {
  key: string;
  characterId?: string;
  characterName: string;
  color?: string;
  voiceURI?: string;
}
