import Dexie from 'dexie';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db } from '@/db/index';
import {
  getAllBackupStrategies,
  type BackupStrategy,
} from '@/engines/_shared/backupRegistry';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
// Engine initialization is part of the backup contract: every strategy must
// be registered before an archive is inspected, exported, or restored.
import '@/engines';

const BACKUP_VERSION = 3;
const MIN_SUPPORTED_BACKUP_VERSION = 1;

export type BackupPhase = 'export' | 'preflight' | 'import';

export interface BackupFailure {
  phase: BackupPhase;
  message: string;
  engineId?: string;
  projectId?: string;
  projectDir?: string;
  path?: string;
}

/**
 * Public, structured failure surfaced by every ZIP backup operation.
 * Callers can keep showing a generic toast today and render the individual
 * failures later without parsing console strings.
 */
export class BackupOperationError extends Error {
  readonly phase: BackupPhase;
  readonly failures: BackupFailure[];

  constructor(phase: BackupPhase, failures: BackupFailure[]) {
    super(
      failures.length === 1
        ? failures[0].message
        : `${failures.length} backup ${phase} failures`,
    );
    this.name = 'BackupOperationError';
    this.phase = phase;
    this.failures = failures;
  }
}

/** Turn structured backup failures into concise, user-visible diagnostics. */
export function describeBackupError(error: unknown, fallback: string): string {
  if (!(error instanceof BackupOperationError)) return fallback;
  const details = error.failures
    .slice(0, 3)
    .map(row => `${row.engineId ? `${row.engineId}: ` : ''}${row.message}`)
    .join(' · ');
  const remaining = error.failures.length - 3;
  return `${fallback} (${error.phase})${details ? `: ${details}` : ''}${
    remaining > 0 ? ` · +${remaining} more` : ''
  }`;
}

interface BackupManifest {
  app: 'WritersHoard';
  version: number;
  exportedAt: string;
  projectCount: number;
  singleProject?: boolean;
  externalAssets?: {
    scrapper: {
      included: false;
      restorePolicy: 'reset-unavailable';
    };
  };
}

interface ProjectRecord {
  id: string;
  title: string;
  coverImage?: string;
}

interface PreparedProject {
  projectId: string;
  projectDir: string;
  project: ProjectRecord;
}

interface PreflightResult {
  manifest: BackupManifest;
  projects: PreparedProject[];
  json: Map<string, unknown>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  phase: BackupPhase,
  error: unknown,
  details: Omit<BackupFailure, 'phase' | 'message'> = {},
): BackupFailure {
  return { phase, message: messageOf(error), ...details };
}

function wrapFailure(
  phase: BackupPhase,
  error: unknown,
  details: Omit<BackupFailure, 'phase' | 'message'> = {},
): BackupOperationError {
  return error instanceof BackupOperationError
    ? error
    : new BackupOperationError(phase, [failure(phase, error, details)]);
}

function dataUrlToBlob(dataUrl: string): { blob: Uint8Array; ext: string } {
  const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!match) return { blob: new Uint8Array(), ext: 'bin' };
  let ext = match[2];
  if (ext === 'jpeg') ext = 'jpg';
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: bytes, ext };
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

function manifestFor(projectCount: number, singleProject = false): BackupManifest {
  return {
    app: 'WritersHoard',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    projectCount,
    ...(singleProject ? { singleProject: true } : {}),
    externalAssets: {
      scrapper: {
        included: false,
        restorePolicy: 'reset-unavailable',
      },
    },
  };
}

function projectDirectories(zip: JSZip): string[] {
  const dirs = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(/^projects\/([^/]+)\//);
    if (match) dirs.add(`projects/${match[1]}`);
  });
  return [...dirs].sort();
}

async function readImageAsDataUrl(
  zip: JSZip,
  basePath: string,
  relativePath: string,
): Promise<string | undefined> {
  if (!relativePath || relativePath.startsWith('data:')) return relativePath || undefined;
  const fullPath = `${basePath}/${relativePath}`;
  const file = zip.file(fullPath);
  if (!file) return undefined;
  const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  const base64 = await file.async('base64');
  return `data:${mimeMap[ext] || 'image/png'};base64,${base64}`;
}

async function exportStrategies(
  zip: JSZip,
  project: ProjectRecord,
  projectDir: string,
  failures: BackupFailure[],
): Promise<void> {
  for (const strategy of getAllBackupStrategies()) {
    try {
      await strategy.exportProject({
        zip,
        projectId: project.id,
        projectDir,
      });
    } catch (error) {
      failures.push(
        failure('export', error, {
          engineId: strategy.engineId,
          projectId: project.id,
          projectDir,
        }),
      );
    }
  }
}

