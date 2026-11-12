import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { workspaceRoute } from '@/components/project/workspace/routes';
import { saveTabsState, tabsStorageKey } from '@/components/project/workspace/workspaceTabs';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import '@/engines';
import { createSourceToolDocument } from '@/engines/local/documents/store';
import { registerLocalToolModules } from '@/engines/local/registry';
import { defineLocalTool, type LocalToolProps } from '@/engines/local/sdk';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import ProjectDetail from '@/pages/ProjectDetail';
import { useLocaleStore } from '@/stores/localeStore';

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

async function until(test: () => boolean, message: string) {
  for (let tries = 0; tries < 140; tries++) {
    if (test()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
  }
  throw Error(message);
}

async function click(node: HTMLElement) {
  await act(async () => { node.click(); });
}

async function text(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const sourceNamespace = 'tests.table-fullscreen-source';
const sourceEngine = `local-tool-${sourceNamespace}`;
let sourceRegistered = false;
type SourceState = { notes: string };

function SourceProbe({ context }: LocalToolProps<SourceState>) {
  return <button type="button" onClick={event => context?.contextMenu?.open(event,
    [{ kind: 'item', id: 'keep', label: 'Keep note', onSelect: () => {} }], { label: 'Source actions' })}>Source actions</button>;
}

export async function mountTableFullscreenFixture(withSource = false) {
  const projectId = 'qa-table-fullscreen-' + crypto.randomUUID(), companionId = 'companion:' + crypto.randomUUID(), eraId = 'past';
  const tableId = 'holdings', companionTableId = 'ledger';
  const rootRoute = '/project/' + projectId + '/tables?entity=' + tableId;
  const markerId = 'set_storage.persistRequestedAt', markerBefore = await db.settings.get(markerId);
  const columns = [
    { id: 'hold', name: 'Hold', kind: 'text' as const },
    { id: 'souls', name: 'Souls', kind: 'number' as const },
    { id: 'sworn', name: 'Sworn to', kind: 'text' as const },
  ];
  const rows = [
    ['Greyvale', '2450', 'House Marrow'],
    ['Rillford', '8100', 'The Ferrymen'],
    ['Stonewatch', '1750', 'House Marrow'],
  ].map(([hold, souls, sworn], index) => ({ id: 'row-' + index, cells: { hold, souls, sworn } }));
  await db.projects.add({
    id: projectId, title: 'QA table fullscreen', description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: withSource ? ['tables', 'codex', sourceEngine] : ['tables', 'codex'], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: eraId, name: 'Past', description: '', revision: 1, createdAt: 1, updatedAt: 1 }],
    dataTables: [
      withSource ? { id: tableId, title: 'Holdings', mode: 'table', codexType: 'character',
        columns: [{ id: 'souls', name: 'Souls', kind: 'number', field: 'souls' }], rows: [] }
        : { id: tableId, title: 'Holdings', mode: 'table', columns, rows },
      { id: companionTableId, title: 'Ledger', mode: 'table', columns, rows },
    ],
  });
  let companionRoute = '/project/' + projectId + '/tables?entity=' + companionTableId + '&era=' + eraId;
  if (withSource) {
    if (!sourceRegistered) {
      const definition = defineLocalTool<SourceState>({ namespace: sourceNamespace,
        name: { en: 'Source probe', es: 'Prueba Source' }, description: { en: 'Synthetic fixture', es: 'Prueba sintética' },
        document: { defaultTitle: { en: 'Source probe', es: 'Prueba Source' } },
        codec: { version: 1, fields: { notes: { kind: 'prose' } } }, initialState: { notes: '' },
        validateState: (value): value is SourceState => !!value && typeof value === 'object' &&
          !Array.isArray(value) && typeof value.notes === 'string', component: SourceProbe });
      registerLocalToolModules({ [`./installed/${sourceNamespace}/module.tsx`]: { default: definition } });
      sourceRegistered = true;
    }
    const source = await createSourceToolDocument({ projectId }, sourceNamespace, 'Source probe');
    companionRoute = `/project/${projectId}/${sourceEngine}?document=${source.id}`;
    await db.codexEntries.add({ id: `${projectId}-character`, projectId, type: 'character', title: 'Iria',
      fields: { souls: '2450' }, tags: [], relations: [], content: '', createdAt: 1, updatedAt: 1 });
  }
  const companion = { id: companionId, engineId: withSource ? sourceEngine : 'tables', history: [workspaceRoute(companionRoute)], index: 0 };
  const spare = { id: 'companion:' + crypto.randomUUID(), engineId: 'tables', history: [workspaceRoute(rootRoute)], index: 0 };
  saveTabsState(projectId, {
    tabs: withSource ? [companion] : [companion, spare],
    activeId: companionId, closed: [],
  });
  const container = document.createElement('div');
  container.style.height = '100vh';
  document.body.append(container);
  const root = createRoot(container);
  useLocaleStore.setState({ locale: 'en', loaded: true });
  const pane = (side: 'primary' | 'secondary') => {
    const element = container.querySelector<HTMLElement>('[data-testid="workspace-' + side + '"]');
    check(element, 'Workspace pane missing: ' + side);
    return element;
  };
  const grid = (side: 'primary' | 'secondary') => {
    const element = pane(side).querySelector<HTMLElement>('[role="grid"]');
    check(element, 'Grid missing: ' + side);
    return element;
  };
  const toggle = (side: 'primary' | 'secondary') => {
    const element = pane(side).querySelector<HTMLButtonElement>('[data-table-fullscreen-toggle]');
    check(element, 'Fullscreen action missing: ' + side);
    return element;
  };
  async function cleanup() {
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    if (await db.projects.get(projectId)) await deleteProject(projectId);
    localStorage.removeItem(tabsStorageKey(projectId));
    if (!markerBefore) {
      const marker = await db.settings.get(markerId);
      if (marker?.key === 'storage.persistRequestedAt' && /^\d{13}$/.test(marker.value)) await db.settings.delete(markerId);
    }
  }
  try {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[rootRoute]}><Routes>
        <Route element={<MainLayout />}>
          <Route path="/project/:id/:tab" element={<ProjectDetail />} />
        </Route>
      </Routes></MemoryRouter>);
    });
    await until(() => withSource
      ? !!container.querySelector('input[aria-label="A1 Souls"]') && !!container.querySelector('[data-source-document-host]')
      : !!container.querySelector('[role="grid"][aria-label="Holdings"]') && !!container.querySelector('[role="grid"][aria-label="Ledger"]'),
    'Real table and companion did not mount');
    return { projectId, tableId, companionTableId, eraId, container, pane, grid, toggle, cleanup };
  } catch (error) {
    const rendered = container.innerText.slice(0, 800);
    await cleanup();
    throw new Error(`${String(error)}\n${rendered}`, { cause: error });
  }
}

