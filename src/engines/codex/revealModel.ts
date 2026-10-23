// The reveal marker of a Codex card, read and filtered. Pure: no database, so the wiki
// policy, the lists and the bridge can all import it.
import type { CodexReveal } from '@/types';

export const REVEAL_NOTE_MAX = 500;
export const REVEAL_MOMENT_MAX = 120;
export type RevealFilter = 'all' | 'revealed' | 'unrevealed';

/** A stored marker read defensively: anything that is not a well-formed marker is "not revealed". */
export function readReveal(value: unknown): CodexReveal | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const marker = value as Record<string, unknown>;
  if (typeof marker.at !== 'number' || !Number.isFinite(marker.at)) return undefined;
  return {
    at: marker.at,
    ...(typeof marker.note === 'string' && marker.note.trim() ? { note: marker.note.trim().slice(0, REVEAL_NOTE_MAX) } : {}),
    ...(typeof marker.moment === 'string' && marker.moment.trim() ? { moment: marker.moment.trim().slice(0, REVEAL_MOMENT_MAX) } : {}),
  };
}
export const isRevealed = (entry: { revealed?: unknown }): boolean => readReveal(entry.revealed) !== undefined;
export function matchesRevealFilter(entry: { revealed?: unknown }, filter: RevealFilter): boolean {
  return filter === 'all' || (filter === 'revealed') === isRevealed(entry);
}

