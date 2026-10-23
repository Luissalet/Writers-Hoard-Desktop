import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { seedWorkspaceLibrary } from './workspace-library-data';
import { pinWorkspaceDocument, updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { readWorkspaceLibrary } from '@/components/project/workspace/library/model';
import { listWorkspaceDocuments } from '@/components/project/workspace/library/catalog';
import { workspaceDocumentKey } from '@/components/project/workspace/library/types';
import { openedInLibrary, recordLibraryOpen } from '@/components/project/workspace/library/opened';
import { clearUndoJournal, lastUndoable, undoEntry } from '@/services/undoJournal';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { saveWorldEra } from '@/services/worldEras/store';
import { getWorkspaceAppearance } from '@/services/workspaceAppearance/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import WorkspaceDecoration from '@/services/workspaceAppearance/WorkspaceDecoration';
import '@/services/workspaceAppearance/appearance.css';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { useLocaleStore } from '@/stores/localeStore';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
export async function testCampaignQuickWins(): Promise<string[]> {
  const passed: string[] = [], P = 'quickwins-synthetic'; let clone = '';
  const root = createRoot(document.getElementById('root')!);
  try {
    useLocaleStore.setState({ locale: 'en' }); await seedWorkspaceLibrary(P);
    const documents = await listWorkspaceDocuments(P), document = documents.find(row => row.engineId === 'writings')!;
    const revision = () => db.projects.get(P).then(row => readWorkspaceLibrary(row!).revision);
    clearUndoJournal(); await pinWorkspaceDocument(P, await revision(), document, true);
    assert((await db.projects.get(P))?.workspacePlacements?.find(row => row.entityId === document.entityId)?.pinned, 'Pin absent');
    assert(await undoEntry(lastUndoable(P)!.id) === 'undone', 'Pin undo failed');
    assert(!(await db.projects.get(P))?.workspacePlacements?.find(row => row.entityId === document.entityId)?.pinned, 'Undo kept pin');
    await pinWorkspaceDocument(P, await revision(), document, true);
    await updateWorkspaceLibrary(P, await revision(), { kind: 'create-folder', id: 'changed', name: 'Changed' });
    assert(await undoEntry(lastUndoable(P)!.id) === 'stale', 'Stale bookmark undo overwrote library');
    passed.push('Library bookmarks use normal CAS, undo exactly once and reject intervening changes');
    recordLibraryOpen(P, document); recordLibraryOpen(P, document);
    assert(openedInLibrary(P).length === 1 && openedInLibrary(P)[0] === workspaceDocumentKey(document), 'Recents not deduplicated');
    assert(openedInLibrary(P, 'elsewhere').length === 0 && openedInLibrary('foreign').length === 0, 'Recents leaked scope');
    passed.push('Window-session library recents deduplicate and isolate project/era');
    const saved = await runBridgeTool('wh_workspace_appearance_save', { projectId: P, expectedRevision: 0, patch: { effect: 'snow', effectIntensity: 80 } });
    assert(saved.ok && (saved.result as {revision:number}).revision === 1 && (await getWorkspaceAppearance({ projectId: P })).effective.effect === 'snow', 'Effects MCP save/read failed');
    await saveWorldEra(P, { id: 'effect-era', name: 'Synthetic', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    assert((await getWorkspaceAppearance({ projectId: P, eraId: 'effect-era' })).effective.effect === 'snow', 'Era did not inherit effect');
    clone = await importProjectData(JSON.parse(JSON.stringify(await exportProjectData(P))));
    assert((await getWorkspaceAppearance({ projectId: clone })).effective.effectIntensity === 80, 'Effects lost in project archive');
    const invalid = !(await runBridgeTool('wh_workspace_appearance_save', { projectId: P, expectedRevision: 1, patch: { effect: 'bogus' } })).ok;
    assert(invalid && (await getWorkspaceAppearance({ projectId: P })).revision === 1, 'Invalid effect partially saved');
    await act(async () => { root.render(<div className="workspace-appearance-pane"><WorkspaceDecoration values={{ effect: 'snow', effectIntensity: 80 }} /></div>); });
    assert(documentCount() === 32, 'Particle intensity not applied');
    await act(async () => { root.render(<WorkspaceDecoration values={{ effect: 'snow', performance: true }} />); });
    assert(documentCount() === 0, 'Performance mode kept particles mounted');
    passed.push('Effects MCP CAS, validation, Base/era inheritance, archive and performance no-particle rendering');
    await act(async () => { root.render(<WorkspaceLibrary projectId={P} enabledEngineIds={['writings','codex','notes']} onOpen={async () => true} onManage={async () => true} />); await pause(300); });
    for (let i = 0; i < 50 && !window.document.querySelector('[data-library-document]'); i++) await act(async () => { await pause(); });
    const row = [...window.document.querySelectorAll<HTMLElement>('[data-library-document]')].find(node => node.dataset.libraryDocument === workspaceDocumentKey(document));
    assert(row, 'Library row unavailable');
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); await pause(); });
    const menu = window.document.querySelector<HTMLButtonElement>('[role="menuitem"]'); assert(menu?.textContent === 'Unpin', 'Context menu did not reflect bookmark state');
    await act(async () => { menu.click(); await pause(200); });
    assert(!window.document.querySelector('[role="menu"]'), 'Context menu stayed open');
    assert(!(await db.projects.get(P))?.workspacePlacements?.find(item => item.entityId === document.entityId)?.pinned, 'Right-click unpin not saved');
    passed.push('Library right-click menu uses actual bookmark state and persists normal operation');
    return passed;
  } finally { await act(async () => root.unmount()); clearUndoJournal(); if (clone) await db.projects.delete(clone); await db.projects.delete(P); }
}
function documentCount() { return document.querySelectorAll('.workspace-particles i').length; }
