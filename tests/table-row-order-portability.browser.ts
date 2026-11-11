import '@/engines/tables/index';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { previewProjectDuplicate, duplicateProject } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { editTableRows } from '@/engines/tables/rowActions';
import { projectWorldTable } from '@/engines/tables/projection';
import { listEraRows, listWorldDocuments, readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import type { CodexEntry, Project } from '@/types';
import type { WorldTable } from '@/engines/tables/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function testTableRowOrderPortable(): Promise<string[]> {
  const P = 'qa-table-row-order-portable', targets: string[] = [], operationId = crypto.randomUUID();
  const table: WorldTable = { id: 'ordered-table', title: 'QA portable order', mode: 'table', columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'amount', name: 'Amount', kind: 'number' }], rows: ['Alfa', 'Bravo', 'Charlie'].map((id, index) => ({ id, cells: { name: id, amount: String(index) } })) };
  const live: WorldTable = { id: 'portable-live', title: 'Portable live', mode: 'table', codexAllTypes: true, columns: [{ id: 'title', name: 'Name', kind: 'text', field: 'title' }], rows: [] };
  const eraTable = { ...live, id: 'portable-era-live', title: 'Portable era live' };
  const era = { projectId: P, eraId: 'past' };
  const card = (id: string): CodexEntry => ({ id, projectId: P, type: 'character', title: id, content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
  await db.projects.put({ id: P, title: 'QA row order portable', description: '', type: 'standalone', mode: 'custom', color: '#888888', status: 'draft', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1, dataTables: [table, live], worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] } as Project);
  await db.codexEntries.bulkPut([card('Arin'), card('Borin')]);
  await saveEraDocument(era, 'codex', { root: { ...card('Cerin') }, children: {} }, null);
  await saveEraDocument(era, 'tables', { root: { ...eraTable }, children: {} }, null);
  const names = (value: WorldTable) => { const name = value.columns.find(column => column.name === 'Name')!; return value.rows.map(row => row.cells[name.id] ?? '').join('|'); };
  try {
    const initial = (await readWorldDocument({ projectId: P }, 'tables', table.id))!;
    await editTableRows({ projectId: P }, table.id, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }, initial.version);
    const moved = (await readWorldDocument({ projectId: P }, 'tables', table.id))!;
    await editTableRows({ projectId: P }, table.id, { action: 'insert-row', beforeRowId: 'Bravo' }, moved.version);
    const liveRead = (await readWorldDocument({ projectId: P }, 'tables', live.id))!;
    await editTableRows({ projectId: P }, live.id, { action: 'move-row', rowId: 'Borin', beforeRowId: 'Arin' }, liveRead.version);
    const eraRead = (await readWorldDocument(era, 'tables', eraTable.id))!;
    await editTableRows(era, eraTable.id, { action: 'move-row', rowId: 'Cerin', beforeRowId: 'Arin' }, eraRead.version);
    const original = JSON.stringify(await db.projects.get(P));
    const liveNames = async (projectId: string, projected: WorldTable, eraId?: string) => {
      const columns = projectWorldTable(projected, await listEraRows<CodexEntry>({ projectId, eraId }, 'codexEntries'));
      return columns.rows.map(row => row.cells[columns.columns[0].id]).join('|');
    };
    const json = await importProjectData(await exportProjectData(P)); targets.push(json);
    const preview = await previewProjectDuplicate({ projectId: P });
    const duplicate = await duplicateProject({ projectId: P, operationId, title: 'QA order copy', expectedSourceVersion: preview.sourceVersion }); targets.push(duplicate.projectId);
    for (const target of targets) {
      const copy = (await db.projects.get(target))!.dataTables![0];
      assert(copy.id !== table.id && names(copy) === 'Charlie|Alfa||Bravo', 'Clone lost row sequence or identities');
      assert(copy.rows.every(row => !['Alfa', 'Bravo', 'Charlie'].includes(row.id)), 'Clone kept source row IDs');
      const number = copy.columns.find(column => column.name === 'Amount')!;
      assert(copy.rows.map(row => row.cells[number.id] ?? '').join('|') === '2|0||1', 'Clone detached values from rows');
      const projectCopy = (await db.projects.get(target))!;
      const liveCopy = projectCopy.dataTables!.find(value => value.title === live.title)!;
      assert(await liveNames(target, liveCopy) === 'Borin|Arin' && liveCopy.liveRowOrder?.every(id => !['Arin', 'Borin'].includes(id)), 'Clone lost Base live positions or kept source IDs');
      const copyEra = { projectId: target, eraId: projectCopy.worldEras![0].id };
      const eraCopy = (await listWorldDocuments(copyEra, 'tables')).map(value => value.document.root as unknown as WorldTable).find(value => value.title === eraTable.title);
      assert(eraCopy && await liveNames(target, eraCopy, copyEra.eraId) === 'Cerin|Arin|Borin' && eraCopy.liveRowOrder?.every(id => !['Arin', 'Borin', 'Cerin'].includes(id)), 'Clone lost era-only live positions or kept source IDs');
    }
    assert(JSON.stringify(await db.projects.get(P)) === original, 'Clone changed source');
    const zip = await createProjectZipArchive(P);
    await db.projects.update(P, { dataTables: [] });
    await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] });
    const restored = (await db.projects.get(P))!.dataTables![0];
    assert(names(restored) === 'Charlie|Alfa||Bravo' && restored.rows[0].id === 'Charlie', 'ZIP restore lost exact saved order');
    const liveRestored = (await readWorldDocument({ projectId: P }, 'tables', live.id))!.document.root as unknown as WorldTable;
    const eraRestored = (await readWorldDocument(era, 'tables', eraTable.id))!.document.root as unknown as WorldTable;
    assert(liveRestored.liveRowOrder?.join('|') === 'Borin|Arin' && await liveNames(P, liveRestored) === 'Borin|Arin', 'ZIP lost Base live order');
    assert(eraRestored.liveRowOrder?.join('|') === 'Cerin|Arin|Borin' && await liveNames(P, eraRestored, era.eraId) === 'Cerin|Arin|Borin', 'ZIP lost era-only live order');
    return ['Normal JSON and Duplicate remap row IDs with cells/order paired; normal Project ZIP restores saved order', 'Live Base and era-only row order is remapped on JSON/Duplicate and restored by ZIP'];
  } finally { for (const target of targets) await deleteProject(target); await deleteProject(P); await db.settings.delete(`projectDuplicate.operation.${operationId}`); }
}
