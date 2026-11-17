// Continuity data kept on a character's Codex card. Pure types: no database, no DOM.
import type { TravelMode } from '@/engines/worldgen/core/travel';

/**
 * What a ledger line records about a character in one chapter.
 * location: where they are · learns: a fact they come to know · actsOn: they
 * act on or mention a fact · gains / loses / uses: an object · condition: their
 * physical state · dies / revives · appears: present, nothing else changes.
 */
export const LEDGER_KINDS = ['location', 'learns', 'actsOn', 'gains', 'loses', 'uses', 'condition', 'dies', 'revives', 'appears'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** A place in a ledger line: a label, and when known, a point of a generated world. */
export interface LedgerPlace {
  label: string;
  worldId?: string;
  /** World cells, as story events store them. */
  x?: number;
  y?: number;
  /** A Codex location card. */
  entryId?: string;
}

export interface LedgerEntry {
  id: string;
  /** The manuscript chapter where it happens. */
  writingId: string;
  kind: LedgerKind;
  /** Position within the chapter, from 0; absent = in the order written. */
  order?: number;
  place?: LedgerPlace;
  /** learns / actsOn: the fact in the author's words. */
  fact?: string;
  /** learns / actsOn: a foreshadowing seed or a Codex card the fact is about. */
  seedId?: string;
  entryId?: string;
  /** gains / loses / uses: a Codex item card, or the object in words. */
  itemId?: string;
  item?: string;
  /** loses: the character it is handed to (that character gains it in the same chapter). */
  toId?: string;
  /** condition: the state in words; any kind: a note. */
  text?: string;
  /** Who wrote it: the author, or the Judge's proposal the author accepted. */
  source?: 'author' | 'judge';
  createdAt: number;
}

export interface CharacterContinuity {
  ledger?: LedgerEntry[];
  /** How the character usually travels, for the travel check (foot when absent). */
  travelMode?: TravelMode;
  /** Findings the author marked as intended (magic, an ellipsis…), with their note. */
  intentional?: Record<string, string>;
}

/** A chapter as the checks see it: its number, title and its days in the world calendar. */
export interface ChapterRef {
  writingId: string;
  /** Chapter number; null when the writing has none (it cannot be placed in order). */
  chapter: number | null;
  title: string;
  /** First and last day number in the world calendar; null when undated. */
  start: number | null;
  end: number | null;
}

export const LEDGER_TEXT_MAX = 500;
export const LEDGER_MAX = 2000;
