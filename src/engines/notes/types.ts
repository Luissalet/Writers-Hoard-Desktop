// ============================================
// Notes Engine — Type Definitions
// ============================================
//
// A note is the smallest unit of capture in the app: one thought, one quote,
// one word you liked. Deliberately flat — no title, no rich text, no folders.
// Anything that grows past a paragraph belongs in Writings or Diary.

import { StickyNote, Quote, Lightbulb, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NoteKind = 'note' | 'quote' | 'idea' | 'word';

export interface Note {
  id: string;
  /**
   * Owning project — or `GLOBAL_NOTES_SCOPE` for the project-less inbox, so
   * the same table, ops and hook serve both scopes without a nullable column
   * (Dexie doesn't index undefined, which would make the inbox unqueryable).
   */
  projectId: string;
  kind: NoteKind;
  /** The note itself. Plain text; the first line doubles as its title. */
  text: string;
  /** Attribution — who said it (quotes) or where it came from (everything else). */
  source?: string;
  tags: string[];
  /** Accent color as a hex string, or undefined for the default surface look. */
  color?: string;
  /** Pinned notes float to the top of the board. */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Scope id for notes captured outside any project. Not a real project row —
 * `deleteProject` can never match it, so the inbox survives project deletion.
 */
export const GLOBAL_NOTES_SCOPE = '__inbox__';

export const NOTE_KINDS: NoteKind[] = ['note', 'quote', 'idea', 'word'];

export const NOTE_KIND_META: Record<NoteKind, { icon: LucideIcon; color: string }> = {
  note: { icon: StickyNote, color: '#e8c577' },
  quote: { icon: Quote, color: '#7c5cbf' },
  idea: { icon: Lightbulb, color: '#d4a843' },
  word: { icon: Type, color: '#4a9e6d' },
};

/** Swatches offered in the card color picker. */
export const NOTE_COLORS: string[] = [
  '#e8c577', // gold
  '#7c5cbf', // plum
  '#c4463a', // red
  '#4a9e6d', // green
  '#4a7ec4', // blue
];

/** First non-empty line, trimmed — used as a title in lists and search. */
export function noteTitle(note: Pick<Note, 'text'>, max = 80): string {
  const line = note.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
