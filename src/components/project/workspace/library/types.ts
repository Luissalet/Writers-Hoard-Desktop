import {localToolNamespace} from '@/engines/local/stateTypes';
export const workspaceEngineIds = ['dialog-scene', 'worldgen', 'codex', 'writings', 'maps', 'board', 'timeline', 'notes', 'media', 'dictionary', 'tables', 'genealogy', 'character-sheets', 'radar', 'model-viewer'] as const;
export type WorkspaceBuiltinEngineId=typeof workspaceEngineIds[number];
export type WorkspaceEngineId=WorkspaceBuiltinEngineId|`local-tool-${string}`;
export const isWorkspaceEngineId=(value:unknown):value is WorkspaceEngineId=>typeof value==='string'&&((workspaceEngineIds as readonly string[]).includes(value)||value.startsWith('local-tool-')&&localToolNamespace(value.slice(11)));
/** The icons a folder can wear in the Library tree. */
export const WORKSPACE_FOLDER_ICONS = ['folder', 'book', 'users', 'map', 'scroll', 'sword', 'crown', 'star', 'heart', 'flag', 'gem', 'leaf'] as const;
export type WorkspaceFolderIcon = typeof WORKSPACE_FOLDER_ICONS[number];
/** A small palette, plus any #rrggbb the bridge sends. */
export const WORKSPACE_FOLDER_COLORS = ['#d5b575', '#c0504d', '#e08a3c', '#6aa84f', '#3d85c6', '#8e7cc3', '#c27ba0', '#7f8c8d'] as const;
export const isFolderColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const isFolderIcon = (value: unknown): value is WorkspaceFolderIcon => typeof value === 'string' && (WORKSPACE_FOLDER_ICONS as readonly string[]).includes(value);
export interface WorkspaceFolder { id: string; name: string; parentId?: string; order: number; icon?: WorkspaceFolderIcon; color?: string }
export interface WorkspacePlacement { engineId: WorkspaceEngineId; entityId: string; folderId?: string; order: number; pinned?: true }
export interface WorkspaceDocument { engineId: WorkspaceEngineId; entityId: string; title: string; route: string }
export interface WorkspaceLibrary { folders: WorkspaceFolder[]; placements: WorkspacePlacement[]; revision: number }
export const workspaceDocumentKey = (document: Pick<WorkspaceDocument, 'engineId' | 'entityId'>) => JSON.stringify([document.engineId, document.entityId]);
export const workspaceSourcePrefixes: Record<WorkspaceBuiltinEngineId, string> = { 'dialog-scene': 'scene', worldgen: 'world', codex: 'codex', writings: 'wr', maps: 'map', board: 'board', timeline: 'tl', notes: 'note', media: 'media', dictionary: 'language', tables: 'table', genealogy: 'tree', 'character-sheets': 'sheet', radar: 'radar', 'model-viewer': 'model' };

export const workspaceSourcePrefix=(engineId:WorkspaceEngineId)=>engineId.startsWith('local-tool-')?'source-tool':workspaceSourcePrefixes[engineId as WorkspaceBuiltinEngineId];
