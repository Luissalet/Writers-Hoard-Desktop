import JSZip from 'jszip';
import { db } from '@/db';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { importProjectData } from '@/db/operations';
import { countProjectRowsByEngine } from '@/components/project/engineDataCounts';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testVvdWorldPortability(): Promise<string[]> {
  const P = `world-portability-${Date.now()}`, E = `${P}-entry`, F = `${P}-other-entry`;
  let cloneId: string | undefined;
  const project: Project = {
    id: P, title: 'Synthetic portable world', mode: 'custom', type: 'standalone', color: '#aaa', description: '', status: 'draft', enabledEngines: ['codex', 'dictionary', 'tables', 'model-viewer', 'genealogy'], engineOrder: ['codex', 'dictionary', 'tables', 'model-viewer', 'genealogy'], createdAt: 1, updatedAt: 1,
    dictionaries: [{ id: 'language', name: 'Coastal', description: '', scriptMapping: 'a=α', detectInManuscript: true, words: [{ id: 'word', word: 'ara', meaning: 'shore', nativeForm: '', pronunciation: '', partOfSpeech: '', examples: '', phrases: '', derivatives: '', origin: '', linkedEntryId: E }] }],
    dataTables: [{ id: 'roster', title: 'Roster', mode: 'table', columns: [{ id: 'person', name: 'Person', kind: 'reference' }], rows: [{ id: 'row', cells: { person: E } }] }],
    modelAssets: [{ id: 'model', name: 'serialization-only synthetic data', dataUrl: 'data:model/gltf-binary;base64,AA==', size: 1, createdAt: 1 }],
    relationTrees: [{ id: 'tree', title: 'Court', revision: 1, createdAt: 1, updatedAt: 1, nodes: [{ id: 'n1', label: 'Iria', codexEntryId: E, position: { x: 1, y: 2 } }, { id: 'n2', label: 'Crown', position: { x: 3, y: 4 } }], edges: [{ id: 'edge', source: 'n1', target: 'n2', kind: 'custom', label: 'serves', style: 'dashed' }] }],
  };
  const entry = { id: E, projectId: P, type: 'character' as const, title: 'Iria', fields: {}, content: '<p>Sea</p>', tags: [], relations: [{ targetId: F, targetTitle: 'Taro', type: 'friend' }], createdAt: 1, updatedAt: 1 };
  try {
    await db.projects.put(project); await db.codexEntries.bulkPut([entry, { ...entry, id: F, title: 'Taro', relations: [] }]);
    const counts = await countProjectRowsByEngine(P);
    assert(counts.dictionary === 2 && counts.tables === 2 && counts['model-viewer'] === 1 && counts.genealogy === 1, 'Engine management must count nested local documents');
    const archive = await createProjectZipArchive(P);
    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer());
    const projectFile = Object.keys(zip.files).find(path => path.endsWith('/project.json'))!;
    const metadata = JSON.parse(await zip.file(projectFile)!.async('string')) as Project;
    assert(metadata.dictionaries?.[0].words[0].linkedEntryId === E && metadata.dataTables?.[0].rows[0].cells.person === E && metadata.relationTrees?.[0].nodes[0].codexEntryId === E && metadata.modelAssets?.[0].dataUrl === project.modelAssets![0].dataUrl, 'ZIP must carry every new world document unchanged');
    await db.projects.update(P, { dictionaries: [], dataTables: [], modelAssets: [], relationTrees: [] });
    await importProjectZip(new File([archive.blob], 'world.zip'), { replaceProjectIds: [P] });
    const restored = (await db.projects.get(P))!;
    assert(restored.dictionaries?.length === 1 && restored.dataTables?.length === 1 && restored.modelAssets?.length === 1 && restored.relationTrees?.length === 1, 'Real ZIP restore must recover all nested world documents');

    cloneId = await importProjectData({ project: restored, codexEntries: [entry, { ...entry, id: F, title: 'Taro', relations: [] }] });
    const clone = (await db.projects.get(cloneId))!;
    const cloneEntries = await db.codexEntries.where('projectId').equals(cloneId).toArray();
    const newIria = cloneEntries.find(entry => entry.title === 'Iria')!;
    const newTaro = cloneEntries.find(entry => entry.title === 'Taro')!;
    assert(clone.dictionaries?.[0].id !== 'language' && clone.dictionaries?.[0].words[0].linkedEntryId === newIria.id, 'Dictionary identities and links must stay in cloned project');
    const clonedTable = clone.dataTables![0];
    assert(clonedTable.rows[0].cells[clonedTable.columns[0].id] === newIria.id && clonedTable.columns[0].id !== 'person', 'Typed table references must be remapped');
    const tree = clone.relationTrees![0];
    assert(tree.nodes[0].codexEntryId === newIria.id && tree.edges[0].source === tree.nodes[0].id && tree.edges[0].target === tree.nodes[1].id && tree.nodes[0].id !== 'n1', 'Tree node/edge relationships must be cloned consistently');
    assert(newIria.relations[0].targetId === newTaro.id && clone.modelAssets?.[0].id !== 'model', 'Codex relationships and asset identities must be remapped');
    assert((await db.projects.get(P))!.dictionaries?.[0].words[0].linkedEntryId === E, 'Source project must remain unchanged');
    return ['World portability: metadata-aware engine inventory', 'World portability: real ZIP export/replace/restore preserves dictionaries, tables, trees and model bytes', 'World portability: JSON clone remaps all nested identities and references without crossing projects'];
  } finally {
    for (const id of [P, cloneId].filter((value): value is string => Boolean(value))) {
      for (const table of db.tables) { if (table.schema.indexes.some(index => index.name === 'projectId')) await table.where('projectId').equals(id).delete(); }
      await db.projects.delete(id);
    }
  }
}
