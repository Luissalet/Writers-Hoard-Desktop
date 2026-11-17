import { b, n, s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';
import { LEDGER_KINDS } from '@/engines/writings/continuity/types';
import { VOICE_TOOLS } from '@/services/voice/bridgeManifest';
import { PACING_TOOLS } from '@/services/pacing/bridgeManifest';

const CHARACTER = s('Codex id of a character card.');
const ERA = s('Named era; omit for Shared base.');

/** Travel verifier and chapter state ledger. The ledger lives on the character's Codex card. */
export const CONTINUITY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_travel_check',
    description: `Check whether characters can travel between their appearances in the days the chapters allow.
Appearances are story events naming the character (wh_add_story_event who) and, for chapters without one, ledger locations with a map point. Each leg between consecutive appearances is planned with the world's route engine (terrain, the character's usual mode, the season of the date) and compared with the days between the chapters' world dates: impossible, tight (over 75% of the days), comfortable, or unknown (undated chapter, other world, no route, world still generating — ask again). An impossible leg carries the earliest date the destination chapter could start on. Legs marked intended carry their note.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: ERA, characterId: s('Only this character; omit for all.'), onlyProblems: b('Only impossible and tight legs.') }, additionalProperties: false },
  },
  {
    name: 'wh_character_state',
    description: `What a character knows, carries, where they are and whether they live at the end of a chapter.
The state ledger accumulates every line up to the chapter (by chapter number): last location, facts learnt, objects gained minus lost (gifts move to the receiver), last condition, alive or dead. Pass chapter (a number) or writingId.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, characterId: CHARACTER, chapter: n('Chapter number.', { type: 'integer', minimum: 0 }), writingId: s('Manuscript chapter id instead of a number.') }, required: ['characterId'], additionalProperties: false },
  },
  {
    name: 'wh_state_ledger',
    description: `List a character's state ledger lines and the continuity checks over every ledger.
Checks: item-not-carried (uses or hands over an object not carried), after-death (any line or map event after dying), knows-before-learning (acts on a fact before the chapter where it is learnt), two-places (two locations at the same point of one chapter). Findings marked intended carry their note.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, characterId: s('Only this character\'s lines and findings; omit for all.') }, additionalProperties: false },
  },
  {
    name: 'wh_state_ledger_add',
    description: `Add a line to a character's state ledger for a chapter. Undoable.
kind: ${LEDGER_KINDS.join(', ')}. location needs place {label, worldId+x+y for a map point, entryId for a Codex place}; learns/actsOn need fact (or seedId/entryId); gains/loses/uses need itemId (Codex item) or item; loses may give it to toId; condition needs text. order places it within the chapter. Only write what the manuscript states or the author asks for.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID, characterId: CHARACTER, writingId: s('Manuscript chapter id.'),
        kind: s('What changes.', { enum: [...LEDGER_KINDS] }), order: n('Position within the chapter, from 0.', { type: 'integer', minimum: 0 }),
        place: { type: 'object', properties: { label: s('Place name.'), worldId: s('Generated world id.'), x: n('World cell x.'), y: n('World cell y.'), entryId: s('Codex location id.') }, required: ['label'], additionalProperties: false },
        fact: s('The fact, in the author\'s words.'), seedId: s('Foreshadowing seed id.'), entryId: s('Codex card the fact is about.'),
        itemId: s('Codex item id.'), item: s('Object in words.'), toId: s('loses: character it is handed to.'), text: s('condition text, or a note.'),
      },
      required: ['characterId', 'writingId', 'kind'], additionalProperties: false,
    },
  },
  {
    name: 'wh_state_ledger_remove',
    description: 'Remove one line from a character\'s state ledger. Undoable.',
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, characterId: CHARACTER, lineId: s('Ledger line id from wh_state_ledger.') }, required: ['characterId', 'lineId'], additionalProperties: false },
  },
  {
    name: 'wh_continuity_mark',
    description: `Mark a travel leg or state finding as intended, or set a character's travel mode. Undoable.
Intended means the author meant it (magic, an ellipsis). findingId is a leg id from wh_travel_check or a finding id from wh_state_ledger; note explains it, and an empty note takes the mark off. travelMode (foot, horse, cart, boat, ship) is how the character usually travels.`,
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, characterId: CHARACTER, findingId: s('Leg or finding id.'), note: s('Why it is intended; empty removes the mark.'), travelMode: s('Usual travel mode.', { enum: ['foot', 'horse', 'cart', 'boat', 'ship'] }) }, required: ['characterId'], additionalProperties: false },
  },
  // The novelist checks that read the manuscript beside continuity.
  ...VOICE_TOOLS,
  ...PACING_TOOLS,
];
