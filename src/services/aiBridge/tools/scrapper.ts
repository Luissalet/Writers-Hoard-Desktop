// ============================================================================
// AI bridge tools — Recortes (clippings) and the vision loop
// ============================================================================
//
// The point of this group: a model that can see images looks at a saved post
// and writes back what is actually in it, so a folder of screenshots stops
// being a pile of unsearchable pixels.
//
// Media files live on disk under the scrapper-media root. The gallery renders
// them through the privileged wh-media:// scheme, but that scheme cannot be
// FETCHED from here — the renderer's origin is http://localhost in development
// and file:// when packaged, so a custom scheme is always cross-origin. Main
// reads the bytes instead, through `media:readLibraryFile`.

import type { Snapshot } from '@/engines/scrapper/types';
import {
  createSnapshot,
  getSnapshot,
  getSnapshots,
  updateSnapshot,
} from '@/engines/scrapper/operations';
import { runSnapshotDownload, isoFromYtDate } from '@/services/scrapperMedia';
import { listInstagramCollection } from '@/engines/scrapper/services/collectionImport';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  dataUrlToBlob,
  htmlFromMarkdown,
  markdownFromHtml,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  readLibraryBlob,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  toVisionJpeg,
  withAudit,
  withMedia,
  type ToolArgs,
} from './shared';

async function mustGetSnapshot(id: string): Promise<Snapshot> {
  const snapshot = await getSnapshot(id);
  if (!snapshot) throw new BridgeError('not-found', `No clipping with id "${id}".`);
  return snapshot;
}

/** Every viewable still of a clipping, best first. */
function imageSources(snapshot: Snapshot): { relPath?: string; dataUrl?: string; label: string }[] {
  const out: { relPath?: string; dataUrl?: string; label: string }[] = [];
  for (const item of snapshot.mediaItems ?? []) {
    if (item.kind === 'image') out.push({ relPath: item.relPath, label: item.relPath });
  }
  if (!out.length && snapshot.localMediaPath && snapshot.mediaKind === 'image') {
    out.push({ relPath: snapshot.localMediaPath, label: snapshot.localMediaPath });
  }
  if (snapshot.captureImagePath) {
    out.push({ relPath: snapshot.captureImagePath, label: 'page screenshot' });
  }
  if (!out.length && snapshot.thumbnail?.startsWith('data:')) {
    out.push({ dataUrl: snapshot.thumbnail, label: 'thumbnail' });
  }
  return out;
}

function serializeSnapshot(snapshot: Snapshot): Record<string, unknown> {
  const images = imageSources(snapshot);
  return {
    id: snapshot.id,
    url: snapshot.url,
    title: snapshot.title,
    source: snapshot.source,
    author: snapshot.author,
    publishDate: snapshot.publishDate,
    description: snapshot.description,
    tags: snapshot.tags,
    mediaKind: snapshot.mediaKind,
    downloadState: snapshot.downloadState,
    imageCount: images.length,
    viewable: images.length > 0,
    createdAt: snapshot.createdAt,
  };
}

export async function whListSnapshots(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const tag = optString(args, 'tag');
  const untaggedOnly = optBoolean(args, 'untaggedOnly') === true;
  const withImageOnly = optBoolean(args, 'withImageOnly') === true;
  const limit = clampLimit(optNumber(args, 'limit'), 50, 200);

  let snapshots = await getSnapshots(projectId);
  if (tag) snapshots = snapshots.filter((s) => s.tags.includes(tag));
  if (untaggedOnly) snapshots = snapshots.filter((s) => s.tags.length === 0);
  if (withImageOnly) snapshots = snapshots.filter((s) => imageSources(s).length > 0);

  return {
    projectId,
    total: snapshots.length,
    snapshots: snapshots.slice(0, limit).map(serializeSnapshot),
  };
}

export async function whViewSnapshotImage(args: ToolArgs): Promise<unknown> {
  const snapshot = await mustGetSnapshot(requireString(args, 'id'));
  const images = imageSources(snapshot);
  if (!images.length) {
    throw new BridgeError(
      'no-image',
      `"${snapshot.title || snapshot.url}" has no image on disk. Download it first with wh_download_snapshot_media.`,
    );
  }
  const index = Math.max(0, Math.min(images.length - 1, Math.round(optNumber(args, 'itemIndex') ?? 0)));
  const chosen = images[index];
  const blob = chosen.dataUrl
    ? dataUrlToBlob(chosen.dataUrl)
    : await readLibraryBlob(chosen.relPath ?? '');
  const media = await toVisionJpeg(blob);

  return withMedia(
    {
      id: snapshot.id,
      title: snapshot.title,
      url: snapshot.url,
      caption: snapshot.description,
      existingTags: snapshot.tags,
      showing: `${index + 1} of ${images.length}`,
      hint: 'Describe what is in the picture, then write it back with wh_tag_snapshot.',
    },
    [{ ...media, label: chosen.label }],
  );
}

