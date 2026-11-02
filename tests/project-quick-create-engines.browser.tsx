import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Timeline } from '@/types';
import type { Board } from '@/engines/board/types';
import { quickCreateEngines, quickCreateProjectDocument } from '@/services/projectQuickCreate';
import { buildQuickCreateActions } from '@/services/commandCenter';
import { listEraRows } from '@/services/worldEras/store';
import { HOME_TOOLS } from '@/services/aiBridge/manifestHome';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { loadProjectCockpit } from '@/services/projectIntelligence';
import ProjectHomeTools from '@/components/project/ProjectHomeTools';
import GlobalSearch from '@/components/common/GlobalSearchBody';
import { activateEnginePane, EnginePaneContext, getActiveEnginePaneId, registerEnginePaneScope } from '@/engines/_shared/EnginePaneContext';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { t } from '@/i18n/useTranslation';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const wait = async (condition: () => boolean, label: string) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await act(pause); }
  throw Error('Timed out: ' + label);
};
const input = (box: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
function LocationProbe() { const location = useLocation(); return <output data-testid="quick-create-location">{location.pathname + location.search}</output>; }

export async function testProjectQuickCreateEngines(): Promise<string[]> {
  const P = 'quick-create-1882', E = 'quick-create-era', passed: string[] = [], locale = useLocaleStore.getState().locale, previousPane = getActiveEnginePaneId();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let generation = 0, stopPane: (() => void) | undefined;
  const project = { id: P, title: 'Quick create QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['writings', 'notes', 'outline', 'timeline', 'board'], engineOrder: [], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: E, name: 'Earlier', description: '', revision: 1, createdAt: 1, updatedAt: 1 }, { id: 'quick-create-other-era', name: 'Other', description: '', revision: 1, createdAt: 1, updatedAt: 1 }, { id: 'quick-create-archived', name: 'Archived', description: '', archived: true, revision: 1, createdAt: 1, updatedAt: 1 }] } as Project;
  const counts = async () => [await db.timelines.where('projectId').equals(P).count(), await db.boards.where('projectId').equals(P).count(), await db.worldEraVariants.where('projectId').equals(P).count()];
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project);
    assert(quickCreateEngines(project.enabledEngines).join(',') === 'writings,notes,outline,timeline,board', 'The original choices and both new engines are available in Base');
    assert(quickCreateEngines(project.enabledEngines, E).join(',') === 'writings,notes,timeline,board', 'Outline remains Base-only; timeline and board support eras');
    const schema = HOME_TOOLS.find(tool => tool.name === 'wh_project_quick_create')!.schema.properties.engineId as { enum: string[] };
    assert(schema.enum.join(',') === quickCreateEngines(project.enabledEngines).join(','), 'MCP advertises the same supported engines');
    assert(buildQuickCreateActions(project, '  Línea café  ', E).map(row => row.engineId).join(',') === 'writings,notes,timeline,board', 'Palette choices inherit scope and all supported engines');
    passed.push('Shared choices and MCP schema preserve old engines and add scoped timeline/board');

    const timeline = await quickCreateProjectDocument({ projectId: P }, 'timeline', '  Línea Ágora  '), second = await quickCreateProjectDocument({ projectId: P }, 'timeline', 'Second timeline'), board = await quickCreateProjectDocument({ projectId: P }, 'board', '  Tablero café  ');
    assert((await db.timelines.get(timeline.id))?.title === 'Línea Ágora' && (await db.timelines.get(timeline.id))?.color === '#c4973b', 'Timeline title and first normal color are persisted');
    assert((await db.timelines.get(second.id))?.color === '#3b82f6', 'Timeline colors follow the same count palette as the engine');
    assert((await db.boards.get(board.id))?.title === 'Tablero café' && (await db.boards.get(board.id))?.surface === 'cork', 'Board title and native cork surface are persisted');
    passed.push('Normal Base operations persist Unicode titles, timeline palette and cork boards');

    const baseCounts = await counts(), eraTimeline = await quickCreateProjectDocument({ projectId: P, eraId: E }, 'timeline', 'Era timeline'), eraBoard = await quickCreateProjectDocument({ projectId: P, eraId: E }, 'board', 'Era board');
    assert(!await db.timelines.get(eraTimeline.id) && !await db.boards.get(eraBoard.id), 'Era creations never fall back to Base');
    assert((await listEraRows<Timeline>({ projectId: P, eraId: E }, 'timelines')).find(row => row.id === eraTimeline.id)?.color === '#ef4444', 'Era palette counts inherited effective timelines');
    assert((await listEraRows<Board>({ projectId: P, eraId: E }, 'boards')).find(row => row.id === eraBoard.id)?.surface === 'cork', 'Era board has native defaults');
    assert(!(await listEraRows<Board>({ projectId: P, eraId: 'quick-create-other-era' }, 'boards')).some(row => row.id === eraBoard.id), 'Another era does not see the new board');
    assert((await counts()).slice(0, 2).join(',') === baseCounts.slice(0, 2).join(','), 'Era writes preserve both Base tables');
    passed.push('Timeline/board eras use effective data and preserve Base and sibling era');

    const rejectedBefore = await counts();
    for (const engineId of ['timeline', 'board'] as const) {
      for (const eraId of ['missing-era', 'quick-create-archived']) {
        let refused = false; try { await quickCreateProjectDocument({ projectId: P, eraId }, engineId, 'Reject'); } catch { refused = true; }
        assert(refused, 'Missing or archived era rejected for ' + engineId);
      }
      let empty = false; try { await quickCreateProjectDocument({ projectId: P }, engineId, '   '); } catch { empty = true; }
      assert(empty, 'Empty title rejected for ' + engineId);
    }
    await db.projects.update(P, { enabledEngines: ['writings', 'notes', 'outline'] });
    for (const engineId of ['timeline', 'board']) {
      const denied = await runBridgeTool('wh_project_quick_create', { projectId: P, engineId, text: 'Disabled' }); assert(!denied.ok, 'Disabled engine rejected through the shared dispatcher');
    }
    assert((await counts()).join(',') === rejectedBefore.join(','), 'Rejected requests create no Base or era rows');
    await db.projects.update(P, { enabledEngines: project.enabledEngines });
    passed.push('Invalid/archived scopes, empty titles and disabled engines reject without hidden writes');

    for (const engineId of ['timeline', 'board'] as const) for (const eraId of [undefined, E]) {
      const result = await runBridgeTool('wh_project_quick_create', { projectId: P, engineId, eraId, text: 'MCP ' + engineId }); assert(result.ok, JSON.stringify(result));
      const created = result.result as { id: string; __audit: Record<string, unknown> }, table = engineId === 'timeline' ? 'timelines' : 'boards';
      assert(created.__audit.table === table && created.__audit.entityId === created.id, 'Audit uses the real plural table and new ID');
      const rows = await listEraRows<{ id: string }>({ projectId: P, eraId }, table); assert(rows.some(row => row.id === created.id), 'Dispatcher creation is editable in the effective scope');
      await undoAuditEntry({ entry: { ...created.__audit, kind: 'create', tool: 'wh_project_quick_create', eraId } });
      assert(!(await listEraRows<{ id: string }>({ projectId: P, eraId }, table)).some(row => row.id === created.id), 'Generic create Undo removes only the matching scoped document');
    }
    assert(await db.timelines.get(timeline.id) && await db.boards.get(board.id), 'Create Undo preserves older siblings');
    passed.push('Actual dispatcher and generic audit Undo use timelines/boards in Base and era');

    for (const engineId of ['timeline', 'board'] as const) {
      const cockpit = await loadProjectCockpit(P);
      await act(async () => { root.render(<MemoryRouter key={++generation} initialEntries={[`/project/${P}/overview`]}><ProjectHomeTools projectId={P} data={cockpit} onReview={() => {}} onContinue={() => {}} /><LocationProbe /></MemoryRouter>); });
      await wait(() => !![...host.querySelectorAll<HTMLButtonElement>('[aria-label="Create"] button')].find(button => button.textContent?.includes(t(`engines.${engineId}.name`))), 'Home engine choice ' + engineId);
      const chip = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Create"] button')].find(button => button.textContent?.includes(t(`engines.${engineId}.name`)))!;
      await act(async () => { chip.click(); }); const title = 'Home ' + engineId + ' Ágora';
      await act(async () => { input(host.querySelector<HTMLInputElement>('#home-quick-create')!, title); });
      await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await wait(() => !host.querySelector('#home-quick-create'), 'Home creation completed');
      const table = engineId === 'timeline' ? db.timelines : db.boards, created = (await table.where('projectId').equals(P).toArray()).find(row => row.title === title); assert(created, 'Home persisted the entered title');
      const location = host.querySelector('[data-testid="quick-create-location"]')!.textContent!;
      assert(location.includes(`/project/${P}/${engineId}?`) && location.includes(encodeURIComponent(created.id)), 'Home navigates to the exact created document, not merely its engine');
    }
    passed.push('Real Home controls create both types and navigate with actual entity adapters');

    for (const engineId of ['timeline', 'board'] as const) {
      stopPane?.(); const paths: string[] = [], pane = 'quick-create-pane-' + engineId;
      stopPane = registerEnginePaneScope(pane, { projectId: P, eraId: E, navigate: path => paths.push(path) }); activateEnginePane(pane);
      await act(async () => { root.render(<MemoryRouter key={++generation} initialEntries={[`/project/${P}/overview`]}><Routes><Route path="/project/:id/*" element={<GlobalSearch />} /></Routes></MemoryRouter>); useAppStore.setState({ searchOpen: true }); });
      await wait(() => !!host.querySelector('[role="combobox"]'), 'Palette'); const box = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
      const creationOptions = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')].filter(row => row.textContent?.includes(t('home.createQuery')));
      for (const query of ['engine:notes Título café', 'Título café -borrador', '"Título café"', 'Título café tag:magia']) {
        await act(async () => { input(box, query); await pause(); }); assert(creationOptions().length === 0, 'Filtered/excluded/quoted query never offers quick creation');
      }
      const title = 'Palette ' + engineId + ' café'; await act(async () => { input(box, title); }); await wait(() => creationOptions().length === 4, 'Four era creation choices');
      assert(!creationOptions().some(option => option.textContent?.includes(t('engines.outline.name'))), 'Era palette still omits outline');
      const choice = creationOptions().find(option => option.textContent?.includes(t(`engines.${engineId}.name`)))!; assert(choice, 'Palette offers ' + engineId);
      await act(async () => { choice.click(); }); await wait(() => !useAppStore.getState().searchOpen, 'Palette created and closed');
      const table = engineId === 'timeline' ? 'timelines' : 'boards', row = (await listEraRows<{ id: string; title: string }>({ projectId: P, eraId: E }, table)).find(row => row.title === title); assert(row, 'Palette persisted the exact title in its era');
      assert(!await db.table(table).get(row.id) && paths.some(path => path.includes(encodeURIComponent(row.id))), 'Palette stays in era storage and navigates to its new ID through the active pane');
    }
    passed.push('Real palette preserves filter suppression and creates scoped timeline/board with exact navigation');
  } finally {
    stopPane?.(); if (previousPane) activateEnginePane(previousPane);
    await act(async () => { root.unmount(); useAppStore.setState({ searchOpen: false }); }); host.remove();
    await deleteProject(P); useLocaleStore.setState({ locale });
  }
  return passed;
}

