// Companion tabs (rename, pin, duplicate, close others / right, reopen closed,
// Mod+1..9, overview, memory per project, "keep or delete" an empty new
// document) and the undo journal behind the "Deshacer" toast.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { db } from '@/db';
import type { CodexEntry, Project, Writing } from '@/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { ToastHost } from '@/components/common/toast';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { closeTabs, tabsStorageKey, type PaneTab, type TabsState } from '@/components/project/workspace/workspaceTabs';
import { deleteLibraryDocuments } from '@/components/project/workspace/library/bulkDelete';
import { renameWorkspaceFolder, updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { readWorkspaceLibrary } from '@/components/project/workspace/library/model';
import { workspaceDocument } from '@/components/project/workspace/library/catalog';
import { forgetKeptDocuments } from '@/components/project/workspace/freshDocument';
import { clearUndoJournal } from '@/services/undoJournal';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import { SHORTCUTS, SHORTCUT_SCOPES, TAB_REOPEN_SHORTCUT, matchesShortcut } from '@/components/common/shortcuts';
import { tabJumpIndex } from '@/components/project/workspace/workspaceTabs';
import es from '@/locales/es';
import en from '@/locales/en';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-workspace-tabs';
const route = (engine: string, key: string, id: string) => `/project/${P}/${engine}?${key}=${id}`;
const writing = (id: string, title: string, content: string, createdAt = 1): Writing => ({ id, projectId: P, title, status: 'draft', content, wordCount: content ? content.split(/\s+/).length : 0, tags: [], createdAt, updatedAt: createdAt });
const card = (id: string, title: string, content = ''): CodexEntry => ({ id, projectId: P, type: 'character', title, fields: {}, content, tags: [], relations: [], createdAt: 1, updatedAt: 1 });

export async function testWorkspaceTabs(): Promise<string[]> {
  const passed: string[] = [];
  useLocaleStore.setState({ locale: 'es' });
  try { window.localStorage.removeItem(tabsStorageKey(P)); } catch { /* storage may be blocked */ }
  clearUndoJournal(); forgetKeptDocuments();
  await db.projects.put({ id: P, title: 'Pestañas', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'codex'], createdAt: 1, updatedAt: 1 } satisfies Project);
  const now = Date.now();
  await db.writings.bulkPut([writing('w1', 'Capítulo uno', 'Había una vez un valle'), writing('w2', 'Capítulo dos', 'Otro día en el valle'), writing('w-new-keep', 'Sin título', '', now), writing('w-new-del', 'Sin título', '', now)]);
  await db.codexEntries.bulkPut([card('c1', 'Alma', 'Una capitana del río'), card('c-del', 'Para borrar', 'Texto'), card('c-undo', 'Para deshacer', 'Texto')]);

  function Tool({ engine }: { engine: string }) {
    const pane = useEnginePane(), id = pane?.instanceId ?? 'root';
    return <div data-testid={`tool-${id}`} data-engine={engine}>{pane?.primary && <>
      {[['w1', 'writings', 'writing'], ['w2', 'writings', 'writing'], ['c1', 'codex', 'entry'], ['w-new-keep', 'writings', 'writing'], ['w-new-del', 'writings', 'writing']].map(([doc, eng, key]) =>
        <button key={doc} type="button" data-testid={`beside-${doc}`} onClick={() => pane.openBeside?.(route(eng, key, doc))}>{doc}</button>)}
    </>}</div>;
  }
  const engines = ['writings', 'codex'].map(id => ({ id, name: id, description: '', category: 'core', icon: BookOpen, tables: {}, component: () => <Tool engine={id} /> }) as EngineDefinition);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const mount = async () => { await act(async () => { root = createRoot(host); root.render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=main`]}><ToastHost /><ProjectWorkspace projectId={P} engines={engines}><Tool engine="writings" /></ProjectWorkspace></MemoryRouter>); await pause(150); }); };
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const node = <T extends Element = HTMLElement>(testId: string): T => { const found = document.querySelector<T>(`[data-testid="${testId}"]`); assert(found, `Missing ${testId}`); return found; };
  const click = async (testId: string, wait = 160) => act(async () => { node<HTMLButtonElement>(testId).click(); await pause(wait); });
  const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  const labels = () => tabs().map(tab => tab.textContent ?? '');
  const activeIndex = () => tabs().findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const key = async (init: KeyboardEventInit) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await pause(160); });
  const setValue = async (input: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
  const stored = (): TabsState | null => { try { const raw = window.localStorage.getItem(tabsStorageKey(P)); return raw ? JSON.parse(raw) as TabsState : null; } catch { return null; } };
  const toastAction = () => { const all = document.querySelectorAll<HTMLButtonElement>('[data-testid="toast-action"]'); return all[all.length - 1]; };
  const waitFor = async (pick: () => unknown, what: string) => { for (let i = 0; i < 50; i++) { const found = pick(); if (found) return found; await act(async () => { await pause(80); }); } throw new Error(`Timed out waiting for ${what}`); };
  const openBeside = async (doc: string) => click(`beside-${doc}`);

  // ---- the shortcut rows match their handlers ------------------------------------------------------------
  const tabRows = SHORTCUTS.filter(row => row.scope === 'tabs');
  assert(tabRows.map(row => row.id).sort().join() === 'tabs.jump,tabs.reopen' && SHORTCUT_SCOPES.some(scope => scope.id === 'tabs'), 'Both tab shortcuts are listed in their own scope');
  for (const row of tabRows) for (const locale of [es, en] as Array<Record<string, string>>) assert(locale[row.descriptionKey] && locale['shortcuts.scope.tabs'] && locale['shortcuts.scope.tabs.where'], `Copy for ${row.id}`);
  const stroke = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  assert(matchesShortcut(stroke({ key: 'T', ctrlKey: true, shiftKey: true }), TAB_REOPEN_SHORTCUT, false) && matchesShortcut(stroke({ key: 't', metaKey: true, shiftKey: true }), TAB_REOPEN_SHORTCUT, true) && !matchesShortcut(stroke({ key: 't', ctrlKey: true }), TAB_REOPEN_SHORTCUT, false), 'Mod+Shift+T is the reopen chord and plain Mod+T is not');
  assert(tabJumpIndex({ key: '1', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }) === 0 && tabJumpIndex({ key: '9', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }) === 8 && tabJumpIndex({ key: '0', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }) === null && tabJumpIndex({ key: '1', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) === null, 'Mod+1..9 name tabs 1 to 9; 0 and a bare digit do not');
  passed.push('Shortcut table: tabs.jump (Mod+1-9) and tabs.reopen (Mod+Shift+T) are listed in Spanish and English and the handlers\' chords agree with the rows');

  try {
    await mount();
    // ---- open several documents, rename / pin / duplicate -------------------------------------------
    for (const doc of ['w1', 'w2', 'c1']) await openBeside(doc);
    assert(tabs().length === 3, `Three tabs open: ${labels()}`);
    await click(`workspace-tab-${tabs()[1].id.replace('tab-', '')}`);
    assert(activeIndex() === 1, 'Second tab selected');
    await click('workspace-tab-rename');
    await setValue(node<HTMLInputElement>('workspace-tab-rename-input'), 'Mi resumen');
    await click('workspace-tab-rename-save');
    assert(labels()[1].includes('Mi resumen · 2'), `Renamed tab shows the writer's name: ${labels()}`);
    assert((await db.writings.get('w2'))?.title === 'Capítulo dos', 'Renaming the tab leaves the document title alone');
    // pin the third tab: it moves to the front and its close button is disabled
    await click(`workspace-tab-${tabs()[2].id.replace('tab-', '')}`);
    await click('workspace-tab-pin');
    assert(tabs()[0].dataset.pinned === 'true' && tabs().length === 3, `Pinned tab first: ${labels()}`);
    assert(document.querySelector<HTMLButtonElement>(`[data-testid="workspace-close-tab-${tabs()[0].id.replace('tab-', '')}"]`)?.disabled === true, 'A pinned tab cannot be closed with its X');
    // duplicate the active (pinned) tab: the copy is unpinned and sits right after; the fourth tab is the last allowed
    await click('workspace-tab-duplicate');
    assert(tabs().length === 4 && tabs()[1].dataset.pinned !== 'true', `Duplicated: ${labels()}`);
    assert(node<HTMLButtonElement>('workspace-tab-duplicate').disabled, 'Duplicate is disabled at the four-tab limit');
    assert(stored()?.tabs.length === 4, 'Stored after every change');
    passed.push('Tabs: open three documents beside the main view, rename one (the document keeps its title), pin one (goes first, its X is disabled), duplicate (copy goes after it); duplicate stops at four tabs');

    // ---- close others / reopen closed ------------------------------------------------------------------
    const before = labels().length;
    await click(`workspace-tab-${tabs()[1].id.replace('tab-', '')}`);
    await click('workspace-tab-close-others');
    assert(tabs().length === 2 && tabs()[0].dataset.pinned === 'true', `Close others keeps the pinned tab and this one: ${labels()} (was ${before})`);
    assert(stored()!.closed.length === 2, `Two remembered: ${stored()!.closed.length}`);
    await key({ key: 'T', ctrlKey: true, shiftKey: true });
    assert(tabs().length === 3 && activeIndex() === 2, `Mod+Shift+T reopens the last closed tab and shows it: ${labels()}`);
    await click('workspace-tab-reopen');
    assert(tabs().length === 4 && stored()!.closed.length === 0, 'The reopen button restores the next one');
    assert(node<HTMLButtonElement>('workspace-tab-reopen').disabled, 'Nothing left to reopen');
    // close to the right of the first tab removes only the unpinned ones after it
    await click(`workspace-tab-${tabs()[1].id.replace('tab-', '')}`);
    await click('workspace-tab-close-right');
    assert(tabs().length === 2, `Close to the right: ${labels()}`);
    // the stack keeps ten
    const many: TabsState = { tabs: Array.from({ length: 12 }, (_, index): PaneTab => ({ id: `companion:${index}`, engineId: 'codex', history: [{ pathname: `/project/${P}/codex`, search: `?entry=${index}`, hash: '' }], index: 0 })), activeId: 'companion:0', closed: [] };
    let churn = many; for (let index = 0; index < 12; index++) churn = closeTabs(churn, [`companion:${index}`]);
    assert(churn.closed.length === 10 && churn.closed[0].history[0].search === '?entry=11', 'Only the last ten closed tabs are remembered, newest first');
    passed.push('Close others keeps pinned + current, Mod+Shift+T and the button reopen closed tabs newest first, close-to-the-right removes only unpinned tabs on the right; the closed stack holds ten');

    // ---- Mod+number, overview ---------------------------------------------------------------------------------
    await key({ key: '1', ctrlKey: true });
    assert(activeIndex() === 0, 'Mod+1 selects the first tab');
    await key({ key: '2', ctrlKey: true });
    assert(activeIndex() === 1, 'Mod+2 selects the second tab');
    await key({ key: '9', ctrlKey: true });
    assert(activeIndex() === 1, 'Mod+9 with no ninth tab does nothing');
    await key({ key: '2', ctrlKey: true, altKey: true });
    assert(activeIndex() === 1, 'Mod+Alt+2 is not a jump');
    await click('workspace-tab-overview-toggle');
    const rows = document.querySelectorAll('[data-testid^="workspace-overview-row-"]');
    assert(rows.length === 2, `Overview lists the open tabs: ${rows.length}`);
    const firstRowId = rows[0].getAttribute('data-testid')!.replace('workspace-overview-row-', '');
    await click(`workspace-overview-jump-${firstRowId}`);
    assert(activeIndex() === 0, 'Overview jump');
    const secondRowId = rows[1].getAttribute('data-testid')!.replace('workspace-overview-row-', '');
    await click(`workspace-overview-close-${secondRowId}`);
    assert(tabs().length === 1 && document.querySelector('[data-testid^="workspace-overview-reopen-"]'), 'Overview closes a tab and offers it under "Cerradas hace poco"');
    await click('workspace-overview-reopen-0');
    assert(tabs().length === 2, 'Overview reopens it');
    await click('workspace-tab-overview-toggle');
    passed.push('Mod+1/Mod+2 jump to that tab, Mod+9 with no ninth tab and Mod+Alt+2 do nothing; the overview lists tabs, jumps, closes and reopens');

    // ---- memory per project -----------------------------------------------------------------------------------------
    const beforeReload = stored()!;
    const activeBefore = beforeReload.activeId, namesBefore = labels();
    await unmount();
    await mount();
    assert(JSON.stringify(labels()) === JSON.stringify(namesBefore), `Same tabs after remount: ${labels()} vs ${namesBefore}`);
    assert(tabs()[activeIndex()].id === `tab-${activeBefore}`, 'Same active tab after remount');
    const hidden = tabs().find((tab, index) => index !== activeIndex())!;
    assert(!document.querySelector(`[data-testid="tool-${hidden.id.replace('tab-', '')}"]`), 'A restored tab that is not showing has not mounted its tool yet');
    await click(hidden.getAttribute('data-testid')!);
    assert(document.querySelector(`[data-testid="tool-${hidden.id.replace('tab-', '')}"]`), 'It mounts the first time it is shown');
    const bridge = await runBridgeTool('wh_workspace_tabs', { projectId: P });
    const read = bridge.result as { tabs: Array<{ position: number; label?: string; pinned: boolean; active: boolean }>; reopenableClosedTabs: number };
    assert(bridge.ok && read.tabs.length === 2 && read.tabs.some(tab => tab.pinned) && read.tabs.filter(tab => tab.active).length === 1, `Bridge reads the tabs: ${JSON.stringify(bridge)}`);
    // damaged storage gives no tabs, never an error
    await unmount();
    try { window.localStorage.setItem(tabsStorageKey(P), '{"tabs": [{"id": 3}, "x"'); } catch { /* ignore */ }
    await mount();
    assert(tabs().length === 0, 'Corrupt storage starts with no tabs');
    passed.push('The layout survives a remount (names, pinned, active tab), a restored hidden tab mounts only when shown, wh_workspace_tabs reads it, and corrupt storage starts clean');

    // ---- untouched new document -----------------------------------------------------------------------------------------
    await openBeside('w1');
    await click(`workspace-close-tab-${tabs()[0].id.replace('tab-', '')}`);
    assert(!document.querySelector('[data-testid="workspace-fresh-prompt"]'), 'A document with text closes without asking');
    await openBeside('w-new-keep');
    await click(`workspace-close-tab-${tabs()[0].id.replace('tab-', '')}`, 300);
    const prompt = node('workspace-fresh-prompt');
    assert(prompt.textContent?.includes('«Sin título» se acaba de crear') && document.body.textContent?.includes('¿Conservar o borrar este documento vacío?'), `Asks: ${prompt.textContent}`);
    assert(tabs().length === 1, 'The tab stays until the writer decides');
    await click('workspace-fresh-keep', 300);
    assert(tabs().length === 0 && await db.writings.get('w-new-keep'), 'Keep closes the tab and keeps the document');
    await openBeside('w-new-keep');
    await click(`workspace-close-tab-${tabs()[0].id.replace('tab-', '')}`, 300);
    assert(!document.querySelector('[data-testid="workspace-fresh-prompt"]') && tabs().length === 0, 'Once kept it is not asked again');
    await openBeside('w-new-del');
    await click(`workspace-close-tab-${tabs()[0].id.replace('tab-', '')}`, 300);
    assert(document.querySelector('[data-testid="workspace-fresh-prompt"]'), 'Asks for the second empty document');
    await click('workspace-fresh-delete', 500);
    assert(tabs().length === 0 && !(await db.writings.get('w-new-del')), 'Delete removes the empty document through the writings delete path');
    assert((await db.documentArchives.where('sourceId').equals('w-new-del').toArray()).length === 1, 'It went to the archive (not a raw delete)');
    const undoDelete = toastAction(); assert(undoDelete?.textContent === 'Deshacer', 'The toast offers Deshacer');
    await act(async () => { undoDelete.click(); await pause(400); });
    assert(await db.writings.get('w-new-del') && (await db.documentArchives.where('sourceId').equals('w-new-del').toArray()).length === 0, 'Deshacer brings the empty document back and consumes the archive');
    passed.push('Closing a tab with a brand-new empty document asks "¿Conservar o borrar este documento vacío?": a document with text does not ask; Conservar keeps it and is not asked again; Borrar archives it through the writings delete path and the toast\'s Deshacer restores it');
    await unmount();

    // ---- the toast undo: archive, stale archive, rename, stale rename ------------------------------------------------------
    await mount();
    const doc = workspaceDocument(P, 'codex', 'c-undo', 'Para deshacer');
    await act(async () => { await deleteLibraryDocuments([doc], P); await pause(200); });
    assert(!(await db.codexEntries.get('c-undo')), 'Archived');
    await waitFor(() => toastAction(), 'undo toast');
    assert(document.body.textContent?.includes('Enviado al archivo: Para deshacer'), 'Toast names the document');
    await act(async () => { toastAction().click(); await pause(400); });
    assert((await db.codexEntries.get('c-undo'))?.title === 'Para deshacer', 'Undo of an archive restores the card');
    // stale: the id is occupied by something else when the writer clicks Deshacer
    await act(async () => { await deleteLibraryDocuments([workspaceDocument(P, 'codex', 'c-del', 'Para borrar')], P); await pause(200); });
    await db.codexEntries.put(card('c-del', 'Otra cosa', 'Escrita después'));
    await waitFor(() => toastAction(), 'second undo toast');
    await act(async () => { toastAction().click(); await pause(400); });
    assert(document.body.textContent?.includes('No se pudo deshacer: cambió desde entonces'), `Stale undo refused: ${document.body.textContent?.slice(-200)}`);
    assert((await db.codexEntries.get('c-del'))?.title === 'Otra cosa', 'Nothing was forced over the newer card');
    // the workspace's own undo button shows the newest still-undoable operation
    await updateWorkspaceLibrary(P, 0, { kind: 'create-folder', id: 'f1', name: 'Personajes' });
    await act(async () => { await renameWorkspaceFolder(P, 1, { id: 'f1', name: 'Personajes' }, 'Elenco'); await pause(200); });
    assert(readWorkspaceLibrary((await db.projects.get(P))!).folders[0].name === 'Elenco', 'Renamed');
    assert(document.body.textContent?.includes('Carpeta renombrada: Personajes → Elenco'), 'Rename toast');
    assert(node('workspace-undo-last').textContent?.includes('Personajes → Elenco'), 'Undo-last button in the workspace');
    await act(async () => { toastAction().click(); await pause(400); });
    const afterUndo = readWorkspaceLibrary((await db.projects.get(P))!);
    assert(afterUndo.folders[0].name === 'Personajes' && afterUndo.revision === 3, `Rename undone: ${JSON.stringify(afterUndo.folders)} r${afterUndo.revision}`);
    // stale rename: another Library change lands before Deshacer
    await act(async () => { await renameWorkspaceFolder(P, 3, { id: 'f1', name: 'Personajes' }, 'Reparto'); await pause(200); });
    await updateWorkspaceLibrary(P, 4, { kind: 'create-folder', id: 'f2', name: 'Lugares' });
    await act(async () => { toastAction().click(); await pause(400); });
    const staleLibrary = readWorkspaceLibrary((await db.projects.get(P))!);
    assert(staleLibrary.folders.find(f => f.id === 'f1')?.name === 'Reparto' && document.body.textContent?.includes('No se pudo deshacer: cambió desde entonces'), 'A rename whose Library revision moved is refused and left as it is');
    passed.push('Toast Deshacer: an archived card comes back; if its id was taken meanwhile the undo says "No se pudo deshacer: cambió desde entonces" and forces nothing; a folder rename is undone from the toast and the workspace button, and refused once the Library revision has moved');
  } finally {
    await unmount();
    try { window.localStorage.removeItem(tabsStorageKey(P)); } catch { /* ignore */ }
    clearUndoJournal();
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
