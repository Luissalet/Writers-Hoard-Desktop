import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { addTable, changeTable, saveTableView } from '@/engines/tables/operations';
import { filterRows } from '@/engines/tables/tableEdits';
import { filterStamp, storedTableView } from '@/engines/tables/viewGroups';
import { remapWorldMetadata } from '@/services/worldMetadata';
import type { SavedTableView, WorldTable } from '@/engines/tables/types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export async function testTableNamedViews() {
  const projectId = 'qa-contract-table-named-views3035', title = 'Disposable named views contracts';
  const table: WorldTable = {
    id: 'ledger', title: 'Ledger', mode: 'table',
    columns: [
      { id: 'zone', name: 'Zone', kind: 'text' }, { id: 'amount', name: 'Amount', kind: 'number' },
      { id: 'patron', name: 'Patron', kind: 'reference' }, { id: 'literal', name: 'Literal', kind: 'text' },
    ],
    rows: [{ id: 'row', cells: { zone: 'Coast', amount: '50', patron: 'card-a', literal: 'card-a' } }],
  };
  const live: WorldTable = { ...table, id: 'live', codexType: 'character', rows: [] };
  const sheet: WorldTable = { ...table, id: 'sheet', mode: 'sheet' };
  const eraId = 'later', scope = { projectId, tableId: table.id }, era = { ...scope, eraId };
  const list = async (args: typeof scope & { eraId?: string } = scope) => {
    const response = await runBridgeTool('wh_table_list_saved_views', args);
    assert(response.ok, 'Could not list saved views');
    return response.result as (SavedTableView & { available: boolean; inherited: boolean })[];
  };
  const edit = (action: string, fields: Record<string, unknown> = {}, args: typeof scope & { eraId?: string } = scope) =>
    runBridgeTool('wh_table_edit_saved_view', { ...args, ...fields, action });
  const id = (response: Awaited<ReturnType<typeof edit>>) => {
    assert(response.ok, 'Could not edit saved view');
    return (response.result as { viewId: string }).viewId;
  };
  const active = async (era?: string) => storedTableView((await db.projects.get(projectId))?.tableGroupingViews, table.id, era);
  await db.projects.add({
    id: projectId, title, description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1,
    dataTables: [table, live, sheet], worldEras: [{ id: eraId, name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }],
  });
  try {
    await db.codexEntries.add({ id: 'card-a', projectId, title: 'Navigator', type: 'character',
      content: '', fields: {}, relations: [], tags: [], createdAt: 1, updatedAt: 1 });
    assert((await list()).length === 0, 'Existing table unexpectedly has views');
    const coast = id(await edit('save', { name: '  Coast  ' }));
    assert((await list())[0].name === 'Coast', 'Saved name was not trimmed');
    assert(!(await edit('save', { name: ' coast ' })).ok, 'Duplicate name was accepted');

    const current = await active();
    await saveTableView(projectId, table.id, {
      rules: [{ columnId: 'zone', direction: 'asc' }], sorts: [{ id: 'amount', descending: true }],
      conditions: [{ columnId: 'zone', op: 'equals', value: 'Coast' },
        { columnId: 'patron', op: 'equals', value: ' CARD-A ' }, { columnId: 'literal', op: 'equals', value: 'card-a' }],
      subtotalColumns: ['amount'],
    }, { rules: '[]', sorts: '[]', conditions: filterStamp(current.conditionsRevision, current.conditions), subtotalColumns: '[]' });
    const filtered = id(await edit('save', { name: 'Filtered' }));
    assert(id(await edit('rename', { viewId: filtered, name: 'Grouped' })) === filtered, 'Rename changed the view ID');
    assert((await list(era)).every(view => view.inherited && view.available), 'Base views were not inherited');
    assert(!(await edit('delete', { viewId: coast }, era)).ok, 'Era deleted a Base view');
    const before = await active();
    id(await edit('apply', { viewId: coast }, era));
    const emptyEra = await active(eraId);
    assert(!emptyEra.rules.length && !emptyEra.sorts.length && !emptyEra.conditions.length && !emptyEra.subtotalColumns.length,
      'Applying an empty saved view did not override all four Base settings');
    assert(JSON.stringify(await active()) === JSON.stringify(before), 'Era application changed Base');
    assert(emptyEra.conditionsRevision > before.conditionsRevision, 'Apply did not advance the filter CAS');
    const later = id(await edit('save', { name: 'Later' }, era));
    assert(!(await list()).some(view => view.id === later), 'Era catalog leaked into Base');

    const eraOnly = { ...table, id: 'era-only', rows: [] };
    await addTable(projectId, eraOnly, eraId);
    await saveTableView(projectId, eraOnly.id, {
      conditions: [{ columnId: 'patron', op: 'notEquals', value: 'card-a' }],
    }, { conditions: filterStamp(0, []) }, eraId);
    const eraOnlyView = id(await edit('save', { name: 'Exclude navigator' }, { ...era, tableId: eraOnly.id }));

    const project = (await db.projects.get(projectId))!;
    assert(!project.dataTables?.some(value => value.id === eraOnly.id), 'Fixture table also exists in Base');
    const cloned = remapWorldMetadata(project, (value, prefix) => prefix + ':' + value, new Set(['card-a']));
    const duplicate = cloned.tableGroupingViews?.find(view => view.tableId === 'table:ledger' && !view.eraId);
    assert(duplicate?.savedViews?.some(view => view.id === 'table-view:' + filtered &&
      view.settings.conditions[0].columnId === 'column:zone' && view.settings.sorts[0].id === 'column:amount' &&
      view.settings.rules[0].columnId === 'column:zone' && view.settings.subtotalColumns[0] === 'column:amount'),
    'Project copy did not remap all saved-view identities');
    const copySettings = duplicate?.savedViews?.find(view => view.id === 'table-view:' + filtered)?.settings;
    const copiedTable = cloned.dataTables?.find(value => value.id === 'table:ledger');
    assert(copySettings && copiedTable, 'Copied fixture is missing');
    assert(copySettings.conditions[1].value === 'codex:card-a' && copySettings.conditions[2].value === 'card-a',
      'Copy did not distinguish a reference operand from literal text');
    assert(filterRows(copiedTable.rows, copySettings.conditions, (row, column) => row.cells[column]).length === 1,
      'The same row no longer matches after project copy');
    const copiedEraOnly = cloned.tableGroupingViews?.find(view => view.tableId === 'table:era-only' && view.eraId === 'era:later');
    assert(copiedEraOnly?.savedViews?.some(view => view.id === 'table-view:' + eraOnlyView &&
      view.settings.conditions[0].value === 'codex:card-a'), 'Reference operand was lost for a table that only exists in an era');

    await changeTable(projectId, table.id, value => { value.columns.find(column => column.id === 'literal')!.kind = 'reference'; });
    assert((await list()).find(view => view.id === filtered)?.available === false, 'Text predicate remained available after changing to a reference');
    id(await edit('rename', { viewId: filtered, name: 'Temporarily unavailable' }));
    assert(!(await edit('apply', { viewId: filtered })).ok, 'Renaming reinterpreted the captured text predicate');
    await changeTable(projectId, table.id, value => { value.columns.find(column => column.id === 'literal')!.kind = 'text'; });
    assert((await list()).find(view => view.id === filtered)?.available === true, 'Restoring the text type did not restore the view');

    await changeTable(projectId, table.id, value => { value.columns.find(column => column.id === 'patron')!.kind = 'text'; });
    assert((await list()).find(view => view.id === filtered)?.available === false, 'Reference predicate remained available after retyping');
    await changeTable(projectId, table.id, value => { value.columns.find(column => column.id === 'patron')!.kind = 'reference'; });
    assert((await list()).find(view => view.id === filtered)?.available === true, 'Restoring the reference type did not restore the view');
    await changeTable(projectId, table.id, value => { value.columns = value.columns.filter(column => column.id !== 'amount'); });
    assert((await list()).find(view => view.id === filtered)?.available === false, 'Missing column was hidden in saved view listing');
    assert(!(await edit('apply', { viewId: filtered })).ok, 'Invalid view applied partially');
    const unchanged = await active();
    id(await edit('delete', { viewId: filtered }));
    assert(JSON.stringify(await active()) === JSON.stringify(unchanged), 'Deleting a saved view changed the current settings');
    assert((await db.projects.get(projectId))?.dataTables?.[0].rows[0].cells.zone === 'Coast', 'Saved view edited row data');
    const liveArgs = { ...scope, tableId: live.id };
    const liveId = id(await edit('save', { name: 'Live' }, liveArgs));
    assert(id(await edit('apply', { viewId: liveId }, liveArgs)) === liveId, 'Live view could not be applied');
    assert(!(await edit('save', { name: 'Sheet' }, { ...scope, tableId: sheet.id })).ok, 'A sheet accepted a named view');
    return 'Saved views scope, stable identity, compatibility, atomic settings and copy remapping';
  } finally {
    if ((await db.projects.get(projectId))?.title === title) await deleteProject(projectId);
  }
}