export async function testTableFullscreen(): Promise<string[]> {
  const fixture = await mountTableFullscreenFixture();
  const checks: string[] = [], { projectId, tableId, companionTableId, eraId, container, pane, grid, toggle } = fixture;
  const expect = (value: unknown, label: string) => { check(value, label); checks.push(label); };
  async function bridge<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await runBridgeTool(name, { projectId, ...args });
    check(result.ok, name + ' failed: ' + JSON.stringify(result));
    return result.result as T;
  }
  type Target = { hostId: string; documentId: string; namespace: string; eraId?: string; active: boolean };
  const get = () => bridge<{ targets: Target[] }>('wh_workspace_focus_get', { namespace: 'tables' });
  const set = (hostId: string, active: boolean) =>
    bridge<{ active: boolean; available: boolean }>('wh_workspace_focus_set', { namespace: 'tables', hostId, active });
  const sameNodes = (a: HTMLElement, b: HTMLElement) => grid('primary') === a && grid('secondary') === b;
  try {
    const main = pane('primary'), aside = pane('secondary'), originalMain = grid('primary'), originalAside = grid('secondary');
    const group = [...main.querySelectorAll<HTMLSelectElement>('select')].find(select =>
      [...select.options].some(option => option.value === 'sworn'));
    check(group, 'Group control missing');
    await act(async () => {
      group.value = 'sworn';
      group.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(() => /House Marrow\s*2 rows/.test(main.textContent ?? ''), 'Grouped table did not render two matching rows');
    const search = main.querySelector<HTMLInputElement>('input[aria-label="Filter rows"]');
    check(search, 'Filter field missing');
    await text(search, 'Greyvale');
    await until(() => grid('primary').querySelectorAll('tbody tr[data-row-id]').length === 1, 'Filter did not isolate Greyvale');
    const box = main.querySelector<HTMLInputElement>('input[aria-label^="Select row "]');
    check(box, 'Visible row checkbox missing');
    await click(box);
    expect(box.checked, 'One filtered row is selected');

    const addColumn = [...main.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'New column');
    check(addColumn, 'New column action missing');
    await click(addColumn);
    const draft = [...main.querySelectorAll<HTMLInputElement>('input')].find(input =>
      [...(input.labels ?? [])].some(label => label.textContent?.trim() === 'Column name'));
    check(draft, 'Column draft field missing');
    await text(draft, 'Unsaved field');
    const before = JSON.stringify(await db.projects.get(projectId));
    const targets = (await get()).targets;
    const base = targets.find(target => target.documentId === tableId);
    const companion = targets.find(target => target.documentId === companionTableId);
    check(base && companion, 'Both visible tables must expose focus targets');
    expect(!base.eraId && companion.eraId === eraId, 'MCP identifies each table and the companion era');
    const button = toggle('primary'), width = main.getBoundingClientRect().width;
    await click(button);
    await until(() => button.textContent === 'Exit full screen' && aside.hidden, 'Primary table did not expand');
    expect(main.getBoundingClientRect().width >= width && getComputedStyle(aside).display === 'none' && aside.inert,
      'The other pane is hidden and inert while the table gets the workspace width');
    expect(sameNodes(originalMain, originalAside) && aside.isConnected, 'Both mounted grids retain their DOM nodes');
    expect(draft.isConnected && draft.value === 'Unsaved field' && box.checked && search.value === 'Greyvale' && group.value === 'sworn',
      'Fullscreen preserves the column draft, selected row, search and group');
    expect([...container.querySelectorAll<HTMLElement>('[data-workspace-chrome]')].every(chrome => chrome.hidden && chrome.inert),
      'Normal workspace chrome is hidden and inert');
    expect((await get()).targets.length === 1 && (await get()).targets[0].active, 'MCP reports only the expanded visible table');
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await until(() => !aside.hidden && button.textContent === 'Full screen', 'Escape did not restore the workspace');
    expect(sameNodes(originalMain, originalAside) && draft.value === 'Unsaved field', 'Escape restores both panes and retains the draft');

    await act(async () => {
      const state = await set(companion.hostId, true);
      check(state.available && state.active, 'MCP could not expand the companion');
    });
    await until(() => main.hidden && toggle('secondary').textContent === 'Exit full screen', 'Companion did not expand');
    expect(main.inert && sameNodes(originalMain, originalAside), 'MCP expands the companion and keeps the primary mounted');
    expect((await set(base.hostId, false)).available === false && main.hidden, 'A hidden target cannot leave another table’s fullscreen');
    await click(toggle('secondary'));
    await until(() => !main.hidden && !aside.hidden, 'The companion button did not restore both panes');
    expect(JSON.stringify(await db.projects.get(projectId)) === before, 'Fullscreen changes no project data');

    await click(toggle('secondary'));
    await until(() => main.hidden && toggle('secondary').textContent === 'Exit full screen', 'Could not reopen the companion fullscreen');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await until(() => !main.hidden && !container.querySelector('[data-workspace-focus="true"]') &&
      !!aside.querySelector('[role="tabpanel"]:not([hidden]) [role="grid"][aria-label="Holdings"]'),
    'Switching companion tabs left fullscreen bound to the hidden tab');
    expect(originalAside.isConnected && !(await set(companion.hostId, true)).available,
      'Changing the active companion exits fullscreen and retains the previous grid');

    await fixture.cleanup();
    expect((await get()).targets.length === 0 && !(await set(base.hostId, true)).available, 'Closing the workspace revokes both targets');
    checks.push(...await testTableFullscreenWithSource());
    return checks;
  } finally {
    if (container.isConnected) await fixture.cleanup();
  }
}

async function testTableFullscreenWithSource(): Promise<string[]> {
  const { projectId, container, pane, toggle, cleanup } = await mountTableFullscreenFixture(true);
  try {
    const aside = pane('secondary'), source = aside.querySelector('[data-source-document-host]');
    const actions = [...aside.querySelectorAll('button')].find(button => button.textContent === 'Source actions');
    check(source && actions, 'Source menu trigger missing');
    await click(actions);
    const menu = '[data-local-tool-context-menu]';
    await until(() => !!document.querySelector(menu), 'Source did not open its portaled menu');
    const scope = { projectId, namespace: 'tables' };
    const result = await runBridgeTool('wh_workspace_focus_get', scope);
    check(result.ok, 'Live table target lookup failed');
    const target = (result.result as { targets: { hostId: string }[] }).targets[0];
    check(target, 'Live table focus target missing');
    await act(async () => {
      const reply = await runBridgeTool('wh_workspace_focus_set', { ...scope, hostId: target.hostId, active: true });
      check(reply.ok, 'Live table focus request failed');
    });
    await until(() => aside.hidden && !document.querySelector(menu), 'Hidden Source kept its portaled menu');
    check(aside.contains(source), 'Source editor unmounted while obscured');

    const cell = container.querySelector<HTMLInputElement>('input[aria-label="A1 Souls"]');
    check(cell?.value === '2450', 'Live Codex numeric cell missing');
    const button = toggle('primary');
    cell.focus();
    await text(cell, '3000');
    await act(async () => { cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    check(String(cell.value) === '2450' && aside.hidden && button.textContent === 'Exit full screen',
      'First Escape must cancel the live cell without leaving fullscreen');
    await act(async () => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await until(() => !aside.hidden, 'Second Escape did not restore Source');
    check(aside.contains(source) && !document.querySelector(menu), 'Restoring Source reopened its old menu');
    return ['A Source menu closes when MCP expands the other pane, and its editor stays mounted',
      'Escape cancels a live numeric cell before it restores the workspace'];
  } finally { await cleanup(); }
}
