import { arr, b, PROJECT_ID, s, type BridgeTool } from './schema';
const properties = {
  projectId: PROJECT_ID,
  sections: { ...arr('Sections to include; omitted means all, [] means none.'), items: { type: 'string', enum: ['codex', 'timeline', 'maps', 'relationships'] } },
  entryIds: arr('Codex IDs; omitted means all, [] none. Rejects unknown or foreign IDs.'),
  timelineIds: arr('Timeline IDs; omitted means all, [] none.'),
  mapIds: arr('Map IDs; omitted means all, [] none.'),
  relationshipIds: arr('Relationship IDs; omitted means all, [] none.'),
  includeSecrets: b('Include relationships marked secret. Default false.'),
  locale: s('Document language.', { enum: ['es', 'en'] }),
};
export const BIBLE_TOOLS: BridgeTool[] = [
  { name: 'wh_build_world_bible', writes: false, description: `Compile a portable world bible with index, links and provenance from this project's reference material.
Returns HTML from selected Codex entries, timelines, maps and relationships. Does not change stored data or load remote images. Selected local rows only; shared-universe canon is not expanded. Secret relationships excluded unless requested.`, schema: { type: 'object', properties, additionalProperties: false } },
  { name: 'wh_export_world_bible', writes: true, description: `Save a world bible as HTML or PDF through the normal app export flow.
HTML downloads; PDF requires the desktop app and opens its native save dialog. Stored project data is unchanged. Returns cancellation or failure explicitly.`, schema: { type: 'object', properties: { ...properties, format: s('Output format.', { enum: ['html', 'pdf'] }) }, required: ['format'], additionalProperties: false } },
];
