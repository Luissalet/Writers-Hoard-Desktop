export type ArchivedDocumentKind = 'local-tool' | 'codex' | 'maps' | 'board' | 'timeline' | 'writings' | 'dictionary' | 'tables' | 'relation-tree' | 'model-viewer' | 'character-sheets' | 'radar';
export interface ArchiveMutation {
  table: string;
  key: string;
  /** Whole rows are stored only when their existence changed. */
  beforeRow?: Record<string, unknown>;
  afterRow?: Record<string, unknown>;
  /** Updated rows carry only changed fields, excluding unchanged media bytes. */
  fields?: string[];
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
}
export interface DocumentArchive {
  id: string;
  projectId: string;
  kind: ArchivedDocumentKind;
  sourceId: string;
  title: string;
  archivedAt: number;
  schema: 1;
  mutations: ArchiveMutation[];
  metadata?: { field: string; item: Record<string, unknown>; index: number };
}
