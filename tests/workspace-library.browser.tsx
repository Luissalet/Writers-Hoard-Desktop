import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { db } from '@/db';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { listWorkspaceDocuments, workspaceCatalogTables, workspaceDocument } from '@/components/project/workspace/library/catalog';
import { applyWorkspaceLibraryAction, folderPath, folderTree, readWorkspaceLibrary, WorkspaceLibraryConflict, WorkspaceLibraryInvalidAction } from '@/components/project/workspace/library/model';
import { updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { workspaceDocumentKey, workspaceEngineIds } from '@/components/project/workspace/library/types';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { useLocaleStore } from '@/stores/localeStore';
import { registerPendingFlusher } from '@/services/pendingWrites';
import type { EngineDefinition } from '@/engines/_types';
import { seedWorkspaceLibrary } from './workspace-library-data';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
export async function testWorkspaceLibrary(): Promise<string[]> {
  const P = `library-${Date.now()}`, foreign = `${P}-foreign`, passed: string[] = [], root = createRoot(document.getElementById('root')!); let cloned = '', cleanup: (() => void) | undefined;
  const wait = async (predicate: () => boolean, message: string) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = document.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (element: HTMLElement) => act(async () => { element.click(); await pause(130); });
  const change = async (element: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  const button = (text: string) => { const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); assert(element, `Missing ${text}`); return element; };
  const action = async (value: Parameters<typeof updateWorkspaceLibrary>[2]) => updateWorkspaceLibrary(P, readWorkspaceLibrary((await db.projects.get(P))!).revision, value);
  const snapshot = async () => {
    const result = await Promise.all(workspaceCatalogTables.map(async table => { const rows = await table.where('projectId').equals(P).toArray(); return Promise.all(rows.map(async row => 'blob' in row ? { ...row, blob: [...new Uint8Array(await row.blob.arrayBuffer())] } : row)); }));
    const { workspaceFolders: _folders, workspacePlacements: _placements, workspaceRevision: _revision, updatedAt: _updatedAt, ...metadata } = (await db.projects.get(P))!;
    return JSON.stringify({ result, metadata }, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
  };
  try {
    const project = await seedWorkspaceLibrary(P); await seedWorkspaceLibrary(foreign);
    const baseline = await snapshot(), documents = await listWorkspaceDocuments(P);
    assert(documents.length === 12 && documents.every(document => document.route.includes(P) && document.entityId.startsWith(P)), 'Mixed source catalog is project scoped');
    const extra = await listWorkspaceDocuments(P, { ...project, modelAssets: [{ id: 'model', name: 'Ship', dataUrl: '', size: 0, createdAt: 1 }] });
    assert(workspaceEngineIds.every(id => extra.some(document => document.engineId === id)), 'Catalog covers all thirteen supported core and metadata source classes');
    let library = readWorkspaceLibrary({ workspaceFolders: [{ id: 'a', name: 'A', parentId: 'b', order: 0 }, { id: 'b', name: 'B', parentId: 'a', order: 0 }, { id: 'missing-parent', name: 'C', parentId: 'gone', order: 1 }], workspacePlacements: [{ engineId: 'codex', entityId: 'entry', folderId: 'gone', order: 0 }] });
    assert(folderTree(library.folders).length === 3 && library.placements[0].folderId === undefined, 'Malformed missing parents and imported cycles normalize without hiding folders');
    library = { folders: [], placements: [], revision: 0 };
    library = applyWorkspaceLibraryAction(library, { kind: 'create-folder', id: 'a', name: 'Research' }, documents);
    library = applyWorkspaceLibraryAction(library, { kind: 'create-folder', id: 'b', name: 'Coast', parentId: 'a' }, documents);
    assert(folderPath(library.folders, 'b') === 'Research / Coast', 'Nested folder path preserves authored hierarchy');
    let invalid = false; try { applyWorkspaceLibraryAction(library, { kind: 'move-folder', id: 'a', parentId: 'b' }, documents); } catch (error) { invalid = error instanceof WorkspaceLibraryInvalidAction; } assert(invalid, 'Moving parent into descendant rejects cycles');
    passed.push('Catalog covers thirteen mixed source types and project scope; folder hierarchy, imported malformed data and cycle guards');

    await action({ kind: 'create-folder', id: 'a', name: 'Research' }); await action({ kind: 'create-folder', id: 'b', name: 'Coast', parentId: 'a' });
    const sources = documents.filter(document => ['codex', 'writings', 'maps', 'notes', 'dictionary', 'tables', 'media'].includes(document.engineId));
    await action({ kind: 'place', documents: sources, folderId: 'b' });
    await action({ kind: 'order-document', document: sources[0], direction: 1 });
    await action({ kind: 'rename-folder', id: 'b', name: 'Ports' });
    const revision = readWorkspaceLibrary((await db.projects.get(P))!).revision;
    const races = await Promise.allSettled([updateWorkspaceLibrary(P, revision, { kind: 'rename-folder', id: 'a', name: 'Sources' }), updateWorkspaceLibrary(P, revision, { kind: 'rename-folder', id: 'a', name: 'Sources elsewhere' })]);
    assert(races.filter(result => result.status === 'fulfilled').length === 1 && races.some(result => result.status === 'rejected' && result.reason instanceof WorkspaceLibraryConflict), 'Concurrent folder actions reject stale revision instead of overwriting');
    for (const document of [workspaceDocument(foreign, 'codex', `${foreign}-entry`, 'Foreign'), workspaceDocument(P, 'maps', 'missing', 'Missing')]) { let rejected = false; try { await action({ kind: 'place', documents: [document], folderId: 'a' }); } catch { rejected = true; } assert(rejected, 'Foreign or missing source cannot become a placement'); }
    await action({ kind: 'delete-folder', id: 'a' });
    const afterDelete = readWorkspaceLibrary((await db.projects.get(P))!); assert(afterDelete.folders[0].id === 'b' && !afterDelete.folders[0].parentId && afterDelete.placements.every(item => item.folderId === 'b'), 'Removing organizational parent reparents children, preserving document references');
    assert(await snapshot() === baseline, 'Organizing never changes any canonical source row, media byte or unrelated project metadata');
    passed.push('Actual CAS mutations: mixed bulk move/order/rename/delete, cycle and foreign-source guards; canonical source rows and binary bytes remain identical');

    cloned = await importProjectData(await exportProjectData(P));
    const clonedProject = (await db.projects.get(cloned))!, clonedLibrary = readWorkspaceLibrary(clonedProject), clonedDocuments = await listWorkspaceDocuments(cloned), clonedKeys = new Set(clonedDocuments.map(workspaceDocumentKey));
    assert(clonedLibrary.folders[0].id !== 'b' && clonedLibrary.placements.every(item => clonedKeys.has(workspaceDocumentKey(item)) && item.folderId === clonedLibrary.folders[0].id), 'Real JSON import consistently remaps folders and imported source IDs');
    assert(!clonedLibrary.placements.some(item => item.engineId === 'notes') && clonedLibrary.placements.some(item => item.engineId === 'media'), 'Legacy JSON omits notes and safely drops their placements; imported local media reference remains valid');
    const archive = await createProjectZipArchive(P), archiveLibrary = JSON.stringify(readWorkspaceLibrary((await db.projects.get(P))!));
    for (const table of workspaceCatalogTables) await table.where('projectId').equals(P).delete(); await db.projects.delete(P); await importProjectZip(new File([archive.blob], archive.fileName));
    assert(JSON.stringify(readWorkspaceLibrary((await db.projects.get(P))!)) === archiveLibrary && (await db.notes.get(`${P}-note`))?.text.startsWith('La brújula'), 'Real ZIP restore keeps folder, document and note identities');
    assert(await snapshot() === baseline, 'JSON cloning and ZIP restore keep original canonical document values and binary bytes intact');
    passed.push('Actual JSON clone remaps imported sources and folder IDs, drops absent notes safely; ZIP restores full library with original IDs and unchanged source bytes');

    useLocaleStore.setState({ locale: 'en' }); const opened: string[] = [];
    await act(async () => { root.render(<WorkspaceLibrary projectId={P} enabledEngineIds={['codex', 'writings', 'maps']} onOpen={async (route, target) => { opened.push(`${target}:${route}`); return true; }} onManage={async () => { opened.push('manage'); return true; }} />); await pause(150); });
    await wait(() => !!document.querySelector('[data-library-document]'), 'Library UI did not load');
    await change(node('library-folder-name'), 'New folder'); await click(button('Create folder')); await wait(() => !![...document.querySelectorAll('[data-library-folder]')].find(item => item.textContent === 'New folder'), 'Folder create UI did not persist');
    const newId = readWorkspaceLibrary((await db.projects.get(P))!).folders.find(item => item.name === 'New folder')!.id;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-library-document]')], first = rows.find(row => row.textContent?.includes('Puerto del Viento'))!; await click(first.querySelector<HTMLInputElement>('input')!);
    await change(node('library-destination'), newId); await click(node('library-move'));
    await wait(() => document.querySelector('[data-library-document]')?.textContent !== '', 'Move update missing');
    assert(readWorkspaceLibrary((await db.projects.get(P))!).placements.find(item => item.entityId === `${P}-entry`)?.folderId === newId, 'Accessible mixed selection UI moves real references');
    await click(first.querySelector<HTMLElement>('[data-library-open="beside"]')!); assert(opened[0] === `beside:/project/${P}/codex?entry=${P}-entry`, 'Document companion callback carries exact source deep link');
    await click(first.querySelector<HTMLElement>('[data-library-open="main"]')!); assert(opened[1].startsWith('main:'), 'Primary opening uses explicit main target');
    await click(button('Manage tools')); assert(opened.includes('manage'), 'Disabled source remains visible and offers honest tool management');
    await change(node('library-search'), 'brújula'); assert(document.querySelectorAll('[data-library-document]').length === 1, 'Search matches note titles across mixed source kinds');
    await change(node('library-search'), ''); await change(node('library-folder-name'), 'New folder'); await click(button('Create folder'));
    assert(node<HTMLInputElement>('library-folder-name').value === 'New folder' && document.querySelector('[role="alert"]'), 'Invalid action retains input and displays a recoverable error');
    passed.push('Actual library UI: create/bulk move/search, primary/companion deep links, disabled tool management and retained input after rejected save');

    function Tool() { const location = useLocation(); return <output data-testid="library-tool-route">{location.pathname}{location.search}</output>; }
    const engines = ['codex', 'writings'].map(id => ({ id, name: id, description: '', category: 'core', icon: BookOpen, tables: {}, component: Tool }) as EngineDefinition);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=${P}-writing`]}><ProjectWorkspace projectId={P} engines={engines}><Tool /></ProjectWorkspace></MemoryRouter>); await pause(150); });
    await click(node('workspace-library-open')); await wait(() => !!document.querySelector('[data-library-open="beside"]'), 'Integrated library modal did not load');
    cleanup = registerPendingFlusher('library-failure-test', async () => false);
    const target = [...document.querySelectorAll<HTMLElement>('[data-library-document]')].find(row => row.textContent?.includes('Puerto del Viento'))!.querySelector<HTMLElement>('[data-library-open="beside"]')!;
    await click(target); assert(document.querySelector('[data-testid="workspace-library"]') && !document.querySelector('[data-testid="workspace-secondary"]'), 'Failed flush keeps library open and does not create a companion');
    cleanup(); cleanup = undefined; await click(target);
    await wait(() => !!document.querySelector('[data-testid="workspace-secondary"]') && !document.querySelector('[data-testid="workspace-library"]'), 'Successful library opening did not create companion');
    const routes = [...document.querySelectorAll('[data-testid="library-tool-route"]')].map(item => item.textContent);
    assert(routes.some(value => value?.includes(`/codex?entry=${P}-entry`)) && routes.some(value => value?.includes(`/writings?writing=${P}-writing`)), 'Integrated library opens second mixed source while primary URL remains unchanged');
    passed.push('Integrated workspace library: flush failure retains modal; successful mixed source opening creates routed companion without changing the main document');
    return passed;
  } finally { cleanup?.(); await act(async () => root.unmount()); for (const id of [P, foreign, cloned].filter(Boolean)) { for (const table of workspaceCatalogTables) await table.where('projectId').equals(id).delete(); await db.projects.delete(id); } }
}
