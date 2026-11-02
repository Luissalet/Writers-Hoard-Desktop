import { PROJECT_ID, s, type BridgeTool } from './schema';

export const HOME_TOOLS: BridgeTool[] = [
  {
    name: 'wh_project_home', group: 'core', writes: false,
    description: 'Read project document creation counts by month, current counts and a suggested next action. Base project overview; counts describe extant documents, not deleted history.',
    schema: { type: 'object', properties: { projectId: PROJECT_ID } },
  },
  {
    name: 'wh_project_quick_create', group: 'core', writes: true,
    description: 'Create a writing, plain note, empty outline, timeline or cork board through its normal engine operations, as in the command palette. All except outlines accept an era; outlines are base-only. Respects enabled engines.',
    schema: { type: 'object', properties: { projectId: PROJECT_ID, eraId: s('Optional world era; outlines are base-only.'), engineId: s('Engine.', { enum: ['writings', 'notes', 'outline', 'timeline', 'board'] }), text: s('Document title or plain note text.') }, required: ['engineId', 'text'] },
  },
];
