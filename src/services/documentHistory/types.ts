import type { EraDocument, EraDocumentKind } from '@/services/worldEras/types';
export interface DocumentHistoryEntry { id: string; projectId: string; kind: EraDocumentKind; entityId: string; title: string; createdAt: number; version: string; reason: 'edit' | 'manual' | 'pre-restore'; document: EraDocument; assetIds: string[]; codexPropertyDefinitions?: import('@/engines/codex/templateTypes').CodexPropertyDefinition[] }
export type DocumentHistorySummary = Omit<DocumentHistoryEntry, 'document' | 'assetIds' | 'codexPropertyDefinitions'>;
export interface DocumentHistoryUndo { projectId: string; kind: EraDocumentKind; entityId: string; historyId: string | null; expectedVersion: string }
export class DocumentHistoryConflict extends Error { constructor() { super('document_history_conflict'); this.name = 'DocumentHistoryConflict'; } }
