import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import RelationTreesWorkspace from '@/engines/genealogy/components/RelationTreesWorkspace';
import { saveRelationTree } from '@/engines/genealogy/relationTreeStore';
import type { RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import '@/index.css';
import '@xyflow/react/dist/style.css';

const P = 'tree-groups-preview', T = 'tree-groups-family';
type Window = typeof window & { __tgReady?: boolean; __tgError?: string; __readTree: () => Promise<RelationTreeDocument> };
const host = window as Window;
async function main() {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const project: Project = { id: P, title: 'Casas del estuario', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['genealogy', 'codex'], engineOrder: ['genealogy'], createdAt: 1, updatedAt: 1 };
  if (!(await db.projects.get(P))) await db.projects.put(project);
  const tree: RelationTreeDocument = { id: T, title: 'Las dos casas', nodes: [
    { id: 'ada', label: 'Ada del Estuario', position: { x: 110, y: 90 } },
    { id: 'blai', label: 'Blai del Bosque', position: { x: 460, y: 90 } },
    { id: 'noa', label: 'Noa del Estuario', position: { x: 110, y: 300 } },
  ], edges: [
    { id: 'partner', source: 'ada', target: 'blai', sourceHandle: 'right', targetHandle: 'left', kind: 'partner', style: 'dashed', label: 'Antigua alianza' },
    { id: 'child', source: 'ada', target: 'noa', kind: 'biological_parent', style: 'solid', label: 'Primogénita' },
  ], viewport: { x: 40, y: 30, zoom: .9 }, revision: 0, createdAt: 1, updatedAt: 1 };
  // A reload keeps the saved tree.
  if (!(await db.projects.get(P))?.relationTrees?.some(item => item.id === T)) await saveRelationTree(P, tree, null);
  host.__readTree = async () => (await db.projects.get(P))!.relationTrees!.find(item => item.id === T)!;
  createRoot(document.getElementById('root')!).render(<MemoryRouter><main className="min-h-full bg-deep text-text-primary p-5"><RelationTreesWorkspace projectId={P} canonical={<p>Genealogía canónica</p>} /></main></MemoryRouter>);
}
void main().then(() => { host.__tgReady = true; }).catch(error => { host.__tgError = String(error?.stack ?? error); });
