export interface EntityLink {
  id: string;
  projectId: string;
  sourceEngineId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceTitle: string;
  targetEngineId: string;
  targetEntityType: string;
  targetEntityId: string;
  targetTitle: string;
  relation: string;
  notes?: string;
  provenance: 'manual' | 'conversion' | 'migration';
  createdAt: number;
  updatedAt: number;
}

export interface Citation {
  id: string;
  projectId: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  accessedAt: string;
  url?: string;
  notes?: string;
  snapshotId?: string;
  writingIds: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type PublishingFormat = 'manuscript' | 'screenplay' | 'research' | 'biography' | 'video';

export interface PublishingProfile {
  id: string;
  projectId: string;
  name: string;
  format: PublishingFormat;
  includeTitlePage: boolean;
  includeSynopsis: boolean;
  includeBibliography: boolean;
  citationStyle: 'apa' | 'mla' | 'chicago';
  selectedWritingIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversionReceipt {
  id: string;
  projectId: string;
  sourceEngineId: string;
  sourceEntityId: string;
  targetEngineId: string;
  targetEntityId: string;
  targetTable: string;
  preview: string;
  undoPayload: Record<string, unknown>;
  createdAt: number;
  undoneAt?: number;
}
