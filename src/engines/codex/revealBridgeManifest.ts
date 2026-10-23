// Pure tool data shared by the main-process catalog and renderer handlers.
import { PROJECT_ID, s, type BridgeTool } from '@/services/aiBridge/schema';
import { REVEAL_MOMENT_MAX, REVEAL_NOTE_MAX } from './revealModel';

export const CODEX_REVEAL_TOOLS: BridgeTool[] = [{
  name: 'wh_set_revealed',
  writes: true,
  description: 'Mark Codex cards as revealed to the players, or hide them again. The marker records when (and the optional note and story moment, e.g. "Session 3") and is what the Codex player view and the wiki policy onlyRevealed read; the card itself is untouched. A card already in the asked state is left alone (revealed:true with a note or moment renews the marker). Returns {changed:[{id,title,revealed}], unchanged:[ids]}. Undoable; the undo is refused if a card was edited, revealed or hidden again after the call.',
  schema: {
    type: 'object',
    properties: {
      projectId: PROJECT_ID,
      entryIds: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 100, uniqueItems: true, description: 'Ids of the Codex cards (wh_list_codex).' },
      revealed: { type: 'boolean', description: 'true reveals them, false hides them again.' },
      note: s(`What the players were told, up to ${REVEAL_NOTE_MAX} characters. Only with revealed:true.`),
      moment: s(`Where in the story it happened, e.g. "Session 3" (up to ${REVEAL_MOMENT_MAX} characters). Only with revealed:true.`),
    },
    required: ['entryIds', 'revealed'],
    additionalProperties: false,
  },
}];
