import { s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';

/** Pacing x-ray of the manuscript. */
export const PACING_TOOLS: BridgeTool[] = [
  {
    name: 'wh_pacing',
    description: `Pacing x-ray: dialogue, narration and description per scene and chapter, with outline beats and flat stretches.
Scenes are the chapter's text split at scene-break lines (***, * * *, #, ⁂). Per scene: words, shares of dialogue / narration / description (stative and imperfect sentences), action verbs per 100 words of prose, words per sentence, pace 0…1 (dialogue, action and short sentences) and its position 0…1 in the manuscript. Chapters average their scenes by words. Beats of the story outlines are placed at their linked chapter or their story position. Flags: flat (4+ scenes in a row within 0.04 of pace), description-heavy, dialogue-only, no-dialogue (long scene), overlong (3× the median). No tension value is stored per scene, so none is reported. writingId keeps only that chapter's scenes; outlineId picks one outline.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, writingId: s('Only this chapter\'s scenes and flags.'), outlineId: s('Only this outline\'s beats.') }, additionalProperties: false },
  },
];