async function writeProjectToZip(
  zip: JSZip,
  project: ProjectRecord,
  failures: BackupFailure[],
): Promise<void> {
  const projectDir = `projects/${sanitize(project.title)}__${project.id}`;
  const metadata: ProjectRecord = { ...project };
  if (metadata.coverImage) {
    const { blob, ext } = dataUrlToBlob(metadata.coverImage);
    if (blob.byteLength === 0) {
      failures.push(
        failure('export', 'Project cover is not a valid image data URL.', {
          projectId: project.id,
          projectDir,
          path: `${projectDir}/cover.${ext}`,
        }),
      );
    } else {
      zip.file(`${projectDir}/cover.${ext}`, blob);
      metadata.coverImage = `cover.${ext}`;
    }
  }
  zip.file(`${projectDir}/project.json`, JSON.stringify(metadata, null, 2));
  await exportStrategies(zip, project, projectDir, failures);
}

export async function exportFullZip(): Promise<void> {
  const zip = new JSZip();
  const failures: BackupFailure[] = [];
  try {
    const [projects, tags, settings] = await Promise.all([
      db.projects.toArray(),
      db.tags.toArray(),
      db.settings.toArray(),
    ]);

    zip.file('manifest.json', JSON.stringify(manifestFor(projects.length), null, 2));
    zip.file('settings.json', JSON.stringify(settings, null, 2));
    zip.file('tags.json', JSON.stringify(tags, null, 2));

    const inboxNotes = await db
      .table('notes')
      .where('projectId')
      .equals(GLOBAL_NOTES_SCOPE)
      .toArray();
    zip.file('notes-inbox.json', JSON.stringify(inboxNotes, null, 2));

    for (const project of projects) {
      await writeProjectToZip(zip, project as ProjectRecord, failures);
    }
    if (failures.length) throw new BackupOperationError('export', failures);

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    saveAs(blob, `writers-hoard-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (error) {
    throw wrapFailure('export', error);
  }
}

export async function exportProjectZip(projectId: string): Promise<void> {
  const zip = new JSZip();
  const failures: BackupFailure[] = [];
  try {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    zip.file('manifest.json', JSON.stringify(manifestFor(1, true), null, 2));
    await writeProjectToZip(zip, project as ProjectRecord, failures);
    if (failures.length) throw new BackupOperationError('export', failures);

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    saveAs(blob, `${sanitize(project.title)}-project.zip`);
  } catch (error) {
    throw wrapFailure('export', error, { projectId });
  }
}

function expectArray(
  json: Map<string, unknown>,
  path: string,
  failures: BackupFailure[],
  required = false,
): unknown[] {
  const value = json.get(path);
  if (value === undefined) {
    if (required) {
      failures.push(
        failure('preflight', `Backup is missing required file "${path}".`, { path }),
      );
    }
    return [];
  }
  if (!Array.isArray(value)) {
    failures.push(
      failure('preflight', `Expected "${path}" to contain a JSON array.`, { path }),
    );
    return [];
  }
  return value;
}

async function parseAllJson(
  zip: JSZip,
  failures: BackupFailure[],
): Promise<Map<string, unknown>> {
  const parsed = new Map<string, unknown>();
  const paths = Object.keys(zip.files)
    .filter((path) => !zip.files[path].dir && path.toLowerCase().endsWith('.json'))
    .sort();
  for (const path of paths) {
    try {
      parsed.set(path, JSON.parse(await zip.files[path].async('text')));
    } catch (error) {
      failures.push(failure('preflight', error, { path }));
    }
  }
  return parsed;
}

function validateManifest(
  value: unknown,
  mode: 'project' | 'full',
  failures: BackupFailure[],
): BackupManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(failure('preflight', 'Missing or invalid manifest.json.', {
      path: 'manifest.json',
    }));
    return null;
  }
  const manifest = value as Partial<BackupManifest>;
  if (manifest.app !== 'WritersHoard') {
    failures.push(failure('preflight', 'Archive is not a Writers Hoard backup.', {
      path: 'manifest.json',
    }));
  }
  if (
    !Number.isInteger(manifest.version) ||
    manifest.version! < MIN_SUPPORTED_BACKUP_VERSION ||
    manifest.version! > BACKUP_VERSION
  ) {
    failures.push(
      failure(
        'preflight',
        `Unsupported backup version "${String(manifest.version)}". ` +
          `Supported versions are ${MIN_SUPPORTED_BACKUP_VERSION}-${BACKUP_VERSION}.`,
        { path: 'manifest.json' },
      ),
    );
  }
  if (!Number.isInteger(manifest.projectCount) || manifest.projectCount! < 0) {
    failures.push(
      failure(
        'preflight',
        'Backup projectCount must be a non-negative integer.',
        { path: 'manifest.json' },
      ),
    );
  }
  if (
    manifest.version === BACKUP_VERSION &&
    (manifest.externalAssets?.scrapper?.included !== false ||
      manifest.externalAssets.scrapper.restorePolicy !== 'reset-unavailable')
  ) {
    failures.push(
      failure(
        'preflight',
        'Backup does not declare the supported Scrapper external-asset restore policy.',
        { path: 'manifest.json' },
      ),
    );
  }
  if (mode === 'full' && manifest.singleProject) {
    failures.push(
      failure(
        'preflight',
        'A single-project archive cannot replace the entire database. Use project import instead.',
        { path: 'manifest.json' },
      ),
    );
  }
  return manifest as BackupManifest;
}

async function runStrategyPreflight(
  zip: JSZip,
  projects: PreparedProject[],
  failures: BackupFailure[],
): Promise<void> {
  for (const project of projects) {
    for (const strategy of getAllBackupStrategies()) {
      if (!strategy.preflightImport) continue;
      try {
        await strategy.preflightImport({
          zip,
          projectId: project.projectId,
          projectDir: project.projectDir,
        });
      } catch (error) {
        failures.push(
          failure('preflight', error, {
            engineId: strategy.engineId,
            projectId: project.projectId,
            projectDir: project.projectDir,
          }),
        );
      }
    }
  }
}

async function preflightArchive(
  zip: JSZip,
  mode: 'project' | 'full',
): Promise<PreflightResult> {
  const failures: BackupFailure[] = [];
  const json = await parseAllJson(zip, failures);
  const manifest = validateManifest(json.get('manifest.json'), mode, failures);
  const dirs = projectDirectories(zip);
  if (mode === 'project' && dirs.length === 0) {
    failures.push(failure('preflight', 'Backup contains no projects.'));
  }
  if (
    manifest &&
    Number.isInteger(manifest.projectCount) &&
    manifest.projectCount !== dirs.length
  ) {
    failures.push(
      failure(
        'preflight',
        `Manifest declares ${manifest.projectCount} project(s), but the archive contains ${dirs.length}.`,
        { path: 'manifest.json' },
      ),
    );
  }

  if (mode === 'full') {
    expectArray(json, 'settings.json', failures, true);
    expectArray(json, 'tags.json', failures, true);
    expectArray(
      json,
      'notes-inbox.json',
      failures,
      manifest?.version === BACKUP_VERSION,
    );
  }

  const projects: PreparedProject[] = [];
  const projectIds = new Set<string>();
  for (const projectDir of dirs) {
    const path = `${projectDir}/project.json`;
    const raw = json.get(path);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      failures.push(failure('preflight', `Missing or invalid "${path}".`, { path }));
      continue;
    }
    const project = { ...(raw as ProjectRecord) };
    if (typeof project.id !== 'string' || !project.id.trim()) {
      failures.push(failure('preflight', `Project in "${path}" has no valid id.`, { path }));
      continue;
    }
    if (typeof project.title !== 'string') {
      failures.push(
        failure('preflight', `Project "${project.id}" has no valid title.`, {
          projectId: project.id,
          projectDir,
          path,
        }),
      );
      continue;
    }
    if (projectIds.has(project.id)) {
      failures.push(
        failure('preflight', `Duplicate project id "${project.id}" in archive.`, {
          projectId: project.id,
          projectDir,
          path,
        }),
      );
      continue;
    }
    projectIds.add(project.id);

    if (project.coverImage !== undefined && typeof project.coverImage !== 'string') {
      failures.push(
        failure('preflight', `Project "${project.id}" has an invalid cover image.`, {
          projectId: project.id,
          projectDir,
          path,
        }),
      );
    } else if (project.coverImage && !project.coverImage.startsWith('data:')) {
      const cover = await readImageAsDataUrl(zip, projectDir, project.coverImage);
      if (!cover) {
        failures.push(
          failure(
            'preflight',
            `Missing project cover "${projectDir}/${project.coverImage}".`,
            {
              projectId: project.id,
              projectDir,
              path: `${projectDir}/${project.coverImage}`,
            },
          ),
        );
      } else {
        project.coverImage = cover;
      }
    }
    projects.push({ projectId: project.id, projectDir, project });
  }

  await runStrategyPreflight(zip, projects, failures);
  if (failures.length || !manifest) {
    throw new BackupOperationError('preflight', failures);
  }
  return { manifest, projects, json };
}

async function loadAndPreflight(
  file: File,
  mode: 'project' | 'full',
): Promise<{ zip: JSZip; prepared: PreflightResult }> {
  try {
    const zip = await JSZip.loadAsync(file);
    return { zip, prepared: await preflightArchive(zip, mode) };
  } catch (error) {
    throw wrapFailure('preflight', error, { path: file.name });
  }
}

async function importStrategy(
  strategy: BackupStrategy,
  zip: JSZip,
  project: PreparedProject,
): Promise<void> {
  try {
    // Strategy implementations read JSZip data as well as writing Dexie.
    // waitFor keeps the surrounding restore transaction alive across those
    // non-IndexedDB promises, so any later failure rolls every table back.
    await Dexie.waitFor(
      strategy.importProject({
        zip,
        projectId: project.projectId,
        projectDir: project.projectDir,
      }),
    );
  } catch (error) {
    throw new BackupOperationError('import', [
      failure('import', error, {
        engineId: strategy.engineId,
        projectId: project.projectId,
        projectDir: project.projectDir,
      }),
    ]);
  }
}

async function importProjectStrategies(
  zip: JSZip,
  project: PreparedProject,
): Promise<void> {
  for (const strategy of getAllBackupStrategies()) {
    await importStrategy(strategy, zip, project);
  }
}

/**
 * Delete one project's rows inside the caller's transaction. This mirrors the
 * generic project deletion path while also clearing world snapshots, whose
 * table is intentionally keyed only by worldId.
 */
async function clearProjectForRestore(projectId: string): Promise<void> {
  const projectScoped = db.tables.filter(
    (table) => table.name !== 'projects' && 'projectId' in table.schema.idxByName,
  );
  const [sceneIds, storyboardIds, annotationIds, worldIds] = await Promise.all([
    db.scenes.where('projectId').equals(projectId).primaryKeys(),
    db.storyboards.where('projectId').equals(projectId).primaryKeys(),
    db.annotations.where('projectId').equals(projectId).primaryKeys(),
    db.generatedWorlds.where('projectId').equals(projectId).primaryKeys(),
  ]);

  if (sceneIds.length) {
    await db.sceneCasts.where('sceneId').anyOf(sceneIds as string[]).delete();
  }
  if (storyboardIds.length) {
    await db.storyboardConnectors
      .where('storyboardId')
      .anyOf(storyboardIds as string[])
      .delete();
  }
  if (annotationIds.length) {
    await db.annotationReferences
      .where('annotationId')
      .anyOf(annotationIds as string[])
      .delete();
  }
  if (worldIds.length) {
    await db.worldSnapshots.bulkDelete(worldIds as string[]);
  }
  for (const table of projectScoped) {
    await table.where('projectId').equals(projectId).delete();
  }
  await db.projects.delete(projectId);
}

export async function importProjectZip(file: File): Promise<string[]> {
  const { zip, prepared } = await loadAndPreflight(file, 'project');
  try {
    await db.transaction('rw', db.tables, async () => {
      for (const project of prepared.projects) {
        if (await db.projects.get(project.projectId)) {
          await clearProjectForRestore(project.projectId);
        }
        await db.projects.add(project.project as never);
        await importProjectStrategies(zip, project);
      }
    });
    return prepared.projects.map((project) => project.projectId);
  } catch (error) {
    throw wrapFailure('import', error);
  }
}

export async function importFullZip(file: File): Promise<void> {
  const { zip, prepared } = await loadAndPreflight(file, 'full');
  const settings = expectArray(prepared.json, 'settings.json', []);
  const tags = expectArray(prepared.json, 'tags.json', []);
  const inboxNotes = expectArray(prepared.json, 'notes-inbox.json', []);

  try {
    await db.transaction('rw', db.tables, async () => {
      // Clear and restore are one transaction. If any strategy fails, Dexie
      // rolls the entire database back to its pre-import state.
      await Promise.all(db.tables.map((table) => table.clear()));
      if (settings.length) await db.settings.bulkAdd(settings as never[]);
      if (tags.length) await db.tags.bulkAdd(tags as never[]);
      if (inboxNotes.length) await db.table('notes').bulkAdd(inboxNotes as never[]);

      for (const project of prepared.projects) {
        await db.projects.add(project.project as never);
        await importProjectStrategies(zip, project);
      }
    });
  } catch (error) {
    throw wrapFailure('import', error);
  }
}
