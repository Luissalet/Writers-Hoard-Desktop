import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import RelationTreesWorkspace from '@/engines/genealogy/components/RelationTreesWorkspace';
import { saveRelationTree } from '@/engines/genealogy/relationTreeStore';
import { makeTreeText } from '@/engines/genealogy/relationTreeAnnotations';
import type { RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { insertTreeJunction } from '@/engines/genealogy/relationTreeRoutes';
const P = 'visual-tree-annotations', T = 'visual-family';
async function main() {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const project: Project = { id: P, title: 'La casa del estuario', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['genealogy'], engineOrder: ['genealogy'], createdAt: 1, updatedAt: 1 };
  await db.projects.put(project);
  const tree: RelationTreeDocument = { id: T, title: 'La casa del estuario · invierno', nodes: [
    { id: 'ada', label: 'Ada del Estuario', position: { x: 110, y: 80 } },
    { id: 'blai', label: 'Blai del Bosque', position: { x: 420, y: 80 }, deceased: true },
    { id: 'noa', label: 'Noa del Estuario', position: { x: 265, y: 295 } },
  ], edges: [
    { id: 'partner', source: 'ada', target: 'blai', sourceHandle: 'right', targetHandle: 'left', kind: 'partner', style: 'dashed', label: 'Antigua alianza', icon: 'Heart' },
    { id: 'child', source: 'ada', target: 'noa', kind: 'biological_parent', style: 'solid' },
  ], annotations: [{ ...makeTreeText('winter-note', 'Invierno de 124\nLa rama oriental cruza el río.\nLos nombres aún no están confirmados.', { x: 550, y: 260 }), size: { width: 350, height: 190 } }], viewport: { x: 20, y: 15, zoom: .88 }, revision: 0, createdAt: 1, updatedAt: 1 };
  await saveRelationTree(P, insertTreeJunction(tree, 'partner', 'visual-junction'), null);
  (window as unknown as { __readTree: () => Promise<RelationTreeDocument> }).__readTree = async () => (await db.projects.get(P))!.relationTrees!.find(item => item.id === T)!;
  createRoot(document.getElementById('root')!).render(<MemoryRouter><main className="min-h-full bg-deep text-text-primary p-5"><h1 className="text-xl font-semibold mb-4">Árboles de relaciones</h1><RelationTreesWorkspace projectId={P} canonical={<p>Genealogía canónica</p>} /></main></MemoryRouter>);
}
void main().then(() => { (window as unknown as { __previewReady: boolean }).__previewReady = true; }).catch(error => { (window as unknown as { __previewError: string }).__previewError = String(error); });
