// AI bridge — telling the players what a Codex card says.
// One write tool: reveal cards to the players or hide them again. Engine-guarded
// like every Codex write, one audit line per call, undone with the receipt it carries.
import { BridgeError } from '@/services/aiBridge/tools/bridgeError';
import { optBoolean, optString, optStringArray, resolveProjectForEngine, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { PROJECT_ID, s, type BridgeTool } from '@/services/aiBridge/schema';
import { REVEAL_MOMENT_MAX, REVEAL_NOTE_MAX, setCodexRevealed } from './reveal';

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

export const CODEX_REVEAL_HANDLERS = {
  async wh_set_revealed(args: ToolArgs) {
    // The engine guard comes first: a switched-off Codex refuses before anything else is read.
    const projectId = await resolveProjectForEngine(args, 'codex');
    const ids = optStringArray(args, 'entryIds');
    if (!ids?.length || ids.length > 100 || ids.some(id => !id.trim())) throw new BridgeError('bad-args', 'entryIds is a list of 1 to 100 Codex card ids.');
    const revealed = optBoolean(args, 'revealed');
    if (revealed === undefined) throw new BridgeError('bad-args', 'revealed is true (reveal) or false (hide again).');
    const note = optString(args, 'note'), moment = optString(args, 'moment');
    if (!revealed && (note !== undefined || moment !== undefined)) throw new BridgeError('bad-args', 'note and moment go with revealed:true only.');
    if ((note?.length ?? 0) > REVEAL_NOTE_MAX || (moment?.length ?? 0) > REVEAL_MOMENT_MAX) throw new BridgeError('bad-args', `note is up to ${REVEAL_NOTE_MAX} characters and moment up to ${REVEAL_MOMENT_MAX}.`);
    const eraId = optString(args, 'eraId');
    let result;
    try { result = await setCodexRevealed({ projectId, eraId }, ids, revealed, { note, moment }); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('reveal_card_missing:')) throw new BridgeError('not-found', `No Codex card "${message.slice('reveal_card_missing:'.length)}" in this project; nothing was changed.`);
      throw error;
    }
    const base = { projectId, revealed, changed: result.changes.map(change => ({ id: change.id, title: change.title, revealed: change.after !== null })), unchanged: result.unchanged };
    if (!result.changes.length) return base;
    return withAudit(base, {
      projectId,
      entityId: result.changes[0].id,
      entityIds: result.changes.map(change => change.id),
      kind: 'update',
      summary: `${revealed ? 'revealed' : 'hid again'} ${result.changes.length === 1 ? `"${result.changes[0].title}"` : `${result.changes.length} Codex cards`}`,
      before: { __codexRevealed: { eraId: eraId ?? null, changes: result.changes } },
    });
  },
};
