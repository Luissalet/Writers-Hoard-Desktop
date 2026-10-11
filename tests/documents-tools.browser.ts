import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { getWriting } from '@/engines/writings/operations';
import { listSnapshotMeta } from '@/engines/writings/snapshots';
import type { Writing } from '@/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export async function testDocumentTools(): Promise<string[]> {
  const projectId = 'qa-document-tools-' + crypto.randomUUID();
  const id = 'qa-writing-' + crypto.randomUUID();
  const now = Date.now();
  await db.projects.add({ id: projectId, title: 'QA documentos', mode: 'reporter', type: 'standalone', color: '#445566', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  const baseline = '<p>Árbol 👩‍🚀 y café.</p>';
  const writing: Writing = { id, projectId, title: 'Texto QA', content: baseline, wordCount: 4, tags: [], status: 'draft', createdAt: now, updatedAt: now };
  await db.writings.add(writing);
  const passed: string[] = [];
  try {
    const formatted = await runBridgeTool('wh_format_writing', { id, expectedUpdatedAt: now, format: { fontFamily: 'Times New Roman', fontSize: 14, color: '#225577', alignment: 'center', lineHeight: 1.5 } });
    assert(formatted.ok, 'Formatting failed: ' + formatted.error);
    const stored = await getWriting(id);
    assert(stored?.content.includes('data-wh-font="Times New Roman"') && stored.content.includes('data-wh-align="center"'), 'Format did not persist');
    assert(stored.content.includes('👩‍🚀') && stored.content.includes('Árbol'), 'Unicode lost');
    assert((await listSnapshotMeta(id)).length === 1, 'Pre-edit recovery version missing');
    passed.push('MCP dispatch formats persistently and preserves Unicode and recovery');

    const audit = (formatted.result as Record<string, unknown>).__audit as Record<string, unknown>;
    assert(audit?.before, 'Undo envelope missing');
    await undoAuditEntry({ entry: { ...audit, kind: 'update' } });
    assert((await getWriting(id))?.content === baseline, 'Normal bridge undo did not restore exact original');
    passed.push('Normal bridge undo restores text and formatting');

    const stale = await runBridgeTool('wh_format_writing', { id, expectedUpdatedAt: now, format: { color: '#112233' } });
    assert(!stale.ok && stale.code === 'conflict' && (await getWriting(id))?.content === baseline, 'Stale edit overwrote the chapter');
    const invalid = await runBridgeTool('wh_format_writing', { id, format: { color: 'red;position:fixed' } });
    assert(!invalid.ok && invalid.code === 'bad-args' && (await getWriting(id))?.content === baseline, 'Invalid format wrote data');
    const inherited = await runBridgeTool('wh_format_writing', { id, format: { color: '#225577', constructor: 'ignored' } });
    assert(!inherited.ok && inherited.code === 'bad-args' && (await getWriting(id))?.content === baseline, 'Unknown prototype-named format property wrote data');
    const scoped = await runBridgeTool('wh_format_writing', { id, __scopeProjectId: 'different-project', format: { color: '#112233' } });
    assert(!scoped.ok && scoped.code === 'scope', 'Cross-project scope was ignored');
    passed.push('Stale, malformed and cross-project edits preserve the chapter');

    const table = await runBridgeTool('wh_edit_writing_document', { id, operation: 'insertTable', rows: 2, cols: 2 });
    assert(table.ok, 'Table insertion failed: ' + table.error);
    const inspected = await runBridgeTool('wh_get_writing_document', { id });
    assert(inspected.ok, 'Inspect failed');
    const result = inspected.result as { tables: { rows: number; columns: number }[]; cells: { from: number }[]; html: string; updatedAt: number };
    assert(result.tables[0]?.rows === 2 && result.tables[0]?.columns === 2 && result.cells.length === 4, 'Table structure/positions missing');
    const add = await runBridgeTool('wh_edit_writing_document', { id, operation: 'addColumnAfter', from: result.cells[0].from + 2, expectedUpdatedAt: result.updatedAt });
    assert(add.ok, 'Column edit failed: ' + add.error);
    const after = await runBridgeTool('wh_get_writing_document', { id });
    assert((after.result as typeof result).tables[0]?.columns === 3, 'Column did not persist');
    passed.push('Table insertion, inspection and column editing use persisted editor structure');

    const page = await runBridgeTool('wh_edit_writing_document', { id, operation: 'insertPageBreak' });
    assert(page.ok && (await getWriting(id))?.content.includes('data-wh-page-break'), 'Manual page break missing');
    passed.push('Manual page break survives renderer tool persistence');
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOmcAAAAASUVORK5CYII=';
    const withImage = `${(await getWriting(id))!.content}<p><img src="${image}" alt="QA image"></p>`;
    await db.writings.update(id, { content: withImage, updatedAt: Date.now() + 20 });
    const richImage = await runBridgeTool('wh_format_writing', { id, format: { fontSize: 16 } });
    assert(richImage.ok && (await getWriting(id))?.content.includes(image), 'Rich editing lost a persisted embedded image');
    const imageDoc = await runBridgeTool('wh_get_writing_document', { id });
    assert(imageDoc.ok && (imageDoc.result as { html: string }).html.includes(image), 'Inspect/reload lost the embedded image');
    passed.push('Rich tool reconstruction, format and inspection preserve embedded raster images');
    return passed;
  } finally {
    await db.writingSnapshots.where('writingId').equals(id).delete();
    await db.writings.delete(id); await db.projects.delete(projectId);
  }
}
