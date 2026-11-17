import { b, n, PROJECT_ID, s, type BridgeTool } from '@/services/aiBridge/schema';
import { PLATE_FORMATS } from './types';

const worldId = s('Generated world ID.');
const mapId = s('Saved plate ID.');
const nullable = (value: Record<string, unknown>) => ({ anyOf: [value, { type: 'null' }] });

export const IN_WORLD_MAP_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_in_world_maps', writes: false,
    description: 'List the saved cartographer plates of a generated world.',
    schema: { type: 'object', properties: { worldId, projectId: PROJECT_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_list_cartographers', writes: false,
    description: 'List origin cultures and named places for an in-world map.',
    schema: { type: 'object', properties: { worldId, projectId: PROJECT_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_save_in_world_map', writes: true,
    description: 'Create or update an in-world map with optional Codex and knowledge corrections. Undoable.',
    schema: {
      type: 'object', additionalProperties: false, required: ['worldId'],
      properties: {
        worldId, mapId, projectId: PROJECT_ID,
        title: { type: 'string', minLength: 1, maxLength: 120 },
        origin: { type: 'object', required: ['kind', 'id'], additionalProperties: false,
          properties: { kind: { type: 'string', enum: ['culture', 'place'] }, id: s('Origin ID from wh_list_cartographers.') } },
        date: { type: 'object', required: ['year'], additionalProperties: false,
          properties: { year: { type: 'integer' }, month: { type: 'integer', minimum: 1 }, day: { type: 'integer', minimum: 1 }, approx: b('Approximate date.') } },
        reach: n('Knowledge radius as a fraction of world width, from 0.025 to 0.35.'),
        distortion: n('Deformation from 0 to 1.'),
        themeId: { type: 'string', enum: ['antique', 'wonder', 'relief', 'survey'] },
        chapter: nullable({ type: 'integer', minimum: 1, description: 'Apply author reader-fog strokes through this chapter. Null clears it.' }),
        entryId: nullable(s('Project Codex card ID. Null clears the link.')),
        marks: { type: 'array', maxItems: 500, description: 'Ordered replacement for manual source-cell corrections.',
          items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'op', 'radius'],
            properties: { x: n('Source cell x.'), y: n('Source cell y.'), radius: n('Brush radius in cells.'), op: { type: 'string', enum: ['seen', 'heard', 'hide'] } } } },
      },
    },
  },
  {
    name: 'wh_export_in_world_map', writes: false,
    description: 'Render a saved cartographer plate as PNG, SVG or PDF with export bytes.',
    schema: {
      type: 'object', additionalProperties: false, required: ['worldId', 'mapId', 'format'],
      properties: { worldId, mapId, projectId: PROJECT_ID, format: { type: 'string', enum: [...PLATE_FORMATS] }, locale: { type: 'string', enum: ['es', 'en'] } },
    },
  },
  {
    name: 'wh_insert_in_world_map', writes: true,
    description: 'Insert a saved cartographer plate at the start of a local chapter. Undoable.',
    schema: {
      type: 'object', additionalProperties: false, required: ['worldId', 'mapId', 'writingId'],
      properties: { worldId, mapId, projectId: PROJECT_ID, writingId: s('Local chapter ID.'), locale: { type: 'string', enum: ['es', 'en'] } },
    },
  },
  {
    name: 'wh_remove_in_world_map', writes: true,
    description: 'Remove a saved cartographer plate from its generated world. Undoable.',
    schema: { type: 'object', properties: { worldId, mapId, projectId: PROJECT_ID }, required: ['worldId', 'mapId'], additionalProperties: false },
  },
];
