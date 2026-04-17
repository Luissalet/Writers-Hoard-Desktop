// ============================================
// Backup Registry — Per-engine export/import strategies
// ============================================
//
// Each engine registers a BackupStrategy that knows how to:
//   1. Serialize its tables into a folder of a project's ZIP backup
//   2. Restore those tables when importing a backup
//
// This replaces the old monolithic switch in services/zipBackup.ts so that
// adding a new engine no longer requires modifying backup code — the engine
// registers itself just like it does for the entity resolver.
//
// Usage in an engine's index.ts:
//
//   import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
//   registerBackupStrategy(makeSimpleBackupStrategy({
//     engineId: 'diary',
//     tables: ['diaryEntries'],
//   }));
//
// For engines with images or nested children, supply a custom strategy:
//
//   registerBackupStrategy({
//     engineId: 'codex',
//     tables: ['codexEntries'],
//     async exportProject(ctx) { ... },
//     async importProject(ctx) { ... },
//   });
// ============================================

import type JSZip from 'jszip';
import { db } from '@/db/index';

// ---------------------------------------------------------------------------
// Helpers shared by every strategy
// ---------------------------------------------------------------------------

export function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

/** Convert a base64 data URL to bytes + extension + mime. */
export function dataUrlToBlob(dataUrl: string): { blob: Uint8Array; ext: string; mime: string } {
  const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!match) return { blob: new Uint8Array(), ext: 'bin', mime: 'application/octet-stream' };
  const mime = match[1];
  let ext = match[2];
  if (ext === 'jpeg') ext = 'jpg';
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: bytes, ext, mime };
}

/** Restore a base64 data URL from a relative path inside the zip. */
export async function readImageAsDataUrl(
  zip: JSZip,
  basePath: string,
  relativePath: string,
): Promise<string | undefined> {
  if (!relativePath || relativePath.startsWith('data:')) return relativePath || undefined;
  const fullPath = basePath ? `${basePath}/${relativePath}` : relativePath;
  const file = zip.file(fullPath);
  if (!file) return undefined;
  const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  const mime = mimeMap[ext] || 'image/png';
  const base64 = await file.async('base64');
  return `data:${mime};base64,${base64}`;
}

/** Read a JSON file from the zip; returns null if missing. */
export async function readJson<T>(zip: JSZip, path: string): Promise<T | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async('text');
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Context objects passed to engine strategies
// ---------------------------------------------------------------------------

export interface ExportContext {
  zip: JSZip;
  projectId: string;
  /** Folder this project owns within the zip, e.g. "projects/MyNovel__abc123" */
  projectDir: string;
}

export interface ImportContext {
  zip: JSZip;
  projectId: string;
  projectDir: string;
}

// ---------------------------------------------------------------------------
// Strategy interface + registry
// ---------------------------------------------------------------------------

export interface BackupStrategy {
  /** Engine id matches EngineDefinition.id */
  engineId: string;
  /** Dexie table names this engine owns. Used for clearing on full import. */
  tables: string[];
  /** Called per project during export. */
  exportProject: (ctx: ExportContext) => Promise<void>;
  /** Called per project during import. */
  importProject: (ctx: ImportContext) => Promise<void>;
}

const STRATEGIES = new Map<string, BackupStrategy>();

export function registerBackupStrategy(strategy: BackupStrategy): void {
  STRATEGIES.set(strategy.engineId, strategy);
}

export function getAllBackupStrategies(): BackupStrategy[] {
  return Array.from(STRATEGIES.values());
}

/** All tables across all registered engines (useful for "clear on import"). */
export function getAllBackupTables(): string[] {
  const tables = new Set<string>();
  for (const s of STRATEGIES.values()) for (const t of s.tables) tables.add(t);
  return Array.from(tables);
}

// ---------------------------------------------------------------------------
// Factory: simple project-scoped JSON dumper
// ---------------------------------------------------------------------------

/**
 * For engines whose tables are plain JSON keyed by `projectId` and contain no
 * inline binary data. Each table is written to
 * `{projectDir}/{folder}/{tableName}.json`.
 *
 * Most non-image engines (diary, biography, dialog-scene, scrapper,
 * video-planner, outline, writing-stats, brainstorm) can use this as-is.
 */
export function makeSimpleBackupStrategy(opts: {
  engineId: string;
  tables: string[];
  /** Folder name under projectDir; defaults to engineId. */
  folder?: string;
  /** Override the FK field name (default: 'projectId'). */
  projectIdField?: string;
}): BackupStrategy {
  const folder = opts.folder ?? opts.engineId;
  const fk = opts.projectIdField ?? 'projectId';

  return {
    engineId: opts.engineId,
    tables: opts.tables,
    async exportProject({ zip, projectId, projectDir }) {
      for (const tableName of opts.tables) {
        const rows = await db.table(tableName)
          .where(fk).equals(projectId).toArray();
        if (rows.length === 0) continue;
        zip.file(`${projectDir}/${folder}/${tableName}.json`, JSON.stringify(rows, null, 2));
      }
    },
    async importProject({ zip, projectDir }) {
      for (const tableName of opts.tables) {
        const rows = await readJson<unknown[]>(
          zip,
          `${projectDir}/${folder}/${tableName}.json`,
        );
        if (rows?.length) await db.table(tableName).bulkAdd(rows as never[]);
      }
    },
  };
}
