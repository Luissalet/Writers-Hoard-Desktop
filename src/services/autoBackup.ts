// ============================================================================
// Automatic backup — an archive the writer never has to remember
// ============================================================================
//
// The manuscript lives in IndexedDB. The writer cannot see it, cannot copy it,
// and the browser engine is allowed to evict it under storage pressure. Until
// now the only protection was a button somebody had to remember to press, and
// this module could do no more than count the days since they last did.
//
// It can do the whole job now. `electron/preload.ts` exposes `backup.writeArchive`:
// the one door that takes the renderer's own bytes and puts them on disk with no
// save dialog in front of it and no transformation on the way through. So:
//
//   • on start, once the app is interactive and idle, if the interval has
//     passed since the last successful automatic archive, build a full ZIP of
//     every project and write it into <userData>/backups;
//   • the main process names the file, writes it atomically and keeps only the
//     N most recent (see electron/main.ts — rotation and deletion never happen
//     on this side);
//   • nothing here throws at a caller. A failure is recorded, published, and
//     shown on the Dashboard. A backup that failed must never look like one
//     that worked, and must never take a launch down with it.
//
// The archive is deliberately the SAME shape `exportFullZip` produces, so the
// existing "Full Backup" restore reads it with no special case. That shape is
// defined by src/services/zipBackup.ts, which this file must not edit and does
// not duplicate more of than the top-level files: project contents come from
// the engines' own registered strategies, exactly as the manual export gets
// them. The one constant mirrored here is the manifest version — an archive
// declaring an older version still restores (the importer accepts the whole
// supported range), which is what makes that mirror safe rather than fragile.

import JSZip from 'jszip';
import { db } from '@/db';
import { getSetting, setSetting } from '@/db/operations';
import {
  dataUrlToBlob,
  getAllBackupStrategies,
  sanitize,
} from '@/engines/_shared/backupRegistry';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
// Engine initialization is part of the backup contract: every strategy must be
// registered before an archive is built. Same import, same reason, as zipBackup.
import '@/engines';
import type { Project } from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Defaults a writer never has to touch. */
const DEFAULT_INTERVAL_DAYS = 7;
const DEFAULT_COPIES = 3;

/** Bounds the settings UI offers and this module enforces regardless. */
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 90;
export const MIN_COPIES = 1;
export const MAX_COPIES = 20;

/**
 * Let the first paint, the first queries and the engine registration finish
 * before an archive is even considered. Ten seconds is not a guess about the
 * machine: the work is gated behind an idle slot after it, so a slow launch
 * simply pushes the backup further out.
 */
const STARTUP_SETTLE_MS = 10_000;

const KEYS = {
  /**
   * The last backup this app watched land. Written beside `lastAutomaticAt` by
   * every archive that succeeds here, and still read on its own because a
   * database restored from an older build carries whatever that build stamped
   * — including manual downloads it had no way to verify. Nothing writes it
   * unverified any more: a download the renderer cannot watch reach the disk is
   * not a completed backup, and must never be recorded as one.
   */
  lastCompletedAt: 'backup.lastCompletedAt',
  /** Only archives this module wrote — what the schedule is measured against. */
  lastAutomaticAt: 'backup.auto.lastRunAt',
  enabled: 'backup.auto.enabled',
  intervalDays: 'backup.auto.intervalDays',
  copies: 'backup.auto.copies',
  /** JSON: where the newest automatic archive landed and how big it is. */
  lastArchive: 'backup.auto.lastArchive',
  /** JSON: why the last attempt produced nothing. Cleared by a success. */
  lastFailure: 'backup.auto.lastFailure',
} as const;

export type BackupFailureCode =
  /** No desktop shell, so no way to write a file at all. */
  | 'unsupported'
  /** The archive itself could not be produced from the database. */
  | 'build-failed'
  /** It would not fit on the disk, so it was never started. */
  | 'insufficient-space'
  /** The disk refused the write. */
  | 'write-failed'
  /** The main process rejected the name or the bytes — a bug, not a disk. */
  | 'invalid-name'
  | 'invalid-payload';

export interface BackupFailure {
  at: number;
  code: BackupFailureCode;
  /**
   * Diagnostic text straight from the layer that failed — an OS or Dexie
   * message. Untranslatable by nature, so it is only ever shown beside its
   * translated code, never on its own.
   */
  detail?: string;
  /** Set for 'insufficient-space' so the UI can phrase the shortfall itself. */
  freeBytes?: number;
  requiredBytes?: number;
}

