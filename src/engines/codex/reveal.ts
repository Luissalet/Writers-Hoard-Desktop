// Reveal state of a Codex card: has the author told the players what it says?
//
// One optional marker on the card record (`revealed`), written here and nowhere
// else. The editor, the Consult panel and the bridge tool all go through
// `setCodexRevealed`, so a reveal made in any of them is the same write, and its
// receipt (`RevealChange`) is what the bridge undo reads. A card without the
// marker is simply not revealed.
import { db } from '@/db';
import type { CodexEntry, CodexReveal } from '@/types';
import { readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
import { REVEAL_MOMENT_MAX, REVEAL_NOTE_MAX, readReveal } from './revealModel';

export { REVEAL_NOTE_MAX, REVEAL_MOMENT_MAX, readReveal, isRevealed, matchesRevealFilter, type RevealFilter } from './revealModel';
/** What one card was before and after a reveal or hide: the receipt the bridge undo reads. */
export interface RevealChange { id: string; title: string; before: CodexReveal | null; after: CodexReveal | null; updatedAtAfter: number }
export interface RevealOptions { note?: string; moment?: string; at?: number }
export class RevealConflict extends Error { constructor(message: string) { super(message); this.name = 'RevealConflict'; } }

/**
 * Base cards are written in one transaction. An era copy goes through the era store, which hashes
 * documents (so it cannot sit inside our transaction) and checks the version of each document it
 * writes; there every check runs first and the writes follow one by one.
 */
function atomically<T>(scope: WorldEraScope, work: () => Promise<T>): Promise<T> {
  return scope.eraId ? work() : db.transaction('rw', [db.codexEntries], work);
}

const same = (a: CodexReveal | null | undefined, b: CodexReveal | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function readCard(scope: WorldEraScope, id: string): Promise<{ entry: CodexEntry; version?: string } | undefined> {
  if (scope.eraId) {
    const read = await readWorldDocument(scope, 'codex', id);
    return read ? { entry: read.document.root as unknown as CodexEntry, version: read.version } : undefined;
  }
  const entry = await db.codexEntries.get(id);
  return entry && entry.projectId === scope.projectId ? { entry } : undefined;
}

async function writeMarker(scope: WorldEraScope, found: { entry: CodexEntry; version?: string }, marker: CodexReveal | null): Promise<number> {
  const updatedAt = Math.max(Date.now(), found.entry.updatedAt + 1);
  if (scope.eraId) {
    const root: Record<string, unknown> = { ...found.entry, updatedAt };
    if (marker) root.revealed = marker; else delete root.revealed;
    // The era store stamps its own updatedAt; that stamp is what a later undo has to find.
    const saved = await saveEraDocument(scope, 'codex', { root: root as unknown as EraRow, children: {} }, found.version ?? null);
    return Number(saved.document.root.updatedAt);
  } else {
    await db.codexEntries.update(found.entry.id, { revealed: marker ?? undefined, updatedAt });
  }
  return updatedAt;
}

/**
 * Reveal (or hide again) cards of one project. Cards already in the asked state
 * are left alone, unless a note or moment is given: then the marker is renewed.
 * Returns the receipts of the cards that actually changed; unknown ids throw
 * before anything is written.
 */
export async function setCodexRevealed(scope: WorldEraScope, ids: readonly string[], revealed: boolean, options: RevealOptions = {}): Promise<{ changes: RevealChange[]; unchanged: string[] }> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) throw new Error('reveal_no_cards');
  const note = options.note?.trim() ? options.note.trim().slice(0, REVEAL_NOTE_MAX) : undefined;
  const moment = options.moment?.trim() ? options.moment.trim().slice(0, REVEAL_MOMENT_MAX) : undefined;
  return atomically(scope, async () => {
    const found: { entry: CodexEntry; version?: string }[] = [];
    for (const id of wanted) {
      const card = await readCard(scope, id);
      if (!card) throw new Error('reveal_card_missing:' + id);
      found.push(card);
    }
    const changes: RevealChange[] = [], unchanged: string[] = [], now = options.at ?? Date.now();
    for (const card of found) {
      const before = readReveal(card.entry.revealed) ?? null;
      const renew = revealed && (note !== undefined || moment !== undefined);
      if (!!before === revealed && !renew) { unchanged.push(card.entry.id); continue; }
      const after: CodexReveal | null = revealed ? { at: now, ...(note ? { note } : {}), ...(moment ? { moment } : {}) } : null;
      const updatedAtAfter = await writeMarker(scope, card, after);
      changes.push({ id: card.entry.id, title: card.entry.title, before, after, updatedAtAfter });
    }
    return { changes, unchanged };
  });
}

/**
 * Put the markers back as a receipt recorded them. Refused, whole, when any
 * card changed after the reveal (edited, revealed again, deleted): later work
 * is never overwritten.
 */
export async function restoreCodexRevealed(scope: WorldEraScope, changes: readonly RevealChange[]): Promise<void> {
  await atomically(scope, async () => {
    const cards: { change: RevealChange; card: { entry: CodexEntry; version?: string } }[] = [];
    for (const change of changes) {
      const card = await readCard(scope, change.id);
      if (!card) throw new RevealConflict(`"${change.title}" no longer exists.`);
      if (card.entry.updatedAt !== change.updatedAtAfter || !same(readReveal(card.entry.revealed), change.after)) throw new RevealConflict(`"${change.title}" changed after it was revealed or hidden.`);
      cards.push({ change, card });
    }
    for (const { change, card } of cards) await writeMarker(scope, card, change.before);
  });
}