export async function whTagSnapshot(args: ToolArgs): Promise<unknown> {
  const snapshot = await mustGetSnapshot(requireString(args, 'id'));
  await assertEngineEnabled(snapshot.projectId, 'scrapper');
  assertRowInScope(args, snapshot.projectId);
  const changes: Partial<Snapshot> = {};

  const replaceTags = optStringArray(args, 'tags');
  const addTags = optStringArray(args, 'addTags');
  if (replaceTags) {
    changes.tags = [...new Set(replaceTags)];
  } else if (addTags) {
    changes.tags = [...new Set([...snapshot.tags, ...addTags])];
  }
  const description = optString(args, 'description');
  if (description !== undefined) changes.description = description;
  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const notes = optString(args, 'notes');
  if (notes !== undefined) changes.notes = htmlFromMarkdown(notes);

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass tags, addTags, description, title or notes.');
  }
  await updateSnapshot(snapshot.id, changes);
  return withAudit(
    { id: snapshot.id, updated: Object.keys(changes), tags: changes.tags ?? snapshot.tags },
    {
      projectId: snapshot.projectId,
      entityId: snapshot.id,
      summary: `tagged clipping "${snapshot.title || snapshot.url}"`,
      before: { title: snapshot.title, tags: snapshot.tags, description: snapshot.description },
    },
  );
}

export async function whListInstagramCollection(args: ToolArgs): Promise<unknown> {
  const url = requireString(args, 'url');
  const posts = await listInstagramCollection(url);
  return {
    url,
    count: posts.length,
    posts: posts.map((post) => ({
      url: post.url,
      shortcode: post.shortcode,
      description: post.description,
      author: post.uploader,
      publishDate: isoFromYtDate(post.uploadDate),
      type: post.type,
    })),
    hint: 'Nothing was saved. Show these to the user, then pass the ones they want to wh_import_snapshots.',
  };
}

/** Which SnapshotSource a link belongs to, by host. */
function sourceForUrl(url: string): Snapshot['source'] {
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/(twitter\.com|x\.com)/i.test(url)) return 'tweet';
  if (/(youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
  return 'url';
}

/** Fall back to the caption's first line, then the host, for a usable title. */
function titleFor(url: string, explicit?: string, description?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const firstLine = description?.split('\n').map((l) => l.trim()).find(Boolean);
  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function whImportSnapshots(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'scrapper');
  const raw = args.items;
  if (!Array.isArray(raw) || !raw.length) {
    throw new BridgeError('bad-args', '"items" must be a non-empty array of links to save.');
  }

  const existing = await getSnapshots(projectId);
  const seen = new Set(existing.map((s) => s.url));
  const created: { id: string; url: string; title: string }[] = [];
  const skipped: string[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) continue;
    if (seen.has(url)) {
      skipped.push(url);
      continue;
    }
    seen.add(url);

    const description = typeof item.description === 'string' ? item.description : undefined;
    const now = Date.now();
    const snapshot: Snapshot = {
      id: generateId('snap'),
      projectId,
      url,
      title: titleFor(url, typeof item.title === 'string' ? item.title : undefined, description),
      source: sourceForUrl(url),
      status: 'success',
      description,
      author: typeof item.author === 'string' ? item.author : undefined,
      publishDate: typeof item.publishDate === 'string' ? item.publishDate : undefined,
      notes: '',
      tags: Array.isArray(item.tags)
        ? (item.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
      preservedAt: now,
      createdAt: now,
    };
    await createSnapshot(snapshot);
    created.push({ id: snapshot.id, url: snapshot.url, title: snapshot.title });
  }

  return withAudit(
    {
      projectId,
      created: created.length,
      skippedAsDuplicate: skipped.length,
      snapshots: created,
      hint: created.length
        ? 'Saved as links only. Use wh_download_snapshot_media on one before trying to view its image.'
        : 'Nothing new: every link was already in this project.',
    },
    {
      projectId,
      // `created` in the result is a COUNT, so the executor cannot read the
      // kind off it the way it does everywhere else — and without the ids
      // there was nothing for undo to remove, behind a button that offered it
      // anyway.
      kind: 'create',
      entityIds: created.map((snapshot) => snapshot.id),
      summary: `imported ${created.length} clipping(s), skipped ${skipped.length} duplicate(s)`,
    },
  );
}

export async function whDownloadSnapshotMedia(args: ToolArgs): Promise<unknown> {
  const snapshot = await mustGetSnapshot(requireString(args, 'id'));
  await assertEngineEnabled(snapshot.projectId, 'scrapper');
  assertRowInScope(args, snapshot.projectId);
  const format = optEnum(args, 'format', ['video', 'audio'] as const) ?? 'video';

  // Reuses the exact lifecycle the app's own download button drives, so the
  // snapshot's state machine and the caption/author backfill behave identically.
  await runSnapshotDownload(snapshot, updateSnapshot, format);

  const after = await mustGetSnapshot(snapshot.id);
  if (after.downloadState === 'error') {
    throw new BridgeError('download-failed', after.downloadError || 'The download failed.');
  }
  const images = imageSources(after);
  return withAudit(
    {
      id: after.id,
      downloadState: after.downloadState,
      mediaKind: after.mediaKind,
      imageCount: images.length,
      viewable: images.length > 0,
      hint: images.length
        ? 'Now call wh_view_snapshot_image to look at it.'
        : 'Downloaded, but there is no still image to look at (video-only post).',
    },
    {
      projectId: after.projectId,
      entityId: after.id,
      summary: `downloaded media for "${after.title || after.url}"`,
    },
  );
}

/** Read one clipping in full, notes as Markdown. */
export async function whGetSnapshot(args: ToolArgs): Promise<unknown> {
  const snapshot = await mustGetSnapshot(requireString(args, 'id'));
  return {
    ...serializeSnapshot(snapshot),
    projectId: snapshot.projectId,
    notes: markdownFromHtml(snapshot.notes),
    extractedText: snapshot.extractedText,
  };
}
