import type { CodexEntryType } from '@/types';
import type { CsvOptions, CsvEncoding } from '@/engines/tables/csv';
import type { CodexImportFormat } from '@/engines/genealogy/codexFolderImport';
import type { WorldTable } from '@/engines/tables/types';
import type { CodexPropertyDefinition } from '@/engines/codex/templateTypes';

export type WorldFolderTarget = 'codex' | 'writings' | 'tables' | 'timeline';
export type WorldFolderReferenceKind = WorldFolderTarget | 'media';
export interface WorldFolderImportReference { kind: WorldFolderReferenceKind; id: string; path: string }
/** Portable identities only; no runtime functions or generic original-file archive. */
export interface WorldFolderImportReceipt {
  version: 1; id: string; eraId?: string; format: CodexImportFormat;
  files: { path: string; sha256: string }[];
  refs: WorldFolderImportReference[];
}
export interface WorldFolderFile { path: string; dataBase64: string }
export interface WorldFolderCsvMapping { title: number; description?: number; start?: number; end?: number; lane?: number; dateMode?: 'calendar' | 'text' }
export interface WorldFolderDecision {
  path: string; include?: boolean; target?: WorldFolderTarget; title?: string;
  type?: CodexEntryType; templateId?: string;
  csv?: CsvOptions & { encoding?: CsvEncoding; mapping?: WorldFolderCsvMapping };
  excludedRows?: number[];
}
export interface WorldFolderInput { format: CodexImportFormat; files: WorldFolderFile[]; decisions?: WorldFolderDecision[] }
export interface WorldFolderFinding { path: string; code: string; message: string; blocking: boolean; row?: number }
export interface WorldFolderEvent { id: string; title: string; description: string; date: string; dateMode: 'text' | 'calendar'; realDate?: string; realDateEnd?: string; lane: string }
export interface WorldFolderPlanRow {
  path: string; sourcePath: string; title: string; target: WorldFolderTarget; id: string; reason: string;
  status: 'new' | 'duplicate' | 'conflict' | 'excluded'; type?: CodexEntryType; templateId?: string;
  content?: string; fields?: Record<string,string>; tags?: string[]; propertyDefinitions?: CodexPropertyDefinition[];
  table?: WorldTable; events?: WorldFolderEvent[];
  csv?: { headers: string[]; records: string[][]; delimiter: string };
}
export interface WorldFolderPlan {
  digest: string; contextVersion: string; rows: WorldFolderPlanRow[]; findings: WorldFolderFinding[];
  files: { path: string; sha256: string }[]; assets: { path: string; kind: 'raster' | 'media' | 'unsupported'; used: boolean; id?: string; mime?: string; status?: 'new'|'duplicate'|'conflict'|'excluded' }[];
}
