import type { DialogBlock, SceneCast } from '../types';

export interface ConversationSpeaker { id: string; name: string; color: string; count: number }
export interface ConversationTurn { id: string; blocks: DialogBlock[]; simultaneous: boolean }
export interface ConversationFilters { dialogue: boolean; narration: boolean; notes: boolean; speakers: ReadonlySet<string> }
export function conversationSpeakerId(block: Pick<DialogBlock, 'characterId' | 'characterName'>) {
  return block.characterId ? `id:${block.characterId}` : `name:${block.characterName.normalize('NFC').trim().toLocaleLowerCase()}`;
}
export function conversationColor(value: string | undefined) { return value && /^#[\da-f]{6}$/i.test(value) ? value : '#d5b575'; }

/** Project/scene ownership is checked before projection. No source is rewritten,
 * and a dual-dialogue group is revealed together rather than inventing turns. */
export function buildConversation(projectId: string, sceneId: string, blocks: readonly DialogBlock[], cast: readonly SceneCast[]) {
  const ordered = blocks.filter(block => block.projectId === projectId && block.sceneId === sceneId && (block.content.trim() || block.parenthetical?.trim()))
    .map((block, index) => ({ block, index })).sort((left, right) => left.block.order - right.block.order || left.index - right.index).map(item => item.block);
  const speakers = new Map<string, ConversationSpeaker>(), turns: ConversationTurn[] = [];
  for (const block of ordered) {
    if (block.type === 'dialog') {
      const id = conversationSpeakerId(block), existing = speakers.get(id);
      if (existing) existing.count++;
      else {
        const member = cast.find(item => item.sceneId === sceneId && (block.characterId ? item.characterId === block.characterId : item.characterName.normalize('NFC').trim().toLocaleLowerCase() === block.characterName.normalize('NFC').trim().toLocaleLowerCase()));
        speakers.set(id, { id, name: block.characterName || member?.characterName || '', color: conversationColor(block.characterColor || member?.color), count: 1 });
      }
    }
    const previous = turns.at(-1);
    if (block.type === 'dialog' && block.dualGroupId && previous?.blocks.every(other => other.type === 'dialog' && other.dualGroupId === block.dualGroupId)) {
      previous.blocks.push(block); previous.simultaneous = true;
    } else turns.push({ id: block.id, blocks: [block], simultaneous: false });
  }
  return { speakers: [...speakers.values()], turns };
}
export function filterConversation(turns: readonly ConversationTurn[], filters: ConversationFilters): ConversationTurn[] {
  return turns.map(turn => ({ ...turn, blocks: turn.blocks.filter(block => block.type === 'dialog' ? filters.dialogue && filters.speakers.has(conversationSpeakerId(block)) : block.type === 'note' ? filters.notes : filters.narration) })).filter(turn => turn.blocks.length > 0);
}
