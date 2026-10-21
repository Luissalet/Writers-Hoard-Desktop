import {validateLocalToolBlockRichContent} from '@/engines/local/blocks/types';
import {validateSourceToolDocument} from '@/engines/local/documents/types';
import {validateToolDockWritingMetadata} from '@/engines/writings/toolDock/types';
import { db } from '@/db';
import Dexie from 'dexie';
import { sha256Hex } from '@/services/judge/text';
import { validateArchivedMetadata } from '@/services/documentArchive/metadata';
import type { Project } from '@/types';
import type { EraDocument, EraDocumentKind, EraRow } from './types';

export { eraAdapters, eraAdapterForTable } from './registry';
export type { EraAdapter } from './registry';
import { eraAdapters } from './registry';
export async function baseEraDocuments(projectId: string, kind: EraDocumentKind, project?: Project, entityId?: string): Promise<EraDocument[]> {
  const adapter = eraAdapters[kind];
  const candidate = entityId && adapter.table ? await db.table(adapter.table).get(entityId) as EraRow | undefined : undefined;
  const roots = adapter.table ? entityId ? candidate?.projectId === projectId ? [candidate] : [] : await db.table(adapter.table).where('projectId').equals(projectId).toArray() as EraRow[] : (((project ?? await db.projects.get(projectId))?.[adapter.metadata!] ?? []) as EraRow[]).filter(row => !entityId || row.id === entityId);
  const result: EraDocument[] = [];
  for (const root of roots) {
    const children: Record<string, EraRow[]> = {};
    for (const [table, parent] of Object.entries(adapter.children ?? {})) children[table] = await db.table(table).where(parent).equals(root.id).toArray() as EraRow[];
    result.push({ root, children });
  }
  return result;
}
export function validateEraDocument(projectId: string, kind: EraDocumentKind, entityId: string, document: EraDocument): void {
  const adapter = eraAdapters[kind];
  if (!adapter || !document?.root || document.root.id !== entityId || document.root.projectId !== undefined && document.root.projectId !== projectId || !document.children || typeof document.children !== 'object' || Array.isArray(document.children)) throw new Error('world_era_document_invalid');
  validateLocalToolBlockRichContent(document,projectId);
  const root = document.root;
  if(kind==='writings')validateToolDockWritingMetadata({toolDock:root.toolDock});
  if(kind==='local-tool')validateSourceToolDocument(root);
  else if (adapter.metadata) validateArchivedMetadata(kind === 'genealogy' ? 'relation-tree' : kind as Parameters<typeof validateArchivedMetadata>[0], root);
  else if (typeof root.id !== 'string' || !root.id || root.projectId !== projectId) throw new Error('world_era_root_scope_invalid');
  if (['codex', 'writings'].includes(kind) && (typeof root.title !== 'string' || typeof root.content !== 'string' || !Array.isArray(root.tags))) throw new Error('world_era_text_document_invalid');
  if (kind === 'codex' && (!root.fields || typeof root.fields !== 'object' || Array.isArray(root.fields) || !Array.isArray(root.relations))) throw new Error('world_era_codex_invalid');
  if (kind === 'dialog-scene' && (typeof root.title !== 'string' || !Array.isArray(root.tags) || !Number.isFinite(root.order))) throw new Error('world_era_scene_invalid');
  if (kind === 'writings' && (typeof root.updatedAt !== 'number' || typeof root.createdAt !== 'number' || typeof root.status !== 'string')) throw new Error('world_era_writing_invalid');
  for (const [table, rows] of Object.entries(document.children)) {
    const parent = adapter.children?.[table]; if (!parent || !Array.isArray(rows)) throw new Error('world_era_children_invalid');
    const ids = new Set<string>();
    for (const row of rows) { if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || row[parent] !== entityId || row.projectId !== undefined && row.projectId !== projectId) throw new Error('world_era_child_scope_invalid'); ids.add(row.id); }
  }
}
/** A deterministic content token works for metadata documents without a timestamp. */
export function eraDocumentVersion(document: EraDocument | undefined): Promise<string> {
  const normalize = async (value: unknown): Promise<unknown> => {
    if (value instanceof Blob) return { size: value.size, type: value.type, sha256: await sha256Hex(await value.arrayBuffer()) };
    if (Array.isArray(value)) return Promise.all(value.map(normalize));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, value]) => value !== undefined).map(async ([key, child]) => [key, await normalize(child)])));
    return value;
  };
  // Hashing binary bytes is outside IndexedDB. Keep an existing CAS transaction
  // alive through that asynchronous work rather than allowing it to auto-commit.
  return Dexie.waitFor((async () => `sha256:${await sha256Hex(JSON.stringify(await normalize(document)) ?? 'missing')}`)());
}
