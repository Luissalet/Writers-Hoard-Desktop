import { s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';

/** Plan drift: written chapters against the outline beats they were meant to fulfil. */
export const PLAN_DRIFT_TOOLS: BridgeTool[] = [
  {
    name: 'wh_plan_drift',
    description: `Compare outline beats with their chapters: people, places, promises and what each chapter delivers.
Pass eraId to use the writings, Codex and map events of a named world era. For every beat of the story outlines: expected characters, places and other Codex cards named in its title and description, and the seeds and payoffs linked to it; what the chapter has (names and aliases in the text, story events told in it, promises by link or title); missing and extra ones; score (share found) and status kept, drifted (below 0.5) or unwritten (no chapter or an empty one). A drifted beat, or one whose chapter brings new characters or places, carries a proposal (title and description from the chapter's synopsis or opening plus who and where) that wh_plan_drift_apply writes. unplanned lists chapters no beat points at. Deterministic; no model.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: s('Read a named world era.'), outlineId: s('Only this outline.'), status: s('Only beats with this status.', { enum: ['kept', 'drifted', 'unwritten'] }) }, additionalProperties: false },
  },
  {
    name: 'wh_plan_drift_apply',
    description: `Update an outline beat from its chapter with the proposal from wh_plan_drift. Undoable.
Pass beatId and optionally eraId to read the chapter in a named world era. The outline stays shared. The current proposal is recomputed, so a beat that no longer has one is refused. title and description override the proposal's words.`,
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: s('Compute the proposal in this named world era.'), beatId: s('Outline beat id.'), title: s('Override the proposed title.'), description: s('Override the proposed description.') }, required: ['beatId'], additionalProperties: false },
  },
];
