import '@/engines/tables/index';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { previewProjectDuplicate, duplicateProject } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { editTableRows } from '@/engines/tables/rowActions';
import { readWorldDocument } from '@/services/worldEras/store';
import type { Project } from '@/types';
import type { WorldTable } from '@/engines/tables/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function testTableRowOrderPortable(): Promise<string[]> {
  const P = 'qa-table-row-order-portable', targets: string[] = [], operationId = crypto.randomUUID();
  const table: WorldTable = { id: 'ordered-table', title: 'QA portable order', mode: 'table', columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'amount', name: 'Amount', kind: 'number' }], rows: ['Alfa', 'Bravo', 'Charlie'].map((id, index) => ({ id, cells: { name: id, amount: String(index) } })) };
  await db.projects.put({ id: P, title: 'QA row order portable', description: '', type: 'standalone', mode: 'custom', color: '#888888', status: 'draft', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1, dataTables: [table] } as Project);
  const names = (value: WorldTable) => { const name = value.columns.find(column => column.name === 'Name')!; return value.rows.map(row => row.cells[name.id] ?? '').join('|'); };
  try {
    const initial = (await readWorldDocument({ projectId: P }, 'tables', table.id))!;
    await editTableRows({ projectId: P }, table.id, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }, initial.version);
    const moved = (await readWorldDocument({ projectId: P }, 'tables', table.id))!;
    await editTableRows({ projectId: P }, table.id, { action: 'insert-row', beforeRowId: 'Bravo' }, moved.version);
    const original = JSON.stringify(await db.projects.get(P));
    const json = await importProjectData(await exportProjectData(P)); targets.push(json);
    const preview = await previewProjectDuplicate({ projectId: P });
    const duplicate = await duplicateProject({ projectId: P, operationId, title: 'QA order copy', expectedSourceVersion: preview.sourceVersion }); targets.push(duplicate.projectId);
    for (const target of targets) {
      const copy = (await db.projects.get(target))!.dataTables![0];
      assert(copy.id !== table.id && names(copy) === 'Charlie|Alfa||Bravo', 'Clone lost row sequence or identities');
      assert(copy.rows.every(row => !['Alfa', 'Bravo', 'Charlie'].includes(row.id)), 'Clone kept source row IDs');
      const number = copy.columns.find(column => column.name === 'Amount')!;
      assert(copy.rows.map(row => row.cells[number.id] ?? '').join('|') === '2|0||1', 'Clone detached values from rows');
    }
    assert(JSON.stringify(await db.projects.get(P)) === original, 'Clone changed source');
    const zip = await createProjectZipArchive(P);
    await db.projects.update(P, { dataTables: [] });
    await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] });
    const restored = (await db.projects.get(P))!.dataTables![0];
    assert(names(restored) === 'Charlie|Alfa||Bravo' && restored.rows[0].id === 'Charlie', 'ZIP restore lost exact saved order');
    return ['Normal JSON and Duplicate remap row IDs with cells/order paired; normal Project ZIP restores saved order'];
  } finally { for (const target of targets) await deleteProject(target); await deleteProject(P); await db.settings.delete(`projectDuplicate.operation.${operationId}`); }
}
