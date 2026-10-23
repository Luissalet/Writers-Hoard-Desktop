// ============================================
// AI bridge — the project's archive of deleted documents
// ============================================
// What was deleted from the world (a chapter, a card, a map…) lies in the
// archive with its content and links, as the Archive tool shows it. The bridge
// lists it and restores from it; deleting a copy forever stays in the app,
// behind the person's own confirmation.

import { db } from '@/db';
import { ArchiveRestoreConflict, restoreArchivedDocument } from '@/services/documentArchive/store';
import { BridgeError, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from './shared';

/** The archived copies of a project, newest first: id, title, kind and when. */
export async function whArchiveList(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const query = typeof args.query === 'string' ? args.query.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim() : '';
  const rows: { id: string; title: string; kind: string; archivedAt: number; links: number }[] = [];
  await db.documentArchives.where('projectId').equals(projectId).each((row) => {
    if (query && !row.title.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().includes(query)) return;
    rows.push({ id: row.id, title: row.title, kind: row.kind, archivedAt: row.archivedAt, links: row.mutations.length });
  });
  rows.sort((a, b) => b.archivedAt - a.archivedAt);
  return { projectId, archived: rows.slice(0, 200), total: rows.length };
}

/**
 * Restore archived copies with their content and links, oldest first (a later
 * one can need an earlier one back). Each is restored whole or not at all; a
 * copy whose id or links changed since is reported, not forced.
 */
export async function whArchiveRestore(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'archive');
  const ids = args.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((id) => typeof id === 'string' && id.trim())) throw new BridgeError('bad-args', 'ids must be a list of 1 to 100 archive ids from wh_archive_list.');
  const rows = [];
  for (const id of new Set(ids as string[])) {
    const row = await db.documentArchives.get(id);
    if (!row || row.projectId !== projectId) throw new BridgeError('not-found', `No archived copy "${id}" in this project; use wh_archive_list.`);
    rows.push(row);
  }
  rows.sort((a, b) => a.archivedAt - b.archivedAt);
  const restored: { id: string; title: string; kind: string }[] = [], conflicts: { id: string; title: string }[] = [];
  for (const row of rows) {
    try { await restoreArchivedDocument(projectId, row.id); restored.push({ id: row.id, title: row.title, kind: row.kind }); }
    catch (error) { if (error instanceof ArchiveRestoreConflict) conflicts.push({ id: row.id, title: row.title }); else throw error; }
  }
  return withAudit(
    { projectId, restored, conflicts },
    { projectId, entityId: restored[0]?.id ?? rows[0].id, summary: `restored ${restored.length} archived document(s)` },
  );
}
