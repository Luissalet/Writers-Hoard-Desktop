// The one stored part of the voice profile: the prose description the author
// kept on the character's Codex card. Everything else is computed from the text.
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { mutateEraRows, readEraRow } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';

export const VOICE_DESCRIPTION_MAX = 4000;

export interface VoiceReceipt { characterId: string; before: CodexEntry['voice']; after: CodexEntry['voice']; eraId?: string }

export function readVoiceCard(projectId: string, characterId: string, eraId?: string) {
  return eraId ? readEraRow<CodexEntry>({ projectId, eraId }, 'codexEntries', characterId) : db.codexEntries.get(characterId);
}

async function changeVoiceDescription(projectId: string, characterId: string, eraId: string | undefined, change: (voice: CodexEntry['voice']) => CodexEntry['voice']): Promise<VoiceReceipt> {
  const receipt = await db.transaction('rw', eraId ? db.tables : [db.codexEntries], async () => {
    const entry = await readVoiceCard(projectId, characterId, eraId);
    if (!entry || entry.projectId !== projectId) throw new Error(`No Codex card "${characterId}" in this project.`);
    if (entry.type !== 'character') throw new Error(`"${entry.title}" is not a character card.`);
    const after = change(entry.voice);
    const changes = { voice: after, updatedAt: Date.now() };
    if (eraId) await mutateEraRows({ projectId, eraId }, [{ table: 'codexEntries', id: characterId, changes }]);
    else await db.codexEntries.update(characterId, changes);
    return { characterId, before: entry.voice, after, eraId };
  });
  notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: characterId });
  return receipt;
}

/** Keep a description on the card (null removes it). Returns what it replaced, for Undo. */
export function setVoiceDescription(projectId: string, characterId: string, text: string | null, model?: string, eraId?: string): Promise<VoiceReceipt> {
  const clean = text?.trim().slice(0, VOICE_DESCRIPTION_MAX);
  return changeVoiceDescription(projectId, characterId, eraId, () => clean ? { description: clean, at: Date.now(), ...(model ? { model } : {}) } : undefined);
}

/** Undo: put back what a receipt replaced, if nothing changed since. */
export async function revertVoiceDescription(projectId: string, receipt: VoiceReceipt): Promise<void> {
  await changeVoiceDescription(projectId, receipt.characterId, receipt.eraId, (current) => {
    if (JSON.stringify(current ?? null) !== JSON.stringify(receipt.after ?? null)) throw new Error('The description changed again since; undo the later change first.');
    return receipt.before;
  });
}
