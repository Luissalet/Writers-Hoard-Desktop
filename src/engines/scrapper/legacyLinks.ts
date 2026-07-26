// ============================================
// Legacy "Links" engine → Scrapper snapshots
// ============================================
//
// The Links engine was retired in v21: it stored url + title + notes + tags,
// which is exactly the subset of a Snapshot that carries no archive. Rather
// than keep two half-overlapping inboxes for external references, every link
// became a link-only snapshot (no PDF/PNG/HTML archive, no downloaded media —
// `captureState`/`downloadState` stay absent, which is precisely how Scrapper
// already represents "never attempted").
//
// This module is shared by the three doors old links can still come through:
//   1. the Dexie v21 upgrade (existing local databases)
//   2. ZIP backups written before the removal (`links/links.json`)
//   3. the legacy JSON project/full import path (`data.externalLinks`)
//
// It imports types only, so db/index.ts can use it without an import cycle.

import type { Snapshot, SnapshotSource } from './types';

/** The retired `externalLinks` row shape. */
export interface LegacyExternalLink {
  id: string;
  projectId: string;
  type?: string;
  url?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  thumbnail?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** Same host detection Scrapper's capture bar uses, minus the DOM. */
export function detectSnapshotSource(url: string): SnapshotSource {
  const u = (url || '').toLowerCase();
  if (!u) return 'manual';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'tweet';
  return 'url';
}

/**
 * Convert one legacy link into a snapshot row. Ids are preserved so a
 * re-import of the same backup replaces rather than duplicates.
 */
export function legacyLinkToSnapshot(link: LegacyExternalLink): Snapshot {
  const url = link.url ?? '';
  const at = link.createdAt ?? Date.now();
  return {
    id: link.id,
    projectId: link.projectId,
    url,
    title: link.title?.trim() || url || 'Untitled',
    source: detectSnapshotSource(url),
    status: 'success',
    notes: link.notes ?? '',
    tags: link.tags ?? [],
    thumbnail: link.thumbnail,
    // Keeps the old YouTube/Spotify/Pinterest classification searchable
    // instead of throwing it away on the way in.
    metadata: link.type ? { legacyLinkType: link.type } : undefined,
    preservedAt: at,
    createdAt: at,
  };
}

/** Convert a batch, skipping anything that isn't a usable row. */
export function legacyLinksToSnapshots(rows: unknown[]): Snapshot[] {
  return (rows as LegacyExternalLink[])
    .filter((l) => l && typeof l.id === 'string' && typeof l.projectId === 'string')
    .map(legacyLinkToSnapshot);
}
