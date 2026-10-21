import {localToolNamespace} from '@/engines/local/stateTypes';
export const workspaceEngineIds = ['dialog-scene', 'worldgen', 'codex', 'writings', 'maps', 'board', 'timeline', 'notes', 'media', 'dictionary', 'tables', 'genealogy', 'character-sheets', 'radar', 'model-viewer'] as const;
export type WorkspaceBuiltinEngineId=typeof workspaceEngineIds[number];
export type WorkspaceEngineId=WorkspaceBuiltinEngineId|`local-tool-${string}`;
export const isWorkspaceEngineId=(value:unknown):value is WorkspaceEngineId=>typeof value==='string'&&((workspaceEngineIds as readonly string[]).includes(value)||value.startsWith('local-tool-')&&localToolNamespace(value.slice(11)));
export interface WorkspaceFolder { id: string; name: string; parentId?: string; order: number }
export interface WorkspacePlacement { engineId: WorkspaceEngineId; entityId: string; folderId?: string; order: number }
export interface WorkspaceDocument { engineId: WorkspaceEngineId; entityId: string; title: string; route: string }
export interface WorkspaceLibrary { folders: WorkspaceFolder[]; placements: WorkspacePlacement[]; revision: number }
export const workspaceDocumentKey = (document: Pick<WorkspaceDocument, 'engineId' | 'entityId'>) => JSON.stringify([document.engineId, document.entityId]);
export const workspaceSourcePrefixes: Record<WorkspaceBuiltinEngineId, string> = { 'dialog-scene': 'scene', worldgen: 'world', codex: 'codex', writings: 'wr', maps: 'map', board: 'board', timeline: 'tl', notes: 'note', media: 'media', dictionary: 'language', tables: 'table', genealogy: 'tree', 'character-sheets': 'sheet', radar: 'radar', 'model-viewer': 'model' };

export const workspaceSourcePrefix=(engineId:WorkspaceEngineId)=>engineId.startsWith('local-tool-')?'source-tool':workspaceSourcePrefixes[engineId as WorkspaceBuiltinEngineId];
