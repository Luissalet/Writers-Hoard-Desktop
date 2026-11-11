import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { readWorldDocument, saveWorldEra } from '@/services/worldEras/store';
import type { WorldTable } from '@/engines/tables/types';
import type { WorldEraScope } from '@/services/worldEras/types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export async function testTableCellAudit(): Promise<string[]> {
  const projectId = 'qa-table-cell-audit-' + crypto.randomUUID(), eraId = projectId + '-era';
  const columns: WorldTable['columns'] = [{ id: 'name', name: 'Name', kind: 'text' },
    { id: 'amount', name: 'Amount', kind: 'number' }];
  const table: WorldTable = { id: 'table', title: 'Audit table QA', mode: 'table', columns,
    rows: [{ id: 'r1', cells: { name: 'Alfa' } }, { id: 'r2', cells: { name: 'Bravo', amount: '6' } }] };
  const sheet: WorldTable = { id: 'sheet', title: 'Audit sheet QA', mode: 'sheet', columns,
    rows: [{ id: 'r1', cells: { name: 'Alfa', amount: '2' } }, { id: 'r2', cells: { name: 'Bravo', amount: '6' } },
      { id: 'r3', cells: { name: 'Total', amount: '=SUM(B1:B2)' } }] };
  const base = { projectId }, past = { projectId, eraId };
  const read = async (tableId: string, scope: WorldEraScope = base) => {
    const value = await readWorldDocument(scope, 'tables', tableId);
    assert(value, 'Missing scoped table');
    return { ...value, table: value.document.root as unknown as WorldTable };
  };
  const write = async (tableId: string, rowId: string, columnId: string, expected: string, value: string, scope: WorldEraScope = base): Promise<Record<string, unknown>> => {
    const result = await runBridgeTool('wh_table_save_cell', { ...scope, tableId, rowId, columnId, expected, value });
    assert(result.ok, result.error ?? 'Cell save failed');
    const shape = result.result as { saved?: boolean; __audit?: Record<string, unknown> };
    assert(shape.saved && shape.__audit, 'The save did not return an audit envelope');
    if (expected === value) {
      assert(!Object.hasOwn(shape.__audit, 'entityId'), 'A no-op audit would offer an unusable history Undo');
    } else {
      assert(shape.__audit.entityId === tableId, 'The audit does not identify the saved table');
    }
    return { ...shape.__audit, ...scope, tool: 'wh_table_save_cell' };
  };
  const undo = (entry: Record<string, unknown>) => runBridgeTool('__undo', { entry });
  await db.projects.add({ id: projectId, title: 'Cell audit QA', description: '', mode: 'custom', type: 'standalone',
    status: 'draft', color: '#444444', enabledEngines: ['tables'], dataTables: [table, sheet], createdAt: 1, updatedAt: 1 });
  try {
    await saveWorldEra(projectId, { id: eraId, name: 'QA Era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const original = await read('table');
    const noop = await write('table', 'r1', 'amount', '', '');
    assert(noop.reversible === false && !Object.hasOwn((await read('table')).table.rows[0].cells, 'amount') &&
      (await read('table')).version === original.version, 'An empty no-op wrote a slot or offered Undo');

    const fill = await write('table', 'r1', 'amount', '', '7');
    await write('table', 'r2', 'name', 'Bravo', 'Changed neighbor');
    assert((await undo(fill)).ok, 'Could not undo the cell fill');
    const restored = await read('table');
    assert(!Object.hasOwn(restored.table.rows[0].cells, 'amount') && restored.table.rows[1].cells.name === 'Changed neighbor',
      'Undo lost the raw absence or reverted a neighbor');

    const first = await write('table', 'r1', 'name', 'Alfa', 'First write');
    await write('table', 'r1', 'name', 'First write', 'Later write');
    const stale = await undo(first);
    assert(!stale.ok && stale.code === 'cannot-undo' && (await read('table')).table.rows[0].cells.name === 'Later write',
      'Undo erased a later edit in the same cell');

    const eraFirst = await write('sheet', 'r1', 'amount', '2', '9', past);
    assert((await read('sheet', past)).provenance === 'variant', 'Era edit did not create an override');
    assert((await undo(eraFirst)).ok && (await read('sheet', past)).provenance === 'base',
      'Undo did not restore the inherited sheet');
    const eraSecond = await write('sheet', 'r1', 'amount', '2', '9', past);
    await write('sheet', 'r2', 'name', 'Bravo', 'Era neighbor', past);
    assert((await undo(eraSecond)).ok, 'Could not undo the era cell with a disjoint edit');
    const era = await read('sheet', past), shared = await read('sheet');
    assert(era.provenance === 'variant' && era.table.rows[0].cells.amount === '2' &&
      era.table.rows[1].cells.name === 'Era neighbor' && shared.table.rows[1].cells.name === 'Bravo' &&
      era.table.rows[2].cells.amount === '=SUM(B1:B2)', 'Scoped Undo changed a formula, neighbor, or Base');
    return ['No-op does not write or offer Undo', 'Absent slot and disjoint edits survive Undo',
      'A later edit to the same cell blocks stale Undo', 'Era Undo restores inheritance or preserves the neighboring override'];
  } finally {
    await deleteProject(projectId);
  }
}