/** Direct Home scope test: a palette-only era test cannot establish this contract. */
export async function testProjectQuickCreateHomeEra(): Promise<string[]> {
  const P = 'quick-create-home-era-1882', E = 'home-era', other = 'home-era-other', passed: string[] = [], locale = useLocaleStore.getState().locale;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const project = { id: P, title: 'Home era QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['writings', 'notes', 'outline', 'timeline', 'board'], engineOrder: [], createdAt: 1, updatedAt: 1,
    worldEras: [E, other].map(id => ({ id, name: id, description: '', revision: 1, createdAt: 1, updatedAt: 1 })) } as Project;
  let renderKey = 0;
  const renderHome = async (eraId?: string, navigate?: (path: string) => void, remount = true) => {
    if (remount) renderKey++;
    const cockpit = await loadProjectCockpit(P);
    await act(async () => { root.render(<MemoryRouter key={renderKey} initialEntries={[`/project/${P}/overview`]}><EnginePaneContext.Provider value={{ instanceId: 'home-era-pane', projectId: P, eraId, visible: true, navigate }}><ProjectHomeTools projectId={P} data={cockpit} onReview={() => {}} onContinue={() => {}} /><LocationProbe /></EnginePaneContext.Provider></MemoryRouter>); });
    await wait(() => host.querySelectorAll('[aria-label="Create"] button').length > 0, 'Home choices loaded');
  };
  const choose = async (engineId: 'timeline' | 'board', title: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Create"] button')].find(button => button.textContent?.includes(t(`engines.${engineId}.name`)))!;
    assert(button, 'Home offers ' + engineId); await act(async () => { button.click(); });
    await act(async () => { input(host.querySelector<HTMLInputElement>('#home-quick-create')!, title); });
  };
  const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project);
    await quickCreateProjectDocument({ projectId: P }, 'writings', 'Seed writing for next-action scope');
    for (const engineId of ['timeline', 'board'] as const) {
      const paths: string[] = []; await renderHome(E, path => paths.push(path));
      const choices = [...host.querySelectorAll<HTMLElement>('[aria-label="Create"] button')];
      assert(choices.length === 4 && !choices.some(button => button.textContent?.includes(t('engines.outline.name'))), 'Home in an era omits the Base-only Outline choice');
      assert(![...host.querySelectorAll('button')].some(button => button.textContent === t('home.move.outline')), 'The suggested next action also omits Base-only outlines in an era');
      const title = 'Home scoped ' + engineId; await choose(engineId, title); await submit(); await wait(() => !host.querySelector('#home-quick-create'), 'Scoped Home creation');
      const table = engineId === 'timeline' ? 'timelines' : 'boards', row = (await listEraRows<{ id: string; title: string }>({ projectId: P, eraId: E }, table)).find(row => row.title === title); assert(row, 'Home creates ' + engineId + ' in the actual pane era');
      assert(!await db.table(table).get(row.id), 'Home era creation never writes Base');
      assert(!(await listEraRows<{ id: string }>({ projectId: P, eraId: other }, table)).some(value => value.id === row.id), 'Home preserves the sibling era');
      assert(paths.length === 1 && paths[0].includes(encodeURIComponent(row.id)), 'Home uses the pane navigator for the exact new document');
      assert(host.querySelector('[data-testid="quick-create-location"]')?.textContent === `/project/${P}/overview`, 'Pane navigation does not retarget the global router');
    }
    passed.push('Direct Home era provider omits Outline and creates timeline/board only in its own era/pane');

    await renderHome(E); await choose('timeline', 'Home era router fallback'); await submit(); await wait(() => !host.querySelector('#home-quick-create'), 'Home fallback navigation');
    const location = host.querySelector('[data-testid="quick-create-location"]')!.textContent!;
    assert(location.includes('/timeline?') && new URLSearchParams(location.split('?')[1]).get('era') === E, 'Without pane.navigate the router fallback keeps the explicit era');
    passed.push('Home router fallback keeps era query and entity navigation');

    const beforePaths: string[] = [], afterPaths: string[] = []; await renderHome(E, path => beforePaths.push(path)); await choose('board', 'Changed Home era');
    await renderHome(other, path => afterPaths.push(path), false); await submit(); await wait(() => !host.querySelector('#home-quick-create'), 'Home after scope change');
    const changed = (await listEraRows<{ id: string; title: string }>({ projectId: P, eraId: other }, 'boards')).find(row => row.title === 'Changed Home era');
    assert(changed && !await db.boards.get(changed.id), 'An explicit submit after scope change uses the current era');
    assert(!beforePaths.length && afterPaths.length === 1 && afterPaths[0].includes(changed.id), 'Scope change uses the current pane navigator');
    passed.push('Home scope change after selection uses current scope and current pane');

    const oldPaths: string[] = [], newPaths: string[] = []; await renderHome(undefined, path => oldPaths.push(path)); await choose('timeline', 'Pending original Home');
    const originalAdd = db.timelines.add, add = originalAdd.bind(db.timelines); let entered = false, persisted = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    db.timelines.add = async (...args: Parameters<typeof add>) => { entered = true; await gate; const id = await add(...args); persisted = true; return id; };
    try {
      await submit(); await wait(() => entered, 'Original Home creation waiting at the actual DB operation');
      await renderHome(E, path => newPaths.push(path), false); release();
      await wait(() => persisted && !host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, 'Old Home creation finished');
      const pendingRow = (await db.timelines.where('projectId').equals(P).toArray()).find(row => row.title === 'Pending original Home');
      assert(pendingRow, 'Pending intent completes only in its captured original Base scope');
      assert(!await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P, E, 'timeline', pendingRow.id]).first(), 'The old request creates no era variant');
      assert(oldPaths.length === 0 && newPaths.length === 0, 'A finished old-context request cannot navigate the retired or current pane');
      assert(host.querySelector('[data-testid="quick-create-location"]')?.textContent === `/project/${P}/overview`, 'Retargeting during creation does not change the global route');
    } finally { release(); db.timelines.add = originalAdd; }
    passed.push('A pending Home request keeps its captured write scope and does not navigate after retargeting');
  } finally {
    await act(async () => root.unmount()); host.remove(); await deleteProject(P); useLocaleStore.setState({ locale });
  }
  return passed;
}
