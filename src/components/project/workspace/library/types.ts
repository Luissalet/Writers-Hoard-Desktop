export const workspaceEngineIds = ['codex', 'writings', 'maps', 'board', 'timeline', 'notes', 'media', 'dictionary', 'tables', 'genealogy', 'character-sheets', 'radar', 'model-viewer'] as const;
export type WorkspaceEngineId = typeof workspaceEngineIds[number];
export interface WorkspaceFolder { id: string; name: string; parentId?: string; order: number }
export interface WorkspacePlacement { engineId: WorkspaceEngineId; entityId: string; folderId?: string; order: number }
export interface WorkspaceDocument { engineId: WorkspaceEngineId; entityId: string; title: string; route: string }
export interface WorkspaceLibrary { folders: WorkspaceFolder[]; placements: WorkspacePlacement[]; revision: number }
export const workspaceDocumentKey = (document: Pick<WorkspaceDocument, 'engineId' | 'entityId'>) => JSON.stringify([document.engineId, document.entityId]);
export const workspaceSourcePrefixes: Record<WorkspaceEngineId, string> = { codex: 'codex', writings: 'wr', maps: 'map', board: 'board', timeline: 'tl', notes: 'note', media: 'media', dictionary: 'language', tables: 'table', genealogy: 'tree', 'character-sheets': 'sheet', radar: 'radar', 'model-viewer': 'model' };
