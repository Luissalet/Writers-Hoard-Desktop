import type { Project } from '@/types';

export type DuplicateRow = Record<string, unknown>;
export interface ProjectDuplicateSnapshot {
  project: Project;
  parent?: Project;
  tables: Record<string, DuplicateRow[]>;
}
export interface DuplicateFile { path: string; size: number; sha256: string }
export interface DuplicateBinding { module: string; kind: string; object_id: string; title: string; artifact: Record<string, unknown> }
export interface DuplicateExternalSnapshot { version: string; files: DuplicateFile[]; bindings: DuplicateBinding[]; missing: string[] }
export interface DuplicateExternalStage { operationId: string; pathMap: Record<string, string>; version: string }
export interface ProjectDuplicateNative {
  inspect(input: { projectId: string; paths: string[] }): Promise<DuplicateExternalSnapshot>;
  stage(input: { operationId: string; sourceProjectId: string; targetProjectId: string; paths: string[]; expectedExternalVersion: string }): Promise<DuplicateExternalStage>;
  finalize(input: { operationId: string; projectId: string }): Promise<{ complete: boolean; unfinished: string[] }>;
  discard(input: { operationId: string; removeCommitted?: boolean }): Promise<void>;
}
export interface ProjectDuplicatePreview {
  projectId: string;
  title: string;
  sourceVersion: string;
  externalVersion: string;
  counts: Record<string, number>;
  files: DuplicateFile[];
  shared: { parentId?: string; referenceDocuments: number; nativeBindings: number };
  findings: string[];
  canDuplicate: boolean;
}
export interface DuplicateProjectInput { projectId: string; title: string; operationId: string; expectedSourceVersion: string }
export interface ProjectDuplicateResult { projectId: string; operationId: string; complete: boolean; unfinished: string[]; counts: Record<string, number> }
/** Durable operation identity lives in the existing settings store, not authored project metadata. */
export interface ProjectDuplicateReceipt extends ProjectDuplicateResult { sourceProjectId: string; sourceVersion: string; title: string; targetVersion: string; externalTargetVersion?:string; createdAt: number; undone?: boolean }
