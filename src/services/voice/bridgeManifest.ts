import { b, n, s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';

const ERA_ID = s('Named era ID. Omit for Shared base.');

/** Voice by character: profiles of each character's dialogue, the lines that leave them, the kept description. */
export const VOICE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_voice_profile',
    description: `Profile of how each character speaks, computed from their dialogue lines in the manuscript.
Lines are Spanish dash dialogue and English quotes, attributed by speaker name or Codex alias in a speech tag, an unambiguous pronoun based on turn and card gender, a narration beat or a two-voice exchange, plus Dialog Scene blocks. Per character: lines, words, sentence length mean and spread, share of lines with exclamations, questions and ellipses, forms of address (tú/usted/vos) and the dominant one, register, distinctive words against the rest of the cast, repeated openings and endings. Deterministic; the kept prose description (wh_voice_describe) comes with it. includeLines adds the speaker, attribution and manuscript position. eraId scopes chapters, cards and Dialog Scenes.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: ERA_ID, characterId: s('Only this character; omit for all.'), includeLines: b('Also list the dialogue lines.') }, additionalProperties: false },
  },
  {
    name: 'wh_voice_outliers',
    description: `Dialogue lines outside their speaker's profile, with their chapter and position.
Reasons: closer-to (the words fit another character's profile better, by a per-word margin), length (sentence length 2.5 spreads from the speaker's mean), address (the other form of address from the one the speaker uses). Only characters with at least 5 lines are judged, and lines of 4 words or more. writingId limits them to a chapter. eraId scopes the report.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: ERA_ID, characterId: s('Only this speaker.'), writingId: s('Only lines of this chapter.'), limit: n('Most lines to return (default 50).', { type: 'integer', minimum: 1, maximum: 500 }) }, additionalProperties: false },
  },
  {
    name: 'wh_voice_describe',
    description: `Keep a prose description of how a character speaks on their Codex card, or have the model write it. Undoable.
Pass text to keep the author's own words; omit it to have the global model describe the computed profile (statistics and a few lines, nothing invented). An empty text removes it. eraId selects the version of the profile and card.`,
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: ERA_ID, characterId: s('Codex id of a character card.'), text: s('The description; empty removes it; omit to have the model write it.') }, required: ['characterId'], additionalProperties: false },
  },
];
