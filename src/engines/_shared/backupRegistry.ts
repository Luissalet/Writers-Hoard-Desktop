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

// ---------------------------------------------------------------------------
// Preloaded archives — why a restore never reads bytes out of JSZip
// ---------------------------------------------------------------------------
//
// JSZip pumps every `async()` read through its own `setImmediate`, so a single
// read hands control back to the event loop. Dexie only carries a transaction's
// zone across MICROtasks, which means the code that resumes after such a read is
// no longer inside the restore's transaction: its next write opens a SECOND
// readwrite transaction over stores the first one already holds, IndexedDB
// queues that one behind the first, the first cannot commit until the strategy
// returns — and the two wait for each other for ever. That is the restore hang
// of 2026-08-31, and it is not specific to any one table; it is the first table
// an archive happens to carry.
//
// Reading the whole archive before the transaction opens turns every read
// inside it into a plain value, so a strategy can go on reading and writing in
// the order that reads best.
const PRELOADED = new WeakMap<JSZip, Map<string, Uint8Array>>();

const ARCHIVE_TEXT = new TextDecoder();

/** btoa needs a binary string, and a whole image at once blows the arg limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * Decompress a whole archive so its strategies can run inside one Dexie
 * transaction. Call it OUTSIDE the transaction. The cost is one uncompressed
 * copy of an archive the caller already holds in memory, and it is released
 * with the JSZip instance it belongs to.
 */
export async function preloadArchive(zip: JSZip, excludedPrefixes: readonly string[] = []): Promise<void> {
  if (PRELOADED.has(zip)) return;
  const paths: string[] = [];
  zip.forEach((_relativePath, file) => {
    if (!file.dir && !excludedPrefixes.some(prefix => file.name.startsWith(prefix))) paths.push(file.name);
  });
  const contents = new Map<string, Uint8Array>();
  for (const path of paths) {
    const file = zip.file(path);
    if (file) contents.set(path, await file.async('uint8array'));
  }
  PRELOADED.set(zip, contents);
}

/**
 * One entry of a preloaded archive. `undefined` means the archive was never
 * preloaded — export, and the tests that drive a strategy directly — so the
 * caller falls back to reading JSZip; `null` means it was preloaded and the
 * entry is genuinely absent.
 */
function preloadedEntry(zip: JSZip, path: string): Uint8Array | null | undefined {
  const contents = PRELOADED.get(zip);
  if (!contents) return undefined;
  const bytes = contents.get(path);
  if (bytes !== undefined) return bytes;
  // An entry the preload never saw was written after it ran. Reading it would
  // yield to the event loop in the middle of the restore transaction, which is
  // the deadlock the preload exists to prevent, so name it instead of hanging.
  if (zip.file(path)) {
    throw new Error(`Archive entry "${path}" was written after the archive was read.`);
  }
  return null;
}

/** Restore a base64 data URL from a relative path inside the zip. */
export async function readImageAsDataUrl(
  zip: JSZip,
  basePath: string,
  relativePath: string,
): Promise<string | undefined> {
  if (!relativePath || relativePath.startsWith('data:')) return relativePath || undefined;
  const fullPath = basePath ? `${basePath}/${relativePath}` : relativePath;
  const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  const mime = mimeMap[ext] || 'image/png';
  const preloaded = preloadedEntry(zip, fullPath);
  if (preloaded !== undefined) {
    return preloaded === null ? undefined : `data:${mime};base64,${bytesToBase64(preloaded)}`;
  }
  const file = zip.file(fullPath);
  if (!file) return undefined;
  const base64 = await file.async('base64');
  return `data:${mime};base64,${base64}`;
}