export interface BackupStatus {
  /** Epoch ms of the last completed backup of any kind, or null. */
  lastBackupAt: number | null;
  /** Epoch ms of the last archive this module wrote — what the schedule reads. */
  lastAutomaticAt: number | null;
  /** Whole days since that backup; null when there has never been one. */
  daysSince: number | null;
  /** True when a backup is due — never backed up counts as due. */
  overdue: boolean;
  /** True when the most recent backup is one this module wrote. */
  lastWasAutomatic: boolean;
  /**
   * The status itself could not be read (settings unreadable). Set instead of
   * throwing, so a broken read can never take the Dashboard down with it.
   */
  unavailable: boolean;
  /** False in the web build: there is no door to the disk there. */
  supported: boolean;
  automaticEnabled: boolean;
  intervalDays: number;
  copies: number;
  /** Absolute path of the newest automatic archive, when one exists. */
  lastArchivePath: string | null;
  lastArchiveBytes: number | null;
  /** Why the last attempt produced nothing, or null after a success. */
  failure: BackupFailure | null;
  /** An archive is being built or written right now. */
  running: boolean;
}

const UNAVAILABLE: BackupStatus = {
  lastBackupAt: null,
  lastAutomaticAt: null,
  daysSince: null,
  overdue: false,
  lastWasAutomatic: false,
  unavailable: true,
  supported: false,
  automaticEnabled: false,
  intervalDays: DEFAULT_INTERVAL_DAYS,
  copies: DEFAULT_COPIES,
  lastArchivePath: null,
  lastArchiveBytes: null,
  failure: null,
  running: false,
};

type Listener = (status: BackupStatus) => void;

const listeners = new Set<Listener>();
let cached: BackupStatus | null = null;
let checkScheduled = false;
let inFlight: Promise<BackupStatus> | null = null;

// ---------------------------------------------------------------------------
// Reading and publishing the state
// ---------------------------------------------------------------------------

/** The write door, or null when this build has none (web, or an old shell). */
function backupBridge(): NonNullable<Window['electronAPI']>['backup'] | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI?.backup ?? null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(Math.trunc(value), low), high);
}

function numberSetting(raw: string | undefined, fallback: number, low: number, high: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? clamp(parsed, low, high) : fallback;
}

