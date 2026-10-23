// Library folders with an icon and a colour, pinned documents, and "group into
// a new folder": the pure action, the panel, and wh_workspace_library_update.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import type { Project } from '@/types';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { applyWorkspaceLibraryAction, readWorkspaceLibrary, WorkspaceLibraryInvalidAction } from '@/components/project/workspace/library/model';
import type { WorkspaceDocument } from '@/components/project/workspace/library/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-library-folders';

export async function testLibraryFolders(): Promise<string[]> {
  const passed: string[] = [];
  // ---- the pure action ------------------------------------------------------------------------
  const docs: WorkspaceDocument[] = ['a', 'b', 'c'].map(id => ({ engineId: 'notes', entityId: id, title: id.toUpperCase(), route: `/n/${id}` }));
  let lib = readWorkspaceLibrary({});
  lib = applyWorkspaceLibraryAction(lib, { kind: 'create-folder', id: 'f1', name: 'Personajes' }, docs);
  lib = applyWorkspaceLibraryAction(lib, { kind: 'style-folder', id: 'f1', icon: 'users', color: '#C0504D' }, docs);
  assert(lib.folders[0].icon === 'users' && lib.folders[0].color === '#c0504d', `Styled: ${JSON.stringify(lib.folders[0])}`);
  for (const bad of [{ icon: 'skull' }, { color: 'red' }, {}]) {
    let refused = false; try { applyWorkspaceLibraryAction(lib, { kind: 'style-folder', id: 'f1', ...bad }, docs); } catch (error) { refused = error instanceof WorkspaceLibraryInvalidAction; }
    assert(refused, `Refused ${JSON.stringify(bad)}`);
  }
  const cleared = applyWorkspaceLibraryAction(lib, { kind: 'style-folder', id: 'f1', icon: null }, docs);
  assert(!cleared.folders[0].icon && cleared.folders[0].color === '#c0504d', 'null clears the icon, keeps the colour');
  lib = applyWorkspaceLibraryAction(lib, { kind: 'pin', documents: [docs[2]], pinned: true }, docs);
  lib = applyWorkspaceLibraryAction(lib, { kind: 'group', id: 'f2', name: 'Escenas', documents: [docs[1], docs[2]] }, docs);
  const placed = new Map(lib.placements.map(p => [p.entityId, p]));
  assert(placed.get('b')?.folderId === 'f2' && placed.get('c')?.folderId === 'f2' && placed.get('c')?.pinned === true, `Grouped and still pinned: ${JSON.stringify(lib.placements)}`);
  const reread = readWorkspaceLibrary({ workspaceFolders: lib.folders, workspacePlacements: lib.placements, workspaceRevision: lib.revision });
  assert(reread.folders.find(f => f.id === 'f1')?.icon === 'users' && reread.placements.find(p => p.entityId === 'c')?.pinned, 'Read back');
  assert(!readWorkspaceLibrary({ workspaceFolders: [{ id: 'x', name: 'X', order: 0, icon: 'skull' as never, color: 'javascript:' }] }).folders[0].icon, 'Unknown icon dropped on reading');
  passed.push('A folder takes an icon (12) and a #rrggbb colour, null clears one and anything else is refused; a pinned document stays pinned when grouped; "group" makes a folder holding the documents chosen; all read back, unknown values dropped');

  // ---- the panel --------------------------------------------------------------------------------
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Biblioteca', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['notes'], createdAt: 1, updatedAt: 1 } satisfies Project);
  for (const [id, title] of [['n-mapa', 'Mapa del valle'], ['n-cartas', 'Cartas'], ['n-plan', 'Plan del libro']]) await db.notes.put({ id, projectId: P, title, content: '', tags: [], pinned: false, createdAt: 1, updatedAt: 1 } as never);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const opened: string[] = [];
  try {
    await act(async () => { root = createRoot(host); root.render(<WorkspaceLibrary projectId={P} enabledEngineIds={['notes']} onOpen={async route => { opened.push(route); return true; }} onManage={async () => true} />); await pause(200); });
    const waitFor = async (pick: () => Element | null | undefined, what: string) => { for (let i = 0; i < 60; i++) { const found = pick(); if (found) return found as HTMLElement; await act(async () => { await pause(80); }); } throw Error(`Timed out: ${what}`); };
    const setValue = async (input: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
    const rowBox = (title: string) => [...document.querySelectorAll('[data-library-document]')].find(row => row.textContent?.includes(title))?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await waitFor(() => rowBox('Cartas'), 'documents');
    // Group "Cartas" and "Plan del libro" into a new folder.
    await setValue(document.querySelector('[data-testid="library-folder-name"]') as HTMLInputElement, 'Borradores');
    for (const title of ['Cartas', 'Plan del libro']) await act(async () => { rowBox(title)!.click(); await pause(); });
    await act(async () => { (document.querySelector('[data-testid="library-group"]') as HTMLButtonElement).click(); await pause(300); });
    const project = async () => readWorkspaceLibrary((await db.projects.get(P))!);
    let now = await project();
    const folder = now.folders.find(f => f.name === 'Borradores');
    assert(folder && now.placements.filter(p => p.folderId === folder.id).length === 2, `Grouped: ${JSON.stringify(now)}`);
    // Pin "Mapa del valle": it shows under Fijados and opens from there.
    await act(async () => { rowBox('Mapa del valle')!.click(); await pause(); });
    await act(async () => { (document.querySelector('[data-testid="library-pin"]') as HTMLButtonElement).click(); await pause(300); });
    const pinnedButton = await waitFor(() => document.querySelector('[data-library-pinned]'), 'pinned list');
    assert(pinnedButton.textContent?.includes('Mapa del valle'), `Pinned list: ${pinnedButton.textContent}`);
    await act(async () => { pinnedButton.click(); await pause(); });
    assert(opened.length === 1 && opened[0].includes('n-mapa'), `Opened from the pinned list: ${opened}`);
    // Style the new folder: crown, red.
    await act(async () => { (document.querySelector(`[data-library-folder="${folder.id}"]`) as HTMLButtonElement).click(); await pause(); });
    const details = document.querySelector('details'); assert(details, 'folder settings'); details.open = true;
    await act(async () => { (await waitFor(() => document.querySelector('[data-testid="library-folder-icon-crown"]'), 'icons')).click(); await pause(300); });
    await act(async () => { (await waitFor(() => document.querySelector('[data-testid="library-folder-color-c0504d"]:not([disabled])'), 'colours')).click(); await pause(300); });
    now = await project();
    const styled = now.folders.find(f => f.id === folder.id);
    assert(styled?.icon === 'crown' && styled.color === '#c0504d', `Styled from the panel: ${JSON.stringify(styled)}`);
    const navIcon = document.querySelector(`[data-library-folder="${folder.id}"] svg`) as SVGElement | null;
    assert(navIcon && /lucide-crown/.test(navIcon.getAttribute('class') ?? '') && (navIcon.getAttribute('style') ?? '').includes('192, 80, 77'), `Drawn with its icon and colour: ${navIcon?.outerHTML.slice(0, 200)}`);
    passed.push('Library panel: "Agrupar en carpeta nueva" files the two chosen notes in "Borradores"; "Fijar" puts "Mapa del valle" under Fijados, which opens it; the folder takes the crown icon and a red colour from its settings and the tree draws it so');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
  // ---- the bridge ----------------------------------------------------------------------------------
  try {
    const read = async () => (await runBridgeTool('wh_workspace_library_get', { projectId: P })).result as { revision: number; folders: Array<{ id: string; name: string; icon?: string; color?: string }>; placements: Array<{ entityId: string; pinned?: boolean; folderId?: string }> };
    let lib0 = await read();
    const stale = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'create-folder', name: 'X', expectedRevision: lib0.revision - 1 });
    assert(!stale.ok && /changed/.test(stale.error ?? ''), `Stale revision refused: ${JSON.stringify(stale)}`);
    const made = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'create-folder', name: 'Lugares', expectedRevision: lib0.revision });
    const lugares = (made.result as { folderId: string }).folderId;
    assert(made.ok && lugares, `Created: ${JSON.stringify(made)}`);
    lib0 = await read();
    const badIcon = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'style-folder', folderId: lugares, icon: 'skull', expectedRevision: lib0.revision });
    assert(!badIcon.ok && /refused/.test(badIcon.error ?? ''), `Unknown icon refused: ${JSON.stringify(badIcon)}`);
    const styled = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'style-folder', folderId: lugares, icon: 'map', color: '#3d85c6', expectedRevision: lib0.revision });
    assert(styled.ok, `Styled: ${JSON.stringify(styled)}`);
    lib0 = await read();
    const unpin = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'pin', pinned: false, documents: [{ engineId: 'notes', entityId: 'n-mapa' }], expectedRevision: lib0.revision });
    assert(unpin.ok, `Unpinned: ${JSON.stringify(unpin)}`);
    lib0 = await read();
    const placed = await runBridgeTool('wh_workspace_library_update', { projectId: P, action: 'place', folderId: lugares, documents: [{ engineId: 'notes', entityId: 'n-mapa' }], expectedRevision: lib0.revision });
    assert(placed.ok, `Placed: ${JSON.stringify(placed)}`);
    const last = await read();
    const f = last.folders.find(x => x.id === lugares), mapa = last.placements.find(p => p.entityId === 'n-mapa');
    assert(f?.icon === 'map' && f.color === '#3d85c6' && mapa?.folderId === lugares && !mapa.pinned, `Read: ${JSON.stringify(last)}`);
    passed.push('Bridge: wh_workspace_library_update creates a folder (folderId returned), styles it (an unknown icon is refused), unpins and files a note in it; a stale revision is refused; wh_workspace_library_get shows icon, colour and pins');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