/** Read a JSON file from the zip; returns null if missing. */
export async function readJson<T>(zip: JSZip, path: string): Promise<T | null> {
  const preloaded = preloadedEntry(zip, path);
  if (preloaded !== undefined) {
    return preloaded === null ? null : (JSON.parse(ARCHIVE_TEXT.decode(preloaded)) as T);
  }
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

/**
 * One archive section and the exact Dexie rows an import strategy will write.
 *
 * Scope validation consumes this read-only description before the restore
 * transaction opens. Custom strategies must describe every table they own;
 * otherwise a new import path could accidentally bypass the common guard.
 */
export interface BackupImportSection {
  table: string;
  path: string;
  rows: readonly unknown[];
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
  /**
   * Read-only inventory of every row `importProject` can write. The common ZIP
   * preflight verifies project ownership, primary keys and parent/reference
   * containment from this inventory before any table is cleared or written.
   */
  inspectImport: (ctx: ImportContext) => Promise<BackupImportSection[]>;
  /**
   * Optional read-only validation run before a destructive restore starts.
   * It must not write to Dexie. Import still runs inside a transaction, but
   * preflight produces a useful error before any clearing work is attempted.
   */
  preflightImport?: (ctx: ImportContext) => Promise<void>;
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
// Image externalization — reduce boilerplate for engines that store base64
// ---------------------------------------------------------------------------

/**
 * Takes a base64 data URL, writes it as a binary file inside the zip, and
 * returns the relative path that should replace the field in the exported
 * JSON. No-op for already-relative values (e.g. re-exports of imported data).
 *
 * @param zip The JSZip instance being built.
 * @param basePath Folder (relative to zip root) where the image should live.
 *                 Example: `projects/MyNovel__abc/codex/Draven__xyz`.
 * @param dataUrl The `data:image/...;base64,...` value from the DB row.
 * @param basename Filename stem without extension. Example: `avatar`, `cover`,
 *                 `001_thumb`, `node-images/xyz`.
 * @returns The relative path (e.g. `avatar.png`) to store in the JSON, or
 *          `undefined` if the input was not a data URL.
 */
export function externalizeImage(
  zip: JSZip,
  basePath: string,
  dataUrl: string | undefined | null,
  basename: string,
): string | undefined {
  if (!dataUrl) return undefined;
  if (!dataUrl.startsWith('data:')) return dataUrl; // already relative — trust the caller
  const { blob, ext } = dataUrlToBlob(dataUrl);
  if (blob.byteLength === 0) return undefined;
  const filename = `${basename}.${ext}`;
  zip.file(`${basePath}/${filename}`, blob);
  return filename;
}

/**
 * Inverse of `externalizeImage` — resolves a stored path back to a
 * data-URL so it can round-trip into Dexie. Thin alias over
 * `readImageAsDataUrl` to read fluently in the same import/export pair.
 */
export const internalizeImage = readImageAsDataUrl;

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
  /** Per-table ownership fields for a mixed strategy (for example seriesId). */
  projectIdFields?: Readonly<Record<string, string>>;
}): BackupStrategy {
  const folder = opts.folder ?? opts.engineId;

  const projectScopeField = (tableName: string): string =>
    opts.projectIdFields?.[tableName] ?? opts.projectIdField ?? 'projectId';

  const assertProjectScopeIndex = (tableName: string): void => {
    const table = db.table(tableName);
    const fk = projectScopeField(tableName);
    const hasIndex = table.schema.primKey.name === fk || Boolean(table.schema.idxByName[fk]);
    if (!hasIndex) {
      throw new Error(
        `Backup strategy "${opts.engineId}" cannot scope table "${tableName}" by "${fk}". ` +
        'Use a custom parent-aware strategy for child-only tables.',
      );
    }
  };

  const inspectImport = async ({ zip, projectDir }: ImportContext): Promise<BackupImportSection[]> => {
    const sections: BackupImportSection[] = [];
    for (const tableName of opts.tables) {
      assertProjectScopeIndex(tableName);
      const path = `${projectDir}/${folder}/${tableName}.json`;
      const rows = await readJson<unknown>(zip, path);
      if (rows !== null && !Array.isArray(rows)) {
        throw new Error(`Expected "${path}" to contain a JSON array.`);
      }
      sections.push({ table: tableName, path, rows: rows ?? [] });
    }
    return sections;
  };

  return {
    engineId: opts.engineId,
    tables: opts.tables,
    async exportProject({ zip, projectId, projectDir }) {
      for (const tableName of opts.tables) {
        assertProjectScopeIndex(tableName);
        const fk = projectScopeField(tableName);
        const rows = await db.table(tableName)
          .where(fk).equals(projectId).toArray();
        if (rows.length === 0) continue;
        zip.file(`${projectDir}/${folder}/${tableName}.json`, JSON.stringify(rows, null, 2));
      }
    },
    inspectImport,
    async preflightImport(context) {
      await inspectImport(context);
    },
    async importProject({ zip, projectDir }) {
      for (const tableName of opts.tables) {
        assertProjectScopeIndex(tableName);
        const rows = await readJson<unknown[]>(
          zip,
          `${projectDir}/${folder}/${tableName}.json`,
        );
        // bulkPut, not bulkAdd: a restore must be idempotent. A surviving row
        // (a table the clear could not reach, or a retried import) turned an
        // add into a ConstraintError that rolled the whole restore back.
        if (rows?.length) await db.table(tableName).bulkPut(rows as never[]);
      }
    },
  };
}
