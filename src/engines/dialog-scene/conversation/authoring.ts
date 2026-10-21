import type { WorldEraScope } from '@/services/worldEras/types';
import { readEraRow } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { dialogSceneOperations } from '../scopedOperations';
import { db } from '@/db';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { generateId } from '@/utils/idGenerator';
import type { DialogBlock } from '../types';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';

export interface ConversationDraft { content: string; speaker: string }
export function conversationDraftStore(projectId: string, eraId?: string) {
  return createLocalDraftStore<ConversationDraft>(`wh.conversation-drafts.v1.${projectId}${eraId ? `.era:${eraId}` : ''}`, (value): value is ConversationDraft => Boolean(value && typeof value === 'object' && typeof (value as ConversationDraft).content === 'string' && typeof (value as ConversationDraft).speaker === 'string'));
}

/** Append against current scene order, with the speaker's stable card identity. */
export async function appendConversationTurn(sceneId: string, draft: ConversationDraft, scope?: WorldEraScope): Promise<DialogBlock> {
  if (!draft.content.trim()) throw Error('conversation_empty');
  const operations = dialogSceneOperations(scope);
  const saved = await db.transaction('rw', scope?.eraId ? db.tables : [db.scenes, db.dialogBlocks, db.sceneCasts, db.codexEntries], async () => {
    const scene = await operations.getScene(sceneId); if (!scene) throw Error('scene_missing');
    const cast = await operations.getSceneCast(sceneId);
    const member = cast.find(member => `cast:${member.id}` === draft.speaker);
    const entry = draft.speaker.startsWith('entry:') ? scope?.eraId ? await readEraRow<CodexEntry>(scope, 'codexEntries', draft.speaker.slice(6)) : await db.codexEntries.get(draft.speaker.slice(6)) : undefined;
    if (draft.speaker && !member && !(entry?.projectId === scene.projectId && entry.type === 'character')) throw Error('conversation_speaker_missing');
    const characterId = member?.characterId ?? entry?.id;
    if (characterId) { const character = scope?.eraId ? await readEraRow<CodexEntry>(scope, 'codexEntries', characterId) : await db.codexEntries.get(characterId); if (!character || character.projectId !== scene.projectId) throw Error('conversation_foreign_character'); }
    const blocks = await operations.getDialogBlocks(sceneId), now = Date.now();
    const block: DialogBlock = { id: generateId('block'), sceneId, projectId: scene.projectId, type: draft.speaker ? 'dialog' : 'action', characterId, characterName: member?.characterName ?? entry?.title ?? '', characterColor: member?.color ?? '#c4973b', content: draft.content, order: blocks.reduce((order, item) => Math.max(order, item.order + 1), 0), createdAt: now, updatedAt: now };
    await operations.createDialogBlock(block);
    await operations.updateScene(sceneId, { updatedAt: Math.max(now, scene.updatedAt + 1) });
    return block;
  });
  notifyDataChanged({ source: 'other', table: 'dialogBlocks', projectId: saved.projectId, entityId: saved.id });
  return saved;
}
