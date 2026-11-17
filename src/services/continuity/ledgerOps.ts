// Writes to a character's continuity (ledger lines, travel mode, intended
// findings). Each returns what it replaced so the caller can offer Undo.
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { normalizeLedgerEntry } from '@/engines/writings/continuity/ledger';
import { LEDGER_MAX, type CharacterContinuity, type LedgerEntry } from '@/engines/writings/continuity/types';
import type { TravelMode } from '@/engines/worldgen/core/travel';
import { mutateEraRows, readEraRow } from '@/services/worldEras/store';
import type { CodexEntry, Writing } from '@/types';

export interface ContinuityReceipt {
  characterId: string;
  /** The continuity before the change (undefined: the card had none). */
  before: CharacterContinuity | undefined;
  after: CharacterContinuity | undefined;
  /** The named era whose version of the card changed; absent = Shared base. */
  eraId?: string;
}

const MODES: TravelMode[] = ['foot', 'horse', 'cart', 'boat', 'ship'];

function newLedgerId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `sl-${Date.now().toString(36)}-${random}`;
}

function tidy(value: CharacterContinuity): CharacterContinuity | undefined {
  const next: CharacterContinuity = {};
  if (value.ledger?.length) next.ledger = value.ledger;
  if (value.travelMode && value.travelMode !== 'foot') next.travelMode = value.travelMode;
  if (value.intentional && Object.keys(value.intentional).length) next.intentional = value.intentional;
  return Object.keys(next).length ? next : undefined;
}

async function mutate(projectId: string, characterId: string, change: (current: CharacterContinuity) => CharacterContinuity, writingIds: string[] = [], eraId?: string): Promise<ContinuityReceipt> {
  if (eraId) {
    // A named era keeps its own version of the card: read and write that variant.
    const scope = { projectId, eraId };
    const entry = await readEraRow<CodexEntry>(scope, 'codexEntries', characterId);
    if (!entry || entry.projectId !== projectId) throw new Error(`No Codex card "${characterId}" in this project.`);
    if (entry.type !== 'character') throw new Error(`"${entry.title}" is not a character card.`);
    for (const writingId of writingIds) {
      if (!(await readEraRow<Writing>(scope, 'writings', writingId))) throw new Error(`No manuscript chapter "${writingId}" in this project.`);
    }
    const before = entry.continuity ? structuredClone(entry.continuity) : undefined;
    const after = tidy(change(structuredClone(entry.continuity ?? {})));
    await mutateEraRows(scope, [{ table: 'codexEntries', id: characterId, changes: { continuity: after, updatedAt: Date.now() } }]);
    notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: characterId });
    return { characterId, before, after, eraId };
  }
  const receipt = await db.transaction('rw', [db.codexEntries, db.writings], async () => {
    const entry = await db.codexEntries.get(characterId);
    if (!entry || entry.projectId !== projectId) throw new Error(`No Codex card "${characterId}" in this project.`);
    if (entry.type !== 'character') throw new Error(`"${entry.title}" is not a character card.`);
    for (const writingId of writingIds) {
      const writing = await db.writings.get(writingId);
      if (!writing || writing.projectId !== projectId) throw new Error(`No manuscript chapter "${writingId}" in this project.`);
    }
    const before = entry.continuity ? structuredClone(entry.continuity) : undefined;
    const after = tidy(change(structuredClone(entry.continuity ?? {})));
    await db.codexEntries.update(characterId, { continuity: after, updatedAt: Date.now() });
    return { characterId, before, after };
  });
  notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: characterId });
  return receipt;
}

/** Add a ledger line (an id is made when absent). */
export async function addLedgerEntry(projectId: string, characterId: string, input: Partial<LedgerEntry>, eraId?: string): Promise<ContinuityReceipt & { entry: LedgerEntry }> {
  const entry = normalizeLedgerEntry({ ...input, id: input.id ?? newLedgerId(), createdAt: input.createdAt ?? Date.now() });
  if (entry.toId === characterId) delete entry.toId;
  const receipt = await mutate(projectId, characterId, (current) => {
    const ledger = current.ledger ?? [];
    if (ledger.some((line) => line.id === entry.id)) throw new Error(`Ledger line "${entry.id}" already exists.`);
    if (ledger.length >= LEDGER_MAX) throw new Error(`A character keeps at most ${LEDGER_MAX} ledger lines.`);
    return { ...current, ledger: [...ledger, entry] };
  }, [entry.writingId], eraId);
  return { ...receipt, entry };
}

/** Replace a ledger line with the same id. */
export async function updateLedgerEntry(projectId: string, characterId: string, input: LedgerEntry, eraId?: string): Promise<ContinuityReceipt> {
  const entry = normalizeLedgerEntry(input);
  return mutate(projectId, characterId, (current) => {
    const ledger = current.ledger ?? [];
    if (!ledger.some((line) => line.id === entry.id)) throw new Error(`No ledger line "${entry.id}".`);
    return { ...current, ledger: ledger.map((line) => line.id === entry.id ? entry : line) };
  }, [entry.writingId], eraId);
}

export async function removeLedgerEntry(projectId: string, characterId: string, entryId: string, eraId?: string): Promise<ContinuityReceipt> {
  return mutate(projectId, characterId, (current) => {
    const ledger = current.ledger ?? [];
    if (!ledger.some((line) => line.id === entryId)) throw new Error(`No ledger line "${entryId}".`);
    return { ...current, ledger: ledger.filter((line) => line.id !== entryId) };
  }, [], eraId);
}

export async function setTravelMode(projectId: string, characterId: string, mode: TravelMode, eraId?: string): Promise<ContinuityReceipt> {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}.`);
  return mutate(projectId, characterId, (current) => ({ ...current, travelMode: mode }), [], eraId);
}

/** Mark a finding (travel leg or state finding) as intended with a note; null takes the mark off. */
export async function setIntentional(projectId: string, characterId: string, findingId: string, note: string | null, eraId?: string): Promise<ContinuityReceipt> {
  if (!findingId.trim() || findingId.length > 300) throw new Error('findingId must be a finding id from the report.');
  return mutate(projectId, characterId, (current) => {
    const intentional = { ...(current.intentional ?? {}) };
    if (note === null) delete intentional[findingId];
    else intentional[findingId] = note.trim().slice(0, 500);
    return { ...current, intentional };
  }, [], eraId);
}

/** Undo: put back what a receipt replaced, if nothing changed since. */
export async function revertContinuity(projectId: string, receipt: ContinuityReceipt): Promise<void> {
  await mutate(projectId, receipt.characterId, (current) => {
    if (JSON.stringify(tidy(current) ?? null) !== JSON.stringify(receipt.after ?? null)) throw new Error('This character\'s continuity changed again since; undo the later change first.');
    return receipt.before ?? {};
  }, [], receipt.eraId);
}
