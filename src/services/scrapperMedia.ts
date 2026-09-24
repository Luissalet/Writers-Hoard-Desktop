// ============================================
// Scrapper media — download a link's video/audio into the managed local
// library and build playable wh-media:// URLs for the renderer.
// ============================================
//
// Desktop-only. The heavy lifting (yt-dlp + saving the file under
// <userData>/scrapper-media/) happens in the Electron main process; here we
// just call the IPC bridge exposed by electron/preload.ts and turn the saved
// relative path into a URL the <video>/<audio> element can play.

import { isDesktop } from '@/utils/platform';
import type { Snapshot, SnapshotSource } from '@/engines/scrapper/types';
import { getSnapshot } from '@/engines/scrapper/operations';
import type { MediaFormat } from './mediaDownloader';

/** Sources whose links yt-dlp can fetch (everything except manual / plain web pages). */
export function canDownloadMedia(source: SnapshotSource): boolean {
  return source === 'youtube' || source === 'instagram' || source === 'tweet';
}

export interface DownloadedMedia {
  relPath: string;
  items?: { relPath: string; kind: 'image' | 'video' }[];
  filename?: string;
  sizeBytes?: number;
  kind: 'video' | 'audio' | 'image';
  description?: string;
  uploader?: string;
  /** upload_date, format YYYYMMDD. */
  uploadDate?: string;
  title?: string;
}

/**
 * Download the snapshot's link into the managed media library.
 * Resolves with the saved file's info, or throws with a readable message.
 */
export async function downloadSnapshotMedia(args: {
  url: string;
  format: MediaFormat;
  projectId: string;
  snapshotId: string;
}): Promise<DownloadedMedia> {
  if (!isDesktop() || !window.electronAPI) {
    throw new Error('La descarga de medios solo está disponible en la app de escritorio');
  }
  const res = await window.electronAPI.media.downloadToLibrary(args);
  if (!res.ok || !res.relPath) {
    throw new Error(res.error || 'download failed');
  }
  return {
    relPath: res.relPath,
    items: res.items,
    filename: res.filename,
    sizeBytes: res.sizeBytes,
    kind: res.kind ?? 'video',
    description: res.description,
    uploader: res.uploader,
    uploadDate: res.uploadDate,
    title: res.title,
  };
}

/** Delete a snapshot's downloaded media (single file or carousel folder; best-effort). */
export async function deleteSnapshotMedia(
  snapshot: Pick<Snapshot, 'localMediaPath' | 'mediaItems'>,
): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;
  // Media root: a carousel folder (<proj>/<id>) or a single file (<proj>/<id>.ext).
  // slice(0,2) yields the folder for 3-segment carousel paths and the file itself
  // for 2-segment single-video paths.
  const ref = snapshot.mediaItems?.[0]?.relPath ?? snapshot.localMediaPath;
  if (!ref) return;
  const target = ref.split('/').slice(0, 2).join('/');
  try {
    await window.electronAPI.media.deleteLibraryFile(target);
  } catch {
    /* best-effort cleanup — a leftover file is harmless */
  }
}

/**
 * Delete a project's ENTIRE downloaded-media folder (scrapper-media/<projectId>/).
 * Called when the project itself is deleted; best-effort.
 */
export async function cleanupProjectMedia(projectId: string): Promise<void> {
  if (!isDesktop() || !window.electronAPI || !projectId) return;
  try {
    await window.electronAPI.media.deleteLibraryFile(projectId);
  } catch {
    /* best-effort cleanup — leftover files are harmless */
  }
}

/** Cancel an in-flight download for a snapshot (kills its yt-dlp/ffmpeg process). */
export async function cancelSnapshotDownload(snapshotId: string): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;
  try {
    await window.electronAPI.media.cancelDownload(snapshotId);
  } catch {
    /* best-effort */
  }
}

/**
 * True only when the snapshot row is provably gone. A failed read is not
 * proof of deletion, so it answers false and nothing gets removed.
 */
export async function snapshotIsGone(snapshotId: string): Promise<boolean> {
  try {
    return (await getSnapshot(snapshotId)) === undefined;
  } catch {
    return false;
  }
}

/**
 * Remove the files a download or page capture produced for a clipping that
 * was deleted while the job ran — nothing points at them any more.
 *
 * Only paths that are unmistakably THIS snapshot's own are touched:
 * `<projectId>/<snapshotId>.<ext>`, or the carousel folder
 * `<projectId>/<snapshotId>/`. `deleteLibraryFile` also accepts a bare project
 * id and would wipe the whole project folder, so anything else is ignored.
 */
