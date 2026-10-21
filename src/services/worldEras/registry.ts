import type { Project } from '@/types';
import type { EraDocumentKind } from './types';

/** Pure aggregate layout: safe during database construction, regardless of import order. */
export interface EraAdapter { table?: string; metadata?: keyof Project; children?: Record<string, string> }
export const eraAdapters: Record<EraDocumentKind, EraAdapter> = {
  'local-tool': {metadata:'sourceToolDocuments'},
  'dialog-scene': { table: 'scenes', children: { sceneCasts: 'sceneId', dialogBlocks: 'sceneId' } },
  codex: { table: 'codexEntries' }, writings: { table: 'writings', children: { writingSnapshots: 'writingId' } },
  maps: { table: 'worldMaps', children: { mapPins: 'mapId' } },
  worldgen: { table: 'generatedWorlds', children: { worldWaypoints: 'worldId' } },
  board: { table: 'boards', children: { boardNodes: 'boardId', boardEdges: 'boardId', boardLayers: 'boardId', boardViews: 'boardId' } },
  timeline: { table: 'timelines', children: { timelineEvents: 'timelineId', timelineConnections: 'timelineId' } }, notes: { table: 'notes' }, media: { table: 'localMediaAssets' },
  dictionary: { metadata: 'dictionaries' }, tables: { metadata: 'dataTables' }, genealogy: { metadata: 'relationTrees' }, 'character-sheets': { metadata: 'characterSheets' }, radar: { metadata: 'radarCharts' }, 'model-viewer': { metadata: 'modelAssets' },
};
export function eraAdapterForTable(table: string): { kind: EraDocumentKind; parentField?: string } | undefined {
  for (const [kind, adapter] of Object.entries(eraAdapters)) { if (adapter.table === table) return { kind: kind as EraDocumentKind }; if (adapter.children?.[table]) return { kind: kind as EraDocumentKind, parentField: adapter.children[table] }; }
}
