// The one stored part of the voice profile: the prose description the author
// kept on the character's Codex card. Everything else is computed from the text.
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { CodexEntry } from '@/types';

export const VOICE_DESCRIPTION_MAX = 4000;

export interface VoiceReceipt { characterId: string; before: CodexEntry['voice']; after: CodexEntry['voice'] }

/** Keep a description on the card (null removes it). Returns what it replaced, for Undo. */
export async function setVoiceDescription(projectId: string, characterId: string, text: string | null, model?: string): Promise<VoiceReceipt> {
  const receipt = await db.transaction('rw', db.codexEntries, async () => {
    const entry = await db.codexEntries.get(characterId);
    if (!entry || entry.projectId !== projectId) throw new Error(`No Codex card "${characterId}" in this project.`);
    if (entry.type !== 'character') throw new Error(`"${entry.title}" is not a character card.`);
    const clean = text?.trim().slice(0, VOICE_DESCRIPTION_MAX);
    const after: CodexEntry['voice'] = clean ? { description: clean, at: Date.now(), ...(model ? { model } : {}) } : undefined;
    await db.codexEntries.update(characterId, { voice: after, updatedAt: Date.now() });
    return { characterId, before: entry.voice, after };
  });
  notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: characterId });
  return receipt;
}

/** Undo: put back what a receipt replaced, if nothing changed since. */
export async function revertVoiceDescription(projectId: string, receipt: VoiceReceipt): Promise<void> {
  const entry = await db.codexEntries.get(receipt.characterId);
  if (!entry || entry.projectId !== projectId) throw new Error('The character card is gone.');
  if (JSON.stringify(entry.voice ?? null) !== JSON.stringify(receipt.after ?? null)) throw new Error('The description changed again since; undo the later change first.');
  await db.codexEntries.update(receipt.characterId, { voice: receipt.before, updatedAt: Date.now() });
  notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: receipt.characterId });
}