export async function discardOrphanedSnapshotFiles(
  projectId: string,
  snapshotId: string,
  relPaths: readonly (string | undefined)[],
): Promise<void> {
  if (!isDesktop() || !window.electronAPI || !projectId || !snapshotId) return;
  const targets = new Set<string>();
  for (const relPath of relPaths) {
    const parts = relPath?.split('/') ?? [];
    if (parts[0] !== projectId || parts.some((part) => !part || part === '.' || part === '..')) continue;
    if (parts.length === 2 && parts[1].startsWith(`${snapshotId}.`)) targets.add(parts.join('/'));
    else if (parts.length === 3 && parts[1] === snapshotId) targets.add(`${projectId}/${snapshotId}`);
  }
  for (const target of targets) {
    try {
      await window.electronAPI.media.deleteLibraryFile(target);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Build a playable URL for a downloaded media file served by the main process. */
export function snapshotMediaUrl(relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `wh-media://media/${encoded}`;
}

/**
 * Full download lifecycle for a snapshot: mark downloading → fetch the media →
 * mark done (with the saved path) or error. Drives both the auto-download on
 * capture and the manual retry. `update` is the entity hook's `editItem`.
 * Never throws — failures are written into the snapshot's downloadError.
 */
/**
 * Convert a YYYYMMDD upload_date (yt-dlp's shape, also what gallery-dl's
 * listCollection normalizes to) to YYYY-MM-DD (parseable by `new Date`).
 * Exported so collection-import call sites can format dates the same way.
 */
export function isoFromYtDate(d: string | undefined): string | undefined {
  return d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : undefined;
}

function producedMediaPaths(media: DownloadedMedia): (string | undefined)[] {
  return [media.relPath, ...(media.items ?? []).map((item) => item.relPath)];
}

export async function runSnapshotDownload(
  snapshot: Pick<Snapshot, 'id' | 'url' | 'projectId' | 'description' | 'author' | 'publishDate'>,
  update: (id: string, changes: Partial<Snapshot>) => void | Promise<void>,
  format: MediaFormat = 'video',
): Promise<void> {
  // A queued download (collection import) can reach a clipping deleted while
  // it waited: fetching it would only produce files nothing points at.
  if (await snapshotIsGone(snapshot.id)) return;
  await update(snapshot.id, { downloadState: 'downloading', downloadError: undefined });
  try {
    const media = await downloadSnapshotMedia({
      url: snapshot.url,
      format,
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
    });
    const changes: Partial<Snapshot> = {
      localMediaPath: media.relPath,
      mediaItems: media.items,
      mediaFilename: media.filename,
      mediaSizeBytes: media.sizeBytes,
      mediaKind: media.kind,
      downloadState: 'done',
      downloadError: undefined,
    };
    // Fill in the reel's own caption/author/date — but never overwrite the user's edits.
    // A download can run for minutes, and the user may type a description in
    // the meantime: decide from the row as it is NOW, not as it was when the
    // download started. If the read fails, fall back to the caller's copy.
    let current: Pick<Snapshot, 'description' | 'author' | 'publishDate'> = snapshot;
    try {
      const row = await getSnapshot(snapshot.id);
      // Deleted while yt-dlp ran (a cancel can lose the race with the copy):
      // the saved file belongs to nothing, so it goes too.
      if (!row) {
        await discardOrphanedSnapshotFiles(snapshot.projectId, snapshot.id, producedMediaPaths(media));
        return;
      }
      current = row;
    } catch {
      /* keep the caller's copy */
    }
    if (media.description && !current.description?.trim()) changes.description = media.description;
    if (media.uploader && !current.author?.trim()) changes.author = media.uploader;
    if (!current.publishDate) {
      const iso = isoFromYtDate(media.uploadDate);
      if (iso) changes.publishDate = iso;
    }
    await update(snapshot.id, changes);
    // Deleted between the read above and this write: the update matched no row.
    if (await snapshotIsGone(snapshot.id)) {
      await discardOrphanedSnapshotFiles(snapshot.projectId, snapshot.id, producedMediaPaths(media));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User cancelled → back to link-only; duplicate request → leave as-is.
    if (msg === 'cancelled') {
      await update(snapshot.id, { downloadState: 'idle', downloadError: undefined });
      return;
    }
    if (msg === 'already downloading') return;
    await update(snapshot.id, { downloadState: 'error', downloadError: msg });
  }
}
