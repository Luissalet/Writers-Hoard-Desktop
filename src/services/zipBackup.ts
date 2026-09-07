import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db } from '@/db/index';
import { projectSettingKeys } from '@/db/operations';
import {
  getAllBackupStrategies,
  preloadArchive,
  type BackupImportSection,
  type BackupStrategy,
} from '@/engines/_shared/backupRegistry';
import {
  validateBackupScopes,
  type ScopedBackupProject,
} from '@/engines/_shared/backupScope';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
import { lexicalTerms, sha256Hex } from '@/services/judge/text';
import type { ReferenceDocument, ReferenceLens, ReferenceSection } from '@/services/judge/types';
// Engine initialization is part of the backup contract: every strategy must
// be registered before an archive is inspected, exported, or restored.
import '@/engines';

const BACKUP_VERSION = 4;
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
  referenceLibrary?: {
    included: boolean;
    originals: boolean;
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
  referenceLibrary: PreparedReferenceLibrary;
}

interface ArchivedReferenceDocument extends Omit<ReferenceDocument, 'original'> {
  originalPath: string;
}

interface ReferenceLibraryArchive {
  documents: ArchivedReferenceDocument[];
  sections: ReferenceSection[];
  lenses: ReferenceLens[];
}

interface PreparedReferenceLibrary {
  documents: ReferenceDocument[];
  sections: ReferenceSection[];
  lenses: ReferenceLens[];
}

const EMPTY_REFERENCE_LIBRARY: PreparedReferenceLibrary = {
  documents: [],
  sections: [],
  lenses: [],
};

export interface ProjectZipImportProject {
  id: string;
  title: string;
}

export interface ProjectZipImportCollision {
  projectId: string;
  incomingTitle: string;
  existingTitle: string;
}

export interface ProjectZipImportPreview {
  projects: ProjectZipImportProject[];
  collisions: ProjectZipImportCollision[];
}