function timestampSetting(raw: string | undefined): number | null {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonSetting<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    // A settings row somebody hand-edited is not worth a broken Dashboard.
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publish(status: BackupStatus): BackupStatus {
  cached = status;
  for (const listener of listeners) listener(status);
  return status;
}

/**
 * Publish a state nothing is working on any more. Every way out of a run goes
 * through here: `inFlight` is only cleared once the run's promise settles, so a
 * status read inside the run would otherwise leave the Dashboard spinning.
 */
function settled(status: BackupStatus): BackupStatus {
  return publish({ ...status, running: false });
}

/** Read every stored value and describe the current state. Never throws. */
export async function readBackupStatus(): Promise<BackupStatus> {
  try {
    const [
      completedRaw,
      automaticRaw,
      enabledRaw,
      intervalRaw,
      copiesRaw,
      archiveRaw,
      failureRaw,
    ] = await Promise.all([
      getSetting(KEYS.lastCompletedAt),
      getSetting(KEYS.lastAutomaticAt),
      getSetting(KEYS.enabled),
      getSetting(KEYS.intervalDays),
      getSetting(KEYS.copies),
      getSetting(KEYS.lastArchive),
      getSetting(KEYS.lastFailure),
    ]);

    const completedAt = timestampSetting(completedRaw);
    const automaticAt = timestampSetting(automaticRaw);
    const intervalDays = numberSetting(
      intervalRaw,
      DEFAULT_INTERVAL_DAYS,
      MIN_INTERVAL_DAYS,
      MAX_INTERVAL_DAYS,
    );
    const lastBackupAt =
      completedAt === null && automaticAt === null
        ? null
        : Math.max(completedAt ?? 0, automaticAt ?? 0);
    const daysSince =
      lastBackupAt === null ? null : Math.max(0, Math.floor((Date.now() - lastBackupAt) / DAY_MS));
    const archive = parseJsonSetting<{ path?: unknown; sizeBytes?: unknown }>(archiveRaw);
    const failure = parseJsonSetting<BackupFailure>(failureRaw);

    return {
      lastBackupAt,
      lastAutomaticAt: automaticAt,
      daysSince,
      overdue: daysSince === null || daysSince >= intervalDays,
      lastWasAutomatic: automaticAt !== null && automaticAt >= (completedAt ?? 0),
      unavailable: false,
      supported: backupBridge() !== null,
      // Absent means on: a writer who never opened the settings is protected.
      automaticEnabled: enabledRaw !== '0',
      intervalDays,
      copies: numberSetting(copiesRaw, DEFAULT_COPIES, MIN_COPIES, MAX_COPIES),
      lastArchivePath: typeof archive?.path === 'string' ? archive.path : null,
      lastArchiveBytes: typeof archive?.sizeBytes === 'number' ? archive.sizeBytes : null,
      failure: failure && typeof failure.at === 'number' && failure.code ? failure : null,
      running: inFlight !== null,
    };
  } catch (error) {
    console.error('[autoBackup] could not read the backup state', error);
    return UNAVAILABLE;
  }
}

/**
 * Watch the state. The listener is called immediately with whatever is already
 * known, and again on every change. Returns the unsubscribe.
 */
export function subscribeBackupStatus(listener: Listener): () => void {
  listeners.add(listener);
  if (cached) listener(cached);
  else void readBackupStatus().then(publish);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Settings the writer owns
// ---------------------------------------------------------------------------

async function updateSetting(key: string, value: string): Promise<BackupStatus> {
  try {
    await setSetting(key, value);
    return publish(await readBackupStatus());
  } catch (error) {
    console.error('[autoBackup] could not save the backup settings', error);
    return publish(UNAVAILABLE);
  }
}

/** Turn the unattended archive off, or back on. */
export function setAutomaticBackupEnabled(enabled: boolean): Promise<BackupStatus> {
  return updateSetting(KEYS.enabled, enabled ? '1' : '0');
}

/** How many days may pass before the next automatic archive. */
export function setAutomaticBackupInterval(days: number): Promise<BackupStatus> {
  return updateSetting(
    KEYS.intervalDays,
    String(clamp(days, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)),
  );
}

/** How many archives to keep before the oldest is rotated away. */
export function setAutomaticBackupCopies(copies: number): Promise<BackupStatus> {
  return updateSetting(KEYS.copies, String(clamp(copies, MIN_COPIES, MAX_COPIES)));
}

/** Open the backup folder in the OS file manager. False when it could not. */
export async function openBackupFolder(): Promise<boolean> {
  const bridge = backupBridge();
  if (!bridge) return false;
  try {
    return (await bridge.revealFolder()).ok;
  } catch (error) {
    console.error('[autoBackup] could not open the backup folder', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Building the archive
// ---------------------------------------------------------------------------

/**
 * The manifest version this archive declares. It mirrors `BACKUP_VERSION` in
 * src/services/zipBackup.ts, which owns the format and which this file may not
 * edit. The mirror is safe in the direction that matters: the importer accepts
 * every version from the minimum supported up to its own, so an archive
 * written here still restores after the format moves on — exactly like an
 * archive written by an older build of the app.
 */
const ARCHIVE_MANIFEST_VERSION = 3;

/** Sortable, colon-free, and the shape electron/main.ts will accept. */
function archiveFileName(at: Date): string {
  return `writers-hoard-auto-${at.toISOString().slice(0, 19).replace(/:/g, '-')}.zip`;
}

async function writeProjectToZip(zip: JSZip, project: Project): Promise<void> {
  const projectDir = `projects/${sanitize(project.title)}__${project.id}`;
  const metadata: Project = { ...project };
  if (metadata.coverImage) {
    const { blob, ext } = dataUrlToBlob(metadata.coverImage);
    if (blob.byteLength === 0) {
      throw new Error(`Project "${project.title}" has a cover that is not a valid image.`);
    }
    zip.file(`${projectDir}/cover.${ext}`, blob);
    metadata.coverImage = `cover.${ext}`;
  }
  zip.file(`${projectDir}/project.json`, JSON.stringify(metadata, null, 2));
  for (const strategy of getAllBackupStrategies()) {
    await strategy.exportProject({ zip, projectId: project.id, projectDir });
  }
}

/**
 * Build the same full-database archive the manual export produces, as bytes
 * instead of a download. Throws if any part of it fails: half a manuscript is
 * not a backup, and a partial archive that restores cleanly is worse than none.
 */
async function buildFullArchive(): Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const zip = new JSZip();
  const [projects, tags, settings, inboxNotes] = await Promise.all([
    db.projects.toArray(),
    db.tags.toArray(),
    db.settings.toArray(),
    db.table('notes').where('projectId').equals(GLOBAL_NOTES_SCOPE).toArray(),
  ]);

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        app: 'WritersHoard',
        version: ARCHIVE_MANIFEST_VERSION,
        exportedAt: new Date().toISOString(),
        projectCount: projects.length,
        externalAssets: {
          scrapper: { included: false, restorePolicy: 'reset-unavailable' },
        },
      },
      null,
      2,
    ),
  );
  zip.file('settings.json', JSON.stringify(settings, null, 2));
  zip.file('tags.json', JSON.stringify(tags, null, 2));
  zip.file('notes-inbox.json', JSON.stringify(inboxNotes, null, 2));

  for (const project of projects) {
    await writeProjectToZip(zip, project);
  }

  const bytes = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { bytes, fileName: archiveFileName(new Date()) };
}

// ---------------------------------------------------------------------------
// Running one backup
// ---------------------------------------------------------------------------

async function recordFailure(
  code: BackupFailureCode,
  extra: Omit<BackupFailure, 'at' | 'code'> = {},
): Promise<BackupStatus> {
  const failure: BackupFailure = { at: Date.now(), code, ...extra };
  try {
    await setSetting(KEYS.lastFailure, JSON.stringify(failure));
  } catch (error) {
    console.error('[autoBackup] could not record the failure', error);
  }
  // Passed through explicitly so the reason survives even a failed write of it.
  return settled({ ...(await readBackupStatus()), failure });
}

async function recordSuccess(path: string, sizeBytes: number): Promise<BackupStatus> {
  const at = Date.now();
  try {
    await setSetting(KEYS.lastAutomaticAt, String(at));
    await setSetting(KEYS.lastCompletedAt, String(at));
    await setSetting(KEYS.lastArchive, JSON.stringify({ path, sizeBytes }));
    await setSetting(KEYS.lastFailure, '');
  } catch (error) {
    // The archive is on disk either way — only the bookkeeping is behind.
    console.error('[autoBackup] the archive was written but could not be stamped', error);
  }
  return settled(await readBackupStatus());
}

/** Main's refusal codes, narrowed to ours. Anything unknown is a disk problem. */
function failureCodeFor(code: string | undefined): BackupFailureCode {
  switch (code) {
    case 'insufficient-space':
    case 'invalid-name':
    case 'invalid-payload':
      return code;
    default:
      return 'write-failed';
  }
}

async function performBackup(force: boolean): Promise<BackupStatus> {
  const before = await readBackupStatus();
  if (before.unavailable) return settled(before);

  const bridge = backupBridge();
  if (!bridge) {
    // Silent unless the writer actually asked: the web build never promised
    // an unattended archive, and nagging about it every launch is noise.
    return force ? await recordFailure('unsupported') : settled(before);
  }
  if (!force) {
    if (!before.automaticEnabled) return settled(before);
    const due =
      before.lastAutomaticAt === null ||
      Date.now() - before.lastAutomaticAt >= before.intervalDays * DAY_MS;
    if (!due) return settled(before);
  }
  // Nothing written yet is not a failure, and an empty archive rotating three
  // real ones out of existence would be one.
  if ((await db.projects.count()) === 0) return settled(before);

  publish({ ...before, running: true });
  try {
    const archive = await buildFullArchive();
    const result = await bridge.writeArchive(archive.bytes, archive.fileName, before.copies);
    if (!result.ok || !result.path) {
      const code = failureCodeFor(result.code);
      console.error(`[autoBackup] the archive was not written (${code})`, result.error ?? '');
      // The shortfall travels as numbers, not as a sentence: only the UI knows
      // what language the writer reads.
      return await recordFailure(
        code,
        code === 'insufficient-space'
          ? { freeBytes: result.freeBytes, requiredBytes: result.requiredBytes }
          : { detail: result.error },
      );
    }
    console.info(
      `[autoBackup] wrote ${result.path} (${result.sizeBytes ?? 0} bytes, ` +
        `${result.removed ?? 0} older archive(s) rotated out)`,
    );
    return await recordSuccess(result.path, result.sizeBytes ?? 0);
  } catch (error) {
    console.error('[autoBackup] the archive could not be produced', error);
    return await recordFailure('build-failed', { detail: messageOf(error) });
  }
}

/**
 * Produce and write an archive if one is due. Never rejects; the resolved
 * status carries whatever happened.
 *
 * A run already in flight is shared rather than duplicated — two archives
 * racing would fight over the same rotation window.
 */
export function runAutomaticBackup(options: { force?: boolean } = {}): Promise<BackupStatus> {
  if (inFlight) return inFlight;
  const run = performBackup(options.force === true).catch((error) => {
    console.error('[autoBackup] the backup run failed outright', error);
    return publish(UNAVAILABLE);
  });
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** The writer asked for an archive now, schedule or no schedule. */
export function backUpNow(): Promise<BackupStatus> {
  return runAutomaticBackup({ force: true });
}

/**
 * Kick the check off once, after the app is interactive — never in the path of
 * first paint, and never able to reject into a caller.
 *
 * Two gates stand in front of the work: a settle delay so the first paint and
 * the first queries are long past, then an idle slot. On a launch that never
 * goes idle the timeout still fires, but by then the writer has been working
 * for half a minute.
 */
export function scheduleStartupBackupCheck(): void {
  if (checkScheduled || typeof window === 'undefined') return;
  checkScheduled = true;
  const run = (): void => {
    void runAutomaticBackup();
  };
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 30_000 });
    } else {
      run();
    }
  }, STARTUP_SETTLE_MS);
}
