import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProjectDetail from '@/pages/ProjectDetail';
import Sidebar from '@/components/layout/Sidebar';
import { useLocaleStore } from '@/stores/localeStore';
import { seedWorkspaceLibrary } from './workspace-library-data';
import { updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { listWorkspaceDocuments } from '@/components/project/workspace/library/catalog';
import '@/index.css';
async function preview() {
  const P = 'workspace-library-preview'; useLocaleStore.setState({ locale: 'es' }); await seedWorkspaceLibrary(P);
  await updateWorkspaceLibrary(P, 0, { kind: 'create-folder', id: 'research', name: 'Documentación' });
  await updateWorkspaceLibrary(P, 1, { kind: 'create-folder', id: 'coast', name: 'Costa y navegación', parentId: 'research' });
  await updateWorkspaceLibrary(P, 2, { kind: 'create-folder', id: 'story', name: 'Historia' });
  const documents = await listWorkspaceDocuments(P);
  await updateWorkspaceLibrary(P, 3, { kind: 'place', documents: documents.filter(item => ['codex', 'maps', 'dictionary', 'tables'].includes(item.engineId)), folderId: 'coast' });
  await updateWorkspaceLibrary(P, 4, { kind: 'place', documents: documents.filter(item => ['writings', 'board', 'timeline'].includes(item.engineId)), folderId: 'story' });
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=${P}-writing`]}><Routes><Route path="/project/:id/:tab" element={<div className="flex h-screen min-w-0 bg-deep text-text-primary"><Sidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><ProjectDetail /></main></div>} /></Routes></MemoryRouter>);
}
void preview().catch(error => { (window as unknown as { __libraryError: string }).__libraryError = String(error); });