export interface ProjectZipImportOptions {
  /**
   * Exact project IDs the user explicitly approved replacing after preview.
   * Any other collision aborts the complete transaction before it mutates data.
   */
  replaceProjectIds?: readonly string[];
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
    referenceLibrary: {
      included: !singleProject,
      originals: !singleProject,
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

async function writeReferenceLibraryToZip(
  zip: JSZip,
  failures: BackupFailure[],
): Promise<void> {
  const [documents, sections, lenses] = await Promise.all([
    db.referenceDocuments.toArray(),
    db.referenceSections.toArray(),
    db.referenceLenses.toArray(),
  ]);
  const archivedDocuments: ArchivedReferenceDocument[] = [];
  for (const document of documents) {
    try {
      const bytes = new Uint8Array(await document.original.arrayBuffer());
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== document.sha256) {
        throw new Error(`Reference original "${document.name}" no longer matches its recorded SHA-256.`);
      }
      const originalPath = `reference-library/originals/${encodeURIComponent(document.id)}.bin`;
      zip.file(originalPath, bytes);
      const metadata: Omit<ReferenceDocument, 'original'> = {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        size: document.size,
        sha256: document.sha256,
        version: document.version,
        status: document.status,
        ...(document.statusDetail ? { statusDetail: document.statusDetail } : {}),
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      };
      archivedDocuments.push({ ...metadata, originalPath });
    } catch (error) {
      failures.push(failure('export', error, { path: 'reference-library.json' }));
    }
  }
  const archive: ReferenceLibraryArchive = { documents: archivedDocuments, sections, lenses };
  zip.file('reference-library.json', JSON.stringify(archive));
}

/** Build the canonical whole-database archive without starting a download. */
export async function createFullZipArchive(): Promise<{ blob: Blob; fileName: string }> {
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
    await writeReferenceLibraryToZip(zip, failures);

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
    return {
      blob,
      fileName: `writers-hoard-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    };
  } catch (error) {
    throw wrapFailure('export', error);
  }
}

/**
 * Hand the canonical archive to the browser's save flow. Resolving only means
 * `saveAs` was started; it does not prove that the user completed the dialog.
 */
export async function exportFullZip(): Promise<void> {
  const { blob, fileName } = await createFullZipArchive();
  saveAs(blob, fileName);
}

/** Build a single-project archive without triggering a browser download. */
export async function createProjectZipArchive(
  projectId: string,
): Promise<{ blob: Blob; fileName: string }> {
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
    return { blob, fileName: `${sanitize(project.title)}-project.zip` };
  } catch (error) {
    throw wrapFailure('export', error, { projectId });
  }
}

export async function exportProjectZip(projectId: string): Promise<void> {
  const { blob, fileName } = await createProjectZipArchive(projectId);
  try {
    saveAs(blob, fileName);
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
  if (manifest.version === BACKUP_VERSION) {
    const library = manifest.referenceLibrary;
    const expected = mode === 'full';
    if (!library || library.included !== expected || library.originals !== expected) {
      failures.push(failure(
        'preflight',
        'Backup has an invalid reference-library declaration.',
        { path: 'manifest.json' },
      ));
    }
  }
  return manifest as BackupManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function prepareReferenceLibrary(
  zip: JSZip,
  json: Map<string, unknown>,
  manifest: BackupManifest | null,
  mode: 'project' | 'full',
  failures: BackupFailure[],
): Promise<PreparedReferenceLibrary> {
  if (mode !== 'full' || !manifest || manifest.version < 4) return EMPTY_REFERENCE_LIBRARY;
  const path = 'reference-library.json';
  const raw = json.get(path);
  if (!isRecord(raw) || !Array.isArray(raw.documents) || !Array.isArray(raw.sections) || !Array.isArray(raw.lenses)) {
    failures.push(failure('preflight', `Missing or invalid "${path}".`, { path }));
    return EMPTY_REFERENCE_LIBRARY;
  }

  const documents: ReferenceDocument[] = [];
  const documentIds = new Set<string>();
  const documentHashes = new Set<string>();
  for (const [index, value] of raw.documents.entries()) {
    if (!isRecord(value)) {
      failures.push(failure('preflight', `Reference document ${index + 1} is not an object.`, { path }));
      continue;
    }
    const id = typeof value.id === 'string' ? value.id : '';
    const name = typeof value.name === 'string' ? value.name : '';
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '';
    const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : '';
    const originalPath = typeof value.originalPath === 'string' ? value.originalPath : '';
    const expectedPath = `reference-library/originals/${encodeURIComponent(id)}.bin`;
    if (
      !id || !name || !mimeType || !/^[a-f0-9]{64}$/.test(sha256)
      || originalPath !== expectedPath
      || documentIds.has(id)
      || documentHashes.has(sha256)
      || typeof value.size !== 'number' || value.size < 0
      || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1
      || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number'
      || !['indexing', 'ready', 'error', 'relink-required'].includes(String(value.status))
    ) {
      failures.push(failure('preflight', `Reference document ${index + 1} has invalid metadata.`, { path }));
      continue;
    }
    const file = zip.file(originalPath);
    if (!file) {
      failures.push(failure('preflight', `Reference original "${originalPath}" is missing.`, { path: originalPath }));
      continue;
    }
    const bytes = await file.async('uint8array');
    if (bytes.byteLength !== value.size || await sha256Hex(bytes) !== sha256) {
      failures.push(failure('preflight', `Reference original "${originalPath}" failed its size or SHA-256 check.`, { path: originalPath }));
      continue;
    }
    documentIds.add(id);
    documentHashes.add(sha256);
    const owned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(owned).set(bytes);
    documents.push({
      id,
      name,
      mimeType,
      size: value.size,
      sha256,
      version: value.version,
      status: value.status as ReferenceDocument['status'],
      statusDetail: typeof value.statusDetail === 'string' ? value.statusDetail : undefined,
      original: new Blob([owned], { type: mimeType }),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  }

  const sections: ReferenceSection[] = [];
  const sectionIds = new Set<string>();
  const sectionDocuments = new Map<string, string>();
  for (const [index, value] of raw.sections.entries()) {
    if (!isRecord(value)) {
      failures.push(failure('preflight', `Reference section ${index + 1} is not an object.`, { path }));
      continue;
    }
    const id = typeof value.id === 'string' ? value.id : '';
    const documentId = typeof value.documentId === 'string' ? value.documentId : '';
    const text = typeof value.text === 'string' ? value.text : '';
    const textHash = typeof value.textHash === 'string' ? value.textHash.toLowerCase() : '';
    const terms = Array.isArray(value.terms) && value.terms.every(term => typeof term === 'string')
      ? value.terms as string[]
      : null;
    if (
      !id || sectionIds.has(id) || !documentIds.has(documentId) || !text.trim()
      || typeof value.order !== 'number' || !Number.isInteger(value.order) || value.order < 0
      || !terms || !/^[a-f0-9]{64}$/.test(textHash) || await sha256Hex(text) !== textHash
    ) {
      failures.push(failure('preflight', `Reference section ${index + 1} has invalid ownership or content hash.`, { path }));
      continue;
    }
    sectionIds.add(id);
    sectionDocuments.set(id, documentId);
    sections.push({
      id,
      documentId,
      order: value.order,
      page: typeof value.page === 'number' ? value.page : undefined,
      heading: typeof value.heading === 'string' ? value.heading : undefined,
      text,
      textHash,
      // Terms are derived and cheap to rebuild. Never trust an archive to
      // choose what private passages rank for a later query.
      terms: lexicalTerms(text),
    });
  }

  const lenses: ReferenceLens[] = [];
  const lensIds = new Set<string>();
  for (const [index, value] of raw.lenses.entries()) {
    if (!isRecord(value)) {
      failures.push(failure('preflight', `Reference lens ${index + 1} is not an object.`, { path }));
      continue;
    }
    const id = typeof value.id === 'string' ? value.id : '';
    const documentId = typeof value.documentId === 'string' ? value.documentId : '';
    const name = typeof value.name === 'string' ? value.name : '';
    const selected = Array.isArray(value.sectionIds) && value.sectionIds.every(sectionId => typeof sectionId === 'string')
      ? value.sectionIds as string[]
      : null;
    const criteria = Array.isArray(value.criteria) ? value.criteria : null;
    const criterionIds = new Set<string>();
    const selectedSet = new Set(selected ?? []);
    const criteriaValid = criteria?.every(criterion => {
      if (
        !isRecord(criterion)
        || typeof criterion.id !== 'string'
        || !criterion.id
        || criterionIds.has(criterion.id)
        || typeof criterion.text !== 'string'
        || !criterion.text.trim()
        || typeof criterion.approved !== 'boolean'
        || (criterion.sourceSectionId !== undefined && typeof criterion.sourceSectionId !== 'string')
      ) return false;
      criterionIds.add(criterion.id);
      return criterion.sourceSectionId === undefined || selectedSet.has(criterion.sourceSectionId);
    }) ?? false;
    if (
      !id || lensIds.has(id) || !name.trim() || !documentIds.has(documentId)
      || !selected || selected.length === 0 || selectedSet.size !== selected.length || !criteriaValid
      || selected.some(sectionId => sectionDocuments.get(sectionId) !== documentId)
      || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number'
    ) {
      failures.push(failure('preflight', `Reference lens ${index + 1} has invalid ownership or section links.`, { path }));
      continue;
    }
    lensIds.add(id);
    lenses.push({
      id,
      documentId,
      name,
      sectionIds: selected,
      criteria: criteria as ReferenceLens['criteria'],
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  }
  return { documents, sections, lenses };
}

async function runStrategyPreflight(
  zip: JSZip,
  projects: PreparedProject[],
  failures: BackupFailure[],
  mode: 'project' | 'full',
): Promise<void> {
  const scopedProjects: ScopedBackupProject[] = [];
  for (const project of projects) {
    const sections: Array<BackupImportSection & { engineId: string }> = [];
    for (const strategy of getAllBackupStrategies()) {
      try {
        const context = {
          zip,
          projectId: project.projectId,
          projectDir: project.projectDir,
        };
        await strategy.preflightImport?.(context);
        if (typeof strategy.inspectImport !== 'function') {
          throw new Error(
            `Backup strategy "${strategy.engineId}" has no import scope inventory.`,
          );
        }
        const inspected = await strategy.inspectImport(context);
        if (!Array.isArray(inspected)) {
          throw new Error(
            `Backup strategy "${strategy.engineId}" returned an invalid import scope inventory.`,
          );
        }
        const declared = new Set(strategy.tables);
        const covered = new Set<string>();
        for (const section of inspected) {
          if (
            !section ||
            typeof section !== 'object' ||
            typeof section.table !== 'string' ||
            typeof section.path !== 'string' ||
            !Array.isArray(section.rows)
          ) {
            throw new Error(
              `Backup strategy "${strategy.engineId}" returned an invalid import section.`,
            );
          }
          if (!declared.has(section.table)) {
            throw new Error(
              `Backup strategy "${strategy.engineId}" inventories undeclared table "${section.table}".`,
            );
          }
          covered.add(section.table);
          sections.push({ ...section, engineId: strategy.engineId });
        }
        const missing = strategy.tables.filter((table) => !covered.has(table));
        if (missing.length) {
          throw new Error(
            `Backup strategy "${strategy.engineId}" did not inventory table(s): ${missing.join(', ')}.`,
          );
        }
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
    scopedProjects.push({
      projectId: project.projectId,
      projectDir: project.projectDir,
      sections,
    });
  }
  if (failures.length) return;
  try {
    const scopeIssues = await validateBackupScopes(
      scopedProjects,
      mode === 'project',
    );
    for (const issue of scopeIssues) {
      failures.push(failure('preflight', issue.message, issue));
    }
  } catch (error) {
    failures.push(failure('preflight', error));
  }
}

async function preflightArchive(
  zip: JSZip,
  mode: 'project' | 'full',
): Promise<PreflightResult> {
  const failures: BackupFailure[] = [];
  const json = await parseAllJson(zip, failures);
  const manifest = validateManifest(json.get('manifest.json'), mode, failures);
  const referenceLibrary = await prepareReferenceLibrary(zip, json, manifest, mode, failures);
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

  await runStrategyPreflight(zip, projects, failures, mode);
  if (failures.length || !manifest) {
    throw new BackupOperationError('preflight', failures);
  }
  return { manifest, projects, json, referenceLibrary };
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
    // Called directly, NOT through `Dexie.waitFor`. That wrapper is what made
    // this the restore hang of 2026-08-31, and it took a stage trail through a
    // live renderer to see it.
    //
    // `waitFor` exists to hold a transaction open across a promise Dexie does
    // not own. It does that by spinning on a dummy read and parking the
    // operations issued inside its scope on a queue for that spin to drain —
    // and for some stores the queue never drains. `db.timelines.bulkPut` with
    // one row, inside a demonstrably live transaction, neither resolved nor
    // rejected. Worse, a strategy that REJECTED inside that scope never
    // propagated either: the spin simply never ended, so an ordinary
    // `ConstraintError` presented as a restore that stopped for ever, with no
    // error and no timeout — which is why this went a month without a name.
    //
    // Nothing needs holding open any more. `preloadArchive` decompresses the
    // whole archive before the transaction opens, so no strategy yields to the
    // event loop and the transaction's zone reaches all twenty-three of them
    // intact. Verified rather than assumed: with the wrapper gone every
    // strategy reports `Dexie.currentTransaction` set, and the restore that
    // used to hang for ever returns in forty milliseconds.
    await strategy.importProject({
      zip,
      projectId: project.projectId,
      projectDir: project.projectDir,
    });
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

async function clearProjectForRestore(projectId: string): Promise<void> {
  // Dexie keeps the primary key out of `idxByName`, so a table keyed BY the
  // project (aiProjectSettings) needs the second test — the same pair
  // `deleteProject` uses. Trusting the archive to overwrite that row is not
  // enough: an archive exported before the copilot existed carries no row at
  // all, and the restored project would inherit the previous instance's model
  // routes and permission level.
  const projectScoped = db.tables.filter(
    (table) => table.name !== 'projects'
      && ('projectId' in table.schema.idxByName || table.schema.primKey.name === 'projectId'),
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
    await db.canonTiles.where('worldId').anyOf(worldIds as string[]).delete();
  }
  for (const table of projectScoped) {
    await table.where('projectId').equals(projectId).delete();
  }
  // The same sweep `deleteProject` performs: without it, a project restored
  // over itself inherits the previous instance's dismissed findings, its saved
  // searches and a mid-flight sprint whose baseline describes a manuscript
  // that no longer exists.
  await db.settings.where('key').anyOf(projectSettingKeys(projectId)).delete();
  await db.projects.delete(projectId);
}

async function findProjectImportCollisions(
  projects: readonly PreparedProject[],
): Promise<ProjectZipImportCollision[]> {
  const existingProjects = await db.projects.bulkGet(
    projects.map((project) => project.projectId),
  );

  return projects.flatMap((project, index) => {
    const existing = existingProjects[index];
    if (!existing) return [];
    return [{
      projectId: project.projectId,
      incomingTitle: project.project.title,
      existingTitle: existing.title,
    }];
  });
}

/**
 * Validate a project archive and report collisions without writing to Dexie.
 * The returned IDs are the only IDs callers may later authorize for replace.
 */
export async function previewProjectZipImport(
  file: File,
): Promise<ProjectZipImportPreview> {
  const { prepared } = await loadAndPreflight(file, 'project');
  return {
    projects: prepared.projects.map((project) => ({
      id: project.projectId,
      title: project.project.title,
    })),
    collisions: await findProjectImportCollisions(prepared.projects),
  };
}

export async function importProjectZip(
  file: File,
  options: ProjectZipImportOptions = {},
): Promise<string[]> {
  const { zip, prepared } = await loadAndPreflight(file, 'project');
  const approvedReplacements = new Set(options.replaceProjectIds ?? []);
  // Decompress before the transaction: inside it, a JSZip read would hand
  // control back to the event loop and take the strategy's writes out of the
  // transaction with it. Preview does not pay this — only a real restore does.
  await preloadArchive(zip);
  try {
    await db.transaction('rw', db.tables, async () => {
      const existingProjects = await db.projects.bulkGet(
        prepared.projects.map((project) => project.projectId),
      );
      for (const [index, project] of prepared.projects.entries()) {
        const existingProject = existingProjects[index];
        if (existingProject && !approvedReplacements.has(project.projectId)) {
          throw new BackupOperationError('import', [
            failure(
              'import',
              `Project "${project.project.title}" (${project.projectId}) already exists and was not approved for replacement.`,
              {
                projectId: project.projectId,
                projectDir: project.projectDir,
              },
            ),
          ]);
        }
      }

      for (const [index, project] of prepared.projects.entries()) {
        const existingProject = existingProjects[index];
        if (existingProject) {
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
  // Same reason as the project restore: nothing inside the transaction may
  // yield to the event loop, and a JSZip read does.
  await preloadArchive(zip, ['reference-library/originals/']);

  try {
    await db.transaction('rw', db.tables, async () => {
      // Clear and restore are one transaction. If any strategy fails, Dexie
      // rolls the entire database back to its pre-import state.
      await Promise.all(db.tables.map((table) => table.clear()));
      if (settings.length) await db.settings.bulkAdd(settings as never[]);
      if (tags.length) await db.tags.bulkAdd(tags as never[]);
      if (inboxNotes.length) await db.table('notes').bulkAdd(inboxNotes as never[]);
      if (prepared.referenceLibrary.documents.length) {
        await db.referenceDocuments.bulkAdd(prepared.referenceLibrary.documents);
      }
      if (prepared.referenceLibrary.sections.length) {
        await db.referenceSections.bulkAdd(prepared.referenceLibrary.sections);
      }
      if (prepared.referenceLibrary.lenses.length) {
        await db.referenceLenses.bulkAdd(prepared.referenceLibrary.lenses);
      }

      for (const project of prepared.projects) {
        await db.projects.add(project.project as never);
        await importProjectStrategies(zip, project);
      }
    });
  } catch (error) {
    throw wrapFailure('import', error);
  }
}
