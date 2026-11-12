import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { saveTableView } from '@/engines/tables/operations';
import { mutateEraRows } from '@/services/worldEras/store';
import { storedTableView } from '@/engines/tables/viewGroups';
import type { WorldTable } from '@/engines/tables/types';

const projectId = 'qa-group-subtotal-contract3020';
const title = 'Disposable subtotal contracts 3020';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

type Query = {
  matched: number;
  rows: unknown[];
  groups?: { value: string; label: string; count: number; subtotal?: { columnId: string; value: number | null; count: number } }[];
};

export async function testTableGroupSubtotals() {
  const table: WorldTable = {
    id: 'ledger', title: 'Group totals contract', mode: 'table',
    columns: [{ id: 'house', name: 'House', kind: 'text' }, { id: 'souls', name: 'Souls', kind: 'number' }],
    rows: Array.from({ length: 501 }, (_, index) => ({ id: String(index), cells: { house: 'Marrow', souls: '2' } })),
  };
  const references: WorldTable = {
    id: 'references', title: 'Reference groups', mode: 'table',
    columns: [{ id: 'patron', name: 'Patron', kind: 'reference' }, { id: 'souls', name: 'Souls', kind: 'number' }],
    rows: [
      { id: 'zulu-row', cells: { patron: 'a', souls: '7' } },
      { id: 'alpha-row', cells: { patron: 'z', souls: '4' } },
    ],
  };
  const precise: WorldTable = {
    ...table, id: 'precise',
    rows: ['1000000000000000', '0.01', '-1000000000000000'].map((souls, index) => ({
      id: String(index), cells: { house: 'Marrow', souls },
    })),
  };
  await db.projects.add({
    id: projectId, title, description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1, dataTables: [table, references, precise],
    worldEras: [{ id: 'era', name: 'Era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }],
  });
  try {
    await db.codexEntries.bulkAdd([['a', 'Zulu'], ['z', 'Alpha']].map(([id, title]) => ({
      id, projectId, title, type: 'character', content: '', fields: {}, relations: [], tags: [], createdAt: 1, updatedAt: 1,
    })));
    const scope = { projectId, tableId: table.id };
    const groupBy = [{ columnId: 'house', direction: 'asc' }];
    const plain = await runBridgeTool('wh_table_query', scope);
    assert(plain.ok && !Object.hasOwn(plain.result as object, 'groups'), 'Ordinary query response changed');
    const result = await runBridgeTool('wh_table_query', { ...scope, groupBy, subtotalColumnId: 'souls' });
    assert(result.ok, 'Grouped query failed');
    const query = result.result as Query, group = query.groups?.[0];
    assert(query.matched === 501 && query.rows.length === 500 && group?.count === 501, 'Group counts were computed after row pagination');
    assert(group.subtotal?.value === 1002 && group.subtotal.count === 501 && group.subtotal.columnId === 'souls', 'Group subtotal was computed after row pagination');
    const refused = await runBridgeTool('wh_table_query', { ...scope, groupBy, subtotalColumnId: 'house' });
    assert(!refused.ok, 'A nonnumeric subtotal was accepted');

    const byPatron = [{ columnId: 'patron', direction: 'asc' }];
    const referenceQuery = async (eraId?: string) => {
      const response = await runBridgeTool('wh_table_query', { projectId, tableId: references.id,
        ...(eraId ? { eraId } : {}), groupBy: byPatron, subtotalColumnId: 'souls' });
      assert(response.ok, 'Reference grouping query failed');
      return response.result as Query;
    };
    const baseRefs = await referenceQuery();
    assert(baseRefs.groups?.map(group => group.label).join(',') === 'Alpha,Zulu', 'Reference groups sorted by ID rather than title');
    assert(baseRefs.groups?.map(group => group.value).join(',') === 'z,a', 'Reference group identity was replaced with a label');
    assert((baseRefs.rows[0] as { id?: string })?.id === 'alpha-row', 'Reference order did not apply to returned rows');
    await mutateEraRows({ projectId, eraId: 'era' }, [{ table: 'codexEntries', id: 'a', changes: { title: 'Aardvark' } }]);
    assert((await referenceQuery('era')).groups?.map(group => group.label).join(',') === 'Aardvark,Alpha', 'Reference groups did not use the effective era title');
    assert((await referenceQuery()).groups?.map(group => group.label).join(',') === 'Alpha,Zulu', 'Era title changed Base grouping');

    for (const descending of [true, false]) {
      const response = await runBridgeTool('wh_table_query', { projectId, tableId: precise.id, groupBy,
        sorts: [{ id: 'souls', descending }], subtotalColumnId: 'souls' });
      assert(response.ok && (response.result as Query).groups?.[0].subtotal?.value === 0.01, 'Changing sort order changed the decimal subtotal');
    }

    await saveTableView(projectId, table.id, { subtotalColumns: ['souls'] }, { subtotalColumns: '[]' });
    const base = await db.projects.get(projectId);
    assert(storedTableView(base?.tableGroupingViews, table.id, 'era').subtotalColumns[0] === 'souls', 'Era lost Base inheritance');
    await saveTableView(projectId, table.id, { subtotalColumns: [] }, { subtotalColumns: '["souls"]' }, 'era');
    const changed = await db.projects.get(projectId);
    assert(storedTableView(changed?.tableGroupingViews, table.id).subtotalColumns[0] === 'souls', 'Era override altered Base');
    assert(storedTableView(changed?.tableGroupingViews, table.id, 'era').subtotalColumns.length === 0, 'Empty era override was lost');
    return 'Grouped query uses all filtered rows, preserves old shape, scoped reference order and exact decimal subtotals';
  } finally {
    if ((await db.projects.get(projectId))?.title === title) await deleteProject(projectId);
  }
}
