import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db } from '@/db/index';
import { getAllBackupStrategies } from '@/engines/_shared/backupRegistry';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
// Engine barrel import guarantees every engine has registered its backup
// strategy before export/import run. Without this import the registry would
// be empty when backup is triggered from a screen that hasn't touched engines.
import '@/engines';

// ============================================
// Structured ZIP Backup — Export & Import
// ============================================
//
// The top-level of this file only handles project metadata (projects,
// tags, settings) and dispatches to per-engine BackupStrategy modules for
// everything else. The old hardcoded legacy block for codex / writings /
// yarn-board / maps / gallery / links was migrated to modular strategies
// on 2026-04-23 — each engine now owns its own backup logic in its
// `index.ts`. See `src/engines/_shared/backupRegistry.ts`.

// Helpers: base64 data URL → binary
function dataUrlToBlob(dataUrl: string): { blob: Uint8Array; ext: string; mime: string } {
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

// Sanitize filename
function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

// ============================================
// EXPORT
// ============================================

/** Serialize one project (metadata + every engine's data) into the zip. */
async function writeProjectToZip(zip: JSZip, project: { id: string; title: string; coverImage?: string }): Promise<void> {
  const projName = sanitize(project.title);
  const projDir = `projects/${projName}__${project.id}`;

  // Project metadata (with cover-image externalization)
  const projMeta = { ...project };
  if (projMeta.coverImage) {
    const { blob, ext } = dataUrlToBlob(projMeta.coverImage);
    zip.file(`${projDir}/cover.${ext}`, blob);
    (projMeta as Record<string, unknown>).coverImage = `cover.${ext}`;
  }
  zip.file(`${projDir}/project.json`, JSON.stringify(projMeta, null, 2));

  // ---- Engine-registered backup strategies ----
  // Every engine — codex, writings, timeline, yarn-board, maps, gallery,
  // links, diary, biography, dialog-scene, brainstorm, outline,
  // writing-stats, storyboard, video-planner, scrapper, character-arc,
  // relationships, seeds, annotations, etc. — writes its own data here.
  for (const strategy of getAllBackupStrategies()) {
    try {
      await strategy.exportProject({ zip, projectId: project.id, projectDir: projDir });
    } catch (err) {
      console.error(`Backup export failed for engine "${strategy.engineId}":`, err);
    }
  }
}

export async function exportFullZip(): Promise<void> {
  const zip = new JSZip();

  const [projects, tags, settings] = await Promise.all([
    db.projects.toArray(),
    db.tags.toArray(),
    db.settings.toArray(),
  ]);

  // --- manifest.json (top level) ---
  zip.file('manifest.json', JSON.stringify({
    app: 'WritersHoard',
    version: 2,
    exportedAt: new Date().toISOString(),
    projectCount: projects.length,
  }, null, 2));

  // --- Global settings & tags ---
  zip.file('settings.json', JSON.stringify(settings, null, 2));
  zip.file('tags.json', JSON.stringify(tags, null, 2));

  // --- Inbox notes ---
  // Quick captures made outside any project belong to no project folder, so
  // the per-engine strategy (which is project-scoped) can never see them.
  // Without this they would be the one thing a "full backup" silently lost.
  const inboxNotes = await db.table('notes').where('projectId').equals(GLOBAL_NOTES_SCOPE).toArray();
  if (inboxNotes.length) {
    zip.file('notes-inbox.json', JSON.stringify(inboxNotes, null, 2));
  }

  // --- Per-project folders ---
  for (const project of projects) {
    await writeProjectToZip(zip, project);
  }

  // Generate and download
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const date = new Date().toISOString().slice(0, 10);
  saveAs(blob, `writers-hoard-backup-${date}.zip`);
}

/**
 * Export a SINGLE project as a ZIP (same structure as the full backup, one
 * project folder). Replaces the legacy 13-table JSON export, which silently
 * dropped every engine table added since the original schema.
 */
export async function exportProjectZip(projectId: string): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    app: 'WritersHoard',
    version: 2,
    exportedAt: new Date().toISOString(),
    projectCount: 1,
    singleProject: true,
  }, null, 2));

  await writeProjectToZip(zip, project);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  saveAs(blob, `${sanitize(project.title)}-project.zip`);
}


// ============================================
// IMPORT
// ============================================

// Read a file from zip, return parsed JSON or null
async function readJson<T>(zip: JSZip, path: string): Promise<T | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async('text');
  return JSON.parse(text) as T;
}

