import { s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';

const ERA_ID = s('Named era ID; omit for Shared base.');

/** Pacing x-ray of the manuscript. */
export const PACING_TOOLS: BridgeTool[] = [
  {
    name: 'wh_pacing',
    description: `Read manuscript pacing, scene tension, outline beats and flat stretches.
A scene has measured pace (0…1) and optional manual tension (0…1). The curve uses manual tension when available and measured pace otherwise. Chapters average their scenes' measured pace and word shares. Flat stretches have 4+ consecutive scenes within 0.04 on the curve. Other flags describe the prose. Beats come from the project's outlines, placed at the effective chapter's start or at their story position. Set or clear manual tension with wh_pacing_set_tension.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: ERA_ID, writingId: s('Only this chapter\'s scenes and flags.'), outlineId: s('Only this outline\'s beats.') }, additionalProperties: false },
  },
  {
    name: 'wh_pacing_set_tension',
    description: `Set or clear the manual tension of a manuscript scene.
Use writingId and the zero-based index from wh_pacing. Set tension from 0 to 1 or pass null to return to automatic pace. A named era writes in that era. Undoable with wh_undo.`,
    writes: true,
    engineId: 'writings',
    schema: {
      type: 'object', additionalProperties: false, required: ['writingId', 'sceneIndex', 'tension'],
      properties: {
        projectId: PROJECT_ID, eraId: ERA_ID, writingId: s('Chapter ID from wh_pacing.'),
        sceneIndex: { type: 'integer', minimum: 0, description: 'Zero-based scene index from wh_pacing.' },
        tension: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }], description: 'Manual tension, or null for automatic pace.' },
      },
    },
  },
];
