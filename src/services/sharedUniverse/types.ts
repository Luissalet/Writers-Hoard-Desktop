import type { Project } from '@/types';

export type SharedCanonEntityKind =
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'world-rule'
  | 'event'
  | 'concept';

export interface SharedEntitySource {
  projectId: string;
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
}

/** Series-owned identity. Full project content remains in its native engine. */
export interface SharedCanonEntity {
  id: string;
  seriesId: string;
  kind: SharedCanonEntityKind;
  title: string;
  summary: string;
  tags: string[];
  origin: SharedEntitySource;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface SharedEntityOverride {
  title?: string;
  summary?: string;
  tags?: string[];
}

export interface SharedEntityBinding {
  id: string;
  seriesId: string;
  sharedEntityId: string;
  projectId: string;
  scope: 'origin' | 'reference' | 'override';
  local?: Omit<SharedEntitySource, 'projectId'>;
  overrides: SharedEntityOverride;
  /** Shared version against which the override was last reviewed. */
  baseVersion: number;
  sharedTitleCache: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedSharedEntity {
  shared: SharedCanonEntity;
  binding: SharedEntityBinding | null;
  title: string;
  summary: string;
  tags: string[];
  scope: SharedEntityBinding['scope'] | 'unbound';
  staleOverride: boolean;
  originAvailable: boolean;
}

export interface SharedEntityDeletionPreview {
  sharedEntityId: string;
  seriesId: string;
  title: string;
  version: number;
  updatedAt: number;
  bindings: Array<Pick<SharedEntityBinding, 'id' | 'projectId' | 'scope' | 'sharedTitleCache' | 'updatedAt'>>;
  confirmationToken: string;
}

export interface SharedUniverseArchive {
  version: 1;
  exportedAt: number;
  seriesProject: Project;
  memberProjectIds: string[];
  entities: SharedCanonEntity[];
  bindings: SharedEntityBinding[];
}

export interface SharedUniverseImportPreview {
  seriesId: string;
  entityCount: number;
  bindingCount: number;
  missingMemberProjectIds: string[];
  collisions: string[];
  confirmationToken: string;
}

export class SharedUniverseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedUniverseConflictError';
  }
}