// Read an image file from zip, return base64 data URL
async function readImageAsDataUrl(zip: JSZip, basePath: string, relativePath: string): Promise<string | undefined> {
  if (!relativePath || relativePath.startsWith('data:')) return relativePath || undefined;
  const fullPath = basePath ? `${basePath}/${relativePath}` : relativePath;
  const file = zip.file(fullPath);
  if (!file) return undefined;

  const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const mime = mimeMap[ext] || 'image/png';

  const base64 = await file.async('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * Import a project ZIP WITHOUT wiping the database (merge/restore semantics,
 * unlike `importFullZip` which is a full-database replace).
 *
 * If a project in the zip already exists locally (same id), it is restored
 * in place: the local copy is deleted first (thorough cascade), then the
 * backup's rows are inserted with their original IDs — cross-references
 * survive intact. Brand-new projects are simply added.
 *
 * Returns the ids of the imported projects.
 */
export async function importProjectZip(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(file);

  const manifest = await readJson<{ app: string; version: number }>(zip, 'manifest.json');
  if (!manifest || manifest.app !== 'WritersHoard') {
    throw new Error('Invalid backup file: not a Writer\'s Hoard backup');
  }

  const projectDirs = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(/^projects\/([^/]+)\//);
    if (match) projectDirs.add(`projects/${match[1]}`);
  });
  if (projectDirs.size === 0) throw new Error('Backup contains no projects');

  const { deleteProject } = await import('@/db/operations');
  const importedIds: string[] = [];

  for (const projDir of projectDirs) {
    const projData = await readJson<Record<string, unknown>>(zip, `${projDir}/project.json`);
    if (!projData?.id) continue;
    const projectId = projData.id as string;

    // Restore-in-place: clear any existing copy of this project first.
    const existing = await db.projects.get(projectId);
    if (existing) await deleteProject(projectId);

    if (projData.coverImage && typeof projData.coverImage === 'string' && !projData.coverImage.startsWith('data:')) {
      projData.coverImage = await readImageAsDataUrl(zip, projDir, projData.coverImage as string) || undefined;
    }
    await db.projects.add(projData as never);

    for (const strategy of getAllBackupStrategies()) {
      try {
        await strategy.importProject({ zip, projectId, projectDir: projDir });
      } catch (err) {
        console.error(`Backup import failed for engine "${strategy.engineId}":`, err);
      }
    }
    importedIds.push(projectId);
  }

  return importedIds;
}

export async function importFullZip(file: File): Promise<void> {
  const zip = await JSZip.loadAsync(file);

  // Check manifest
  const manifest = await readJson<{ app: string; version: number }>(zip, 'manifest.json');
  if (!manifest || manifest.app !== 'WritersHoard') {
    throw new Error('Invalid backup file: not a Writer\'s Hoard backup');
  }

  // Clear every table that any BackupStrategy is going to write into, plus
  // the top-level tables this file still owns (projects, tags, settings).
  // Engines added after the original format are covered by strategyTables
  // below. Filter against `db.tables` so older DBs (pre-schema-bump) don't
  // blow up on unknown table names.
  const topLevelTables = ['projects', 'tags', 'settings'];
  const strategyTables = getAllBackupStrategies().flatMap(s => s.tables);
  const knownTables = new Set(db.tables.map(t => t.name));
  const allTables = Array.from(new Set([...topLevelTables, ...strategyTables]))
    .filter(t => knownTables.has(t));

  await db.transaction('rw', allTables.map(t => db.table(t)), async () => {
    await Promise.all(allTables.map(t => db.table(t).clear()));
  });

  // Import global data
  const settings = await readJson<unknown[]>(zip, 'settings.json');
  if (settings?.length) await db.settings.bulkAdd(settings as never[]);

  const tags = await readJson<unknown[]>(zip, 'tags.json');
  if (tags?.length) await db.tags.bulkAdd(tags as never[]);

  // Inbox notes (project-less quick captures). Absent in pre-v21 backups.
  const inboxNotes = await readJson<unknown[]>(zip, 'notes-inbox.json');
  if (inboxNotes?.length) await db.table('notes').bulkAdd(inboxNotes as never[]);

  // Find all project directories
  const projectDirs = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(/^projects\/([^/]+)\//);
    if (match) projectDirs.add(`projects/${match[1]}`);
  });

  for (const projDir of projectDirs) {
    // --- Project ---
    const projData = await readJson<Record<string, unknown>>(zip, `${projDir}/project.json`);
    if (!projData) continue;

    // Restore cover image
    if (projData.coverImage && typeof projData.coverImage === 'string' && !projData.coverImage.startsWith('data:')) {
      projData.coverImage = await readImageAsDataUrl(zip, projDir, projData.coverImage as string) || undefined;
    }
    await db.projects.add(projData as never);

    // --- Engine-registered backup strategies ---
    // Invoke every strategy for this project. Strategies no-op silently if
    // their folder is missing (backward compatible with older backups).
    const projectIdForStrategies = (projData.id as string) || '';
    if (projectIdForStrategies) {
      for (const strategy of getAllBackupStrategies()) {
        try {
          await strategy.importProject({ zip, projectId: projectIdForStrategies, projectDir: projDir });
        } catch (err) {
          console.error(`Backup import failed for engine "${strategy.engineId}":`, err);
        }
      }
    }
  }
}
