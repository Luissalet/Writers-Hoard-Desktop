import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { htmlFromMarkdown } from '@/services/aiBridge/tools/shared';
import { createCodexFolderImporter, type CodexFolderInput, type CodexImportStore } from '@/engines/genealogy/codexFolderImport';
import type { CodexEntry } from '@/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const input = (path: string, text: string): CodexFolderInput => ({ format: 'obsidian', files: [{ path, text }] });

/** Run only in an isolated Electron profile with the QA DB-name build plugin. */
export async function testCodexFolderImport() {
  assert(db.name.startsWith('QA136-'), 'This test must only open a private QA136 database.');
  await db.open();
  const projectId = `private-folder-${crypto.randomUUID()}`;
  await db.projects.put({ id: projectId, title: 'Private folder fixture', type: 'book', mode: 'custom', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 });
  const successful = [];
  for (const name of ['wh_codex_import_preview', 'wh_codex_import_apply', 'wh_codex_import_undo']) assert(getBridgeTool(name)?.engineId === 'codex', `Catalogue registers ${name}`);
  const payload = { projectId, ...input('characters/Ada.md', '---\nid: external-1\ntype: character\ntags:\n - writer\n---\n# Ada\nFull **biography**, kept intact.') };
  const preview = await runBridgeTool('wh_codex_import_preview', payload);
  assert(preview.ok && (preview.result as any).preview.additions.length === 1, 'Real dispatcher previews the document');
  assert(await db.codexEntries.where('projectId').equals(projectId).count() === 0, 'Preview does not write');
  const concurrent = await Promise.all([runBridgeTool('wh_codex_import_apply', payload), runBridgeTool('wh_codex_import_apply', payload)]);
  assert(concurrent.every(reply => reply.ok), 'Concurrent transactions both resolve');
  const first = concurrent.find(reply => (reply.result as any).createdIds.length === 1)?.result as any;
  const second = concurrent.find(reply => (reply.result as any).createdIds.length === 0)?.result as any;
  assert(first && second && second.preview.duplicates.length === 1, 'Serialized concurrent reimport creates exactly one entry');
  const row = await db.codexEntries.get(first.createdIds[0]);
  assert(row?.type === 'character' && row.content.includes('<strong>biography</strong>') && row.fields.__importSourceId === 'external-1' && row.fields.__importSourceContent === payload.files[0].text, 'Canonical rich text, tags and complete source preserved');
  const changed = await runBridgeTool('wh_codex_import_apply', { projectId, ...input('characters/Ada.md', '# A changed source') });
  assert(changed.ok && (changed.result as any).createdIds.length === 0 && (changed.result as any).preview.conflicts.length === 1, 'Changed same path reports conflict without overwriting');
  const noop = await runBridgeTool('wh_codex_import_undo', { projectId, applyId: second.applyId });
  assert(noop.ok && (noop.result as any).removedIds.length === 0 && await db.codexEntries.get(row!.id), 'Undo of noop reimport preserves original entry');
  successful.push('Public dispatcher + native DB: preview, canonical body/provenance, concurrent duplicate, changed-source conflict, noop undo');

  const batch = { projectId, format: 'notion', files: [{ path: 'one.md', text: '# One\n\nType: location\nID: notion-123\n\nBody' }, { path: 'two.md', text: '# Two\nBody' }] };
  const batchReply = await runBridgeTool('wh_codex_import_apply', batch); assert(batchReply.ok, 'Batch applies');
  const receipt = batchReply.result as any;
  assert((await db.codexEntries.get(receipt.createdIds[0]))?.type === 'location', 'Actual Notion exported properties are imported as codex metadata');
  await db.codexEntries.update(receipt.createdIds[1], { content: '<p>Manual edit preserved</p>', updatedAt: 99 });
  const stale = await runBridgeTool('wh_codex_import_undo', { projectId, applyId: receipt.applyId });
  assert(!stale.ok && stale.code === 'stale_import', 'Real dispatcher exposes stale undo as failed call');
  assert((await db.codexEntries.bulkGet(receipt.createdIds)).every(Boolean), 'Stale undo removes none of the batch');
  assert((await db.codexEntries.get(receipt.createdIds[1]))?.content === '<p>Manual edit preserved</p>', 'User edit survives undo refusal');
  successful.push('Public undo preserves later local edits and the entire batch');

  const adapter: CodexImportStore = {
    list: p => db.codexEntries.where('projectId').equals(p).toArray(), get: id => db.codexEntries.get(id),
    addAll: async rows => { await db.codexEntries.add(rows[0]); throw new Error('Owned native transaction failure after first add'); },
    deleteAll: ids => db.codexEntries.bulkDelete(ids), atomic: run => db.transaction('rw', db.codexEntries, run),
  };
  const failing = createCodexFolderImporter(adapter, htmlFromMarkdown);
  const before = await db.codexEntries.toArray();
  let failed = false;
  try { await failing.apply(projectId, { format: 'campfire', files: [{ path: 'rollback1.md', text: 'One' }, { path: 'rollback2.md', text: 'Two' }] }); } catch { failed = true; }
  assert(failed && JSON.stringify(await db.codexEntries.toArray()) === JSON.stringify(before), 'Native Dexie rollback restores the entire database after first add failure');
  successful.push('Actual native Dexie transaction rollback after partial write preserves all rows');

  const undo = await runBridgeTool('wh_codex_import_undo', { projectId, applyId: first.applyId });
  assert(undo.ok && (undo.result as any).removedIds.length === 1 && await db.codexEntries.where('projectId').equals(projectId).count() === 2, 'Matching snapshot undo removes only its own entry');
  const remaining: CodexEntry[] = await db.codexEntries.where('projectId').equals(projectId).toArray();
  assert(remaining.some(entry => entry.content === '<p>Manual edit preserved</p>'), 'Other receipt rows survive undo');
  successful.push('Snapshot undo deletes only unchanged rows belonging to its receipt');
  db.close();
  return successful;
}
