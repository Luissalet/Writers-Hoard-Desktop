import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { resolveEntity, searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { registerFallbackAnchorAdapters } from '@/engines/_shared/anchoring/registerFallbackAdapters';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import GenealogyTreeView from '@/engines/genealogy/components/GenealogyTreeView';
import type { Project } from '@/types';
const pause = () => new Promise(resolve => setTimeout(resolve, 45));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testWorldDocumentsSearch() {
  const P = `world-search-${Date.now()}`, Q = `${P}-other`, host = document.getElementById('root')!, root = createRoot(host);
  const project: Project = { id: P, title: 'Synthetic', description: '', mode: 'custom', type: 'standalone', color: '#aaa', status: 'draft', createdAt: 1, updatedAt: 1,
    dictionaries: [{ id: `${P}-lang`, name: 'Lúmico coast', description: 'Language of the bay', scriptMapping: '', detectInManuscript: false, words: [] }],
    dataTables: [{ id: `${P}-table`, title: 'Estuary trade', mode: 'table', columns: [{ id: 'good', name: 'Commodity', kind: 'text' }], rows: [{ id: 'salt', cells: { good: 'Ébano marino' } }] }],
    modelAssets: [{ id: `${P}-model`, name: 'Lighthouse GLB', dataUrl: 'data:model/gltf-binary;base64,AA==', size: 1, createdAt: 1 }],
    relationTrees: [{ id: `${P}-tree`, title: 'Harbor kinship', nodes: [], edges: [], annotations: [{ id: 'note', kind: 'text', position: { x: 0, y: 0 }, size: { width: 220, height: 80 }, text: 'Cartographer circle', color: '#d5b575', fontSize: 16 }], revision: 0, createdAt: 1, updatedAt: 1 }],
  };
  try {
    await db.projects.bulkPut([project, { ...project, id: Q, dictionaries: [{ ...project.dictionaries![0], id: `${Q}-lang`, name: 'PRIVATE FOREIGN coast' }], dataTables: [{ ...project.dataTables![0], id: `${Q}-table`, title: 'PRIVATE FOREIGN trade' }], modelAssets: [], relationTrees: [] }]);
    const tables = await searchEntities('ebano', ['tables'], P), models = await searchEntities('lighthouse', ['model-viewer'], P), languages = await searchEntities('coast', ['dictionary'], P), trees = await searchEntities('Cartographer', ['genealogy'], P);
    assert(tables.length === 1 && tables[0].id === project.dataTables![0].id && tables[0].searchTerms?.includes('Ébano marino'), 'Table content search must be accent-insensitive and usable by ranked global search');
    assert(models.length === 1 && models[0].id === project.modelAssets![0].id && languages.length === 1 && trees.length === 1 && [...models, ...languages, ...trees, ...tables].every(hit => hit.projectId === P && !JSON.stringify(hit).includes('base64')), 'Search must include metadata documents and exclude foreign records/binary payloads');
    for (const [id, type] of [[project.dataTables![0].id, 'world-table'], [project.modelAssets![0].id, 'model-asset'], [project.dictionaries![0].id, 'dictionary'], [project.relationTrees![0].id, 'relation-tree']]) assert((await resolveEntity(id, type))?.projectId === P, 'Cross-engine picker must resolve each new document type');
    registerFallbackAnchorAdapters(); let destination = ''; getAnchorAdapter('tables')!.navigateToEntity(project.dataTables![0].id, P, path => { destination = path; });
    assert(destination.includes(`/project/${P}/tables?entity=`), 'Scoped document adapter lost entity navigation');
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/genealogy?entity=${project.relationTrees![0].id}`]}><GenealogyTreeView projectId={P} /></MemoryRouter>); await pause(); });
    for (let i = 0; i < 100 && !host.querySelector(`select option[value="${project.relationTrees![0].id}"]:checked`); i++) await act(async () => { await pause(); });
    assert(host.querySelector(`select option[value="${project.relationTrees![0].id}"]:checked`), 'Global entity route must select the actual authored relation tree');
    return ['World document discovery: table content, language/model/tree search, scoped cross-engine resolution, no binary previews and actual tree entity deep link'];
  } finally { await act(async () => root.unmount()); await deleteProject(P); await deleteProject(Q); }
}
