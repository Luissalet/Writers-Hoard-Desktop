export const eraDocumentKinds = ['dialog-scene', 'codex', 'writings', 'maps', 'worldgen', 'board', 'timeline', 'notes', 'dictionary', 'tables', 'genealogy', 'character-sheets', 'radar', 'model-viewer', 'media', 'local-tool'] as const;
export type EraDocumentKind = typeof eraDocumentKinds[number];
export interface WorldEra { readerCover?: import('@/engines/writings/readerPresentationTypes').ReaderPresentation['cover']; localToolStates?: import('@/engines/local/stateTypes').LocalToolStates; id: string; name: string; description: string; theme?: { accent?: string; background?: string }; workspaceAppearance?: import('@/services/workspaceAppearance/types').WorkspaceAppearance; defaults?: Pick<import('@/types').Project, 'worldCalendar' | 'workspaceFolders' | 'workspacePlacements' | 'workspaceRevision' | 'wikiOptions' | 'writingToolDock'>; revision: number; createdAt: number; updatedAt: number; archived?: boolean }
export interface WorldEraScope { projectId: string; eraId?: string }
export type EraRow = Record<string, unknown> & { id: string };
export interface EraDocument { root: EraRow; children: Record<string, EraRow[]> }
export interface WorldEraVariantState { revision: number; updatedAt: number; hidden?: boolean; archived?: boolean; document?: EraDocument }
export interface WorldEraAsset { id: string; projectId: string; sha256: string; payload: Record<string, unknown> }
export interface WorldEraVariant extends WorldEraVariantState { id: string; projectId: string; eraId: string; kind: EraDocumentKind; entityId: string; revision: number; updatedAt: number; hidden?: boolean; archived?: boolean; document?: EraDocument; history?: WorldEraVariantState[] }
export interface EraDocumentRead { document: EraDocument; provenance: 'base' | 'variant'; version: string; variantRevision: number | null }
export const eraDocumentKey = (kind: EraDocumentKind, id: string) => JSON.stringify([kind, id]);
export class WorldEraConflict extends Error { constructor() { super('world_era_conflict'); this.name = 'WorldEraConflict'; } }
