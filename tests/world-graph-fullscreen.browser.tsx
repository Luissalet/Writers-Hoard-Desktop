import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { workspaceRoute } from '@/components/project/workspace/routes';
import { saveTabsState, tabsStorageKey } from '@/components/project/workspace/workspaceTabs';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import '@/engines';
import ProjectDetail from '@/pages/ProjectDetail';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry } from '@/types';

function check(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}

async function until(test: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (test()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  }
  throw Error(label);
}

async function click(node: HTMLElement) {
  await act(async () => node.click());
}

async function escape(node: HTMLElement) {
  await act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
}

async function settledCamera(canvas: HTMLElement) {
  const viewport = canvas.querySelector<HTMLElement>('.react-flow__viewport');
  check(viewport, 'Graph camera missing');
  let previous = '', stableSamples = 0;
  await until(() => {
    const transform = viewport.style.transform;
    stableSamples = transform && transform === previous ? stableSamples + 1 : 0;
    previous = transform;
    return stableSamples >= 3;
  }, 'Graph camera did not settle');
  return viewport;
}

export async function mountWorldGraphFullscreenFixture() {
  const projectId = 'qa-graph-fullscreen-' + crypto.randomUUID(), eraId = 'past';
  const companionId = 'companion:' + crypto.randomUUID();
  const route = '/project/' + projectId + '/codex';
  const markerId = 'set_storage.persistRequestedAt', markerBefore = await db.settings.get(markerId);
  const entry = (suffix: string, title: string, type: CodexEntry['type'], content = ''): CodexEntry => ({
    id: projectId + '-' + suffix, projectId, title, type, fields: {}, content, tags: [], relations: [], createdAt: 1, updatedAt: 1,
  });
  const place = entry('place', 'Salt harbour', 'location');
  const person = entry('person', 'Iria Mar', 'character', '<p>Lives in Salt harbour.</p>');
  const item = entry('item', 'Gilded flag', 'item', '<p>Carried by Iria Mar.</p>');
  await db.projects.add({
    id: projectId, title: 'QA graph fullscreen', description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: eraId, name: 'Past', description: '', revision: 1, createdAt: 1, updatedAt: 1 }],
    codexGraphLayout: { positions: { [person.id]: { x: 120, y: 60 } },
      display: { names: 'all', nodeSize: 'medium', linkOpacity: 1, pictures: true, spacing: 1.5 } },
  });
  await db.codexEntries.bulkAdd([place, person, item]);
  saveTabsState(projectId, {
    tabs: [{ id: companionId, engineId: 'codex', history: [workspaceRoute(route + '?era=' + eraId)], index: 0 }],
    activeId: companionId, closed: [],
  });
  const container = document.createElement('div');
  container.style.height = '100vh';
  document.body.append(container);
  const root = createRoot(container);
  useLocaleStore.setState({ locale: 'en', loaded: true });

  const find = <T extends HTMLElement>(root: ParentNode, selector: string) => {
    const node = root.querySelector<T>(selector);
    check(node, 'Missing ' + selector);
    return node;
  };
  const pane = (side: 'primary' | 'secondary') => find(container, '[data-testid="workspace-' + side + '"]');
  const canvas = (side: 'primary' | 'secondary') => find(pane(side), '[data-testid="world-graph-canvas"]');
  const toggle = (side: 'primary' | 'secondary') => find<HTMLButtonElement>(pane(side), '[data-world-graph-fullscreen-toggle]');
  const projectBytes = async () => JSON.stringify(await db.projects.get(projectId));
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
    await act(async () => root.render(<MemoryRouter initialEntries={[route]}><Routes>
      <Route element={<MainLayout />}><Route path="/project/:id/:tab" element={<ProjectDetail />} /></Route>
    </Routes></MemoryRouter>));
    await until(() => container.querySelectorAll('[data-testid="codex-show-graph"]').length === 2, 'Both Codex panes did not mount');
    await click(find(pane('primary'), '[data-testid="codex-show-graph"]'));
    await click(find(pane('secondary'), '[data-testid="codex-show-graph"]'));
    await until(() => container.querySelectorAll('[data-world-graph-fullscreen-toggle]').length === 2 &&
      container.querySelectorAll('[data-testid="world-graph-canvas"] [data-name-shown]').length === 6,
    'Both real graph workspaces did not mount');
    await settledCamera(canvas('primary'));
    await settledCamera(canvas('secondary'));
    return { projectId, eraId, personId: person.id, container, pane, canvas, toggle, projectBytes, cleanup, find };
  } catch (error) {
    const detail = [...container.querySelectorAll<HTMLElement>('[data-testid="workspace-primary"], [data-testid="workspace-secondary"]')].map(element => ({
      controls: element.querySelectorAll('[data-world-graph-fullscreen-toggle]').length,
      nodes: element.querySelectorAll('[data-testid="world-graph-canvas"] [data-name-shown]').length,
      text: element.innerText.slice(-500),
    }));
    await cleanup();
    throw new Error(`${String(error)}\n${JSON.stringify(detail)}`, { cause: error });
  }
}

export async function testWorldGraphFullscreen(): Promise<string[]> {
  const { projectId, eraId, personId, container, pane, canvas, toggle, projectBytes, cleanup, find } = await mountWorldGraphFullscreenFixture();
  const checks: string[] = [];
  const expect = (value: unknown, label: string) => { check(value, label); checks.push(label); };
  type Target = { hostId: string; namespace: string; eraId?: string; documentId?: string; active: boolean };
  async function bridge<T>(name: string, args: Record<string, unknown> = {}) {
    const result = await runBridgeTool(name, { projectId, namespace: 'world-graph', ...args });
    check(result.ok, name + ': ' + JSON.stringify(result));
    return result.result as T;
  }
  const get = () => bridge<{ targets: Target[] }>('wh_workspace_focus_get');
  const set = (hostId: string, active: boolean) => bridge<{ available: boolean; active: boolean }>('wh_workspace_focus_set', { hostId, active });
  try {
    const primary = pane('primary'), aside = pane('secondary');
    const beforeMain = canvas('primary'), beforeAside = canvas('secondary');
    const width = beforeMain.getBoundingClientRect().width;
    const primaryButton = toggle('primary');
    await click(find(primary, '[data-testid="world-graph-category-item"]'));
    await until(() => beforeMain.querySelectorAll('[data-name-shown]').length === 2, 'Item filter did not apply');
    await click(find(primary, '[data-testid="world-graph-node-' + personId + '"]'));
    await click(find(primary, '[data-testid="world-graph-settings"]'));
    const spacing = find<HTMLInputElement>(primary, '[data-testid="world-graph-spacing"]');
    const viewport = await settledCamera(beforeMain);
    const transform = viewport.style.transform;
    const before = await projectBytes();
    const targets = (await get()).targets;
    const base = targets.find(target => !target.eraId), past = targets.find(target => target.eraId === eraId);
    expect(!!base && !!past && targets.length === 2 && targets.every(target => !target.documentId),
      'Mounted world graphs are scoped by project and era without a document ID');
    check(base && past, 'Focus targets missing');
    await click(primaryButton);
    await until(() => aside.hidden && primaryButton.textContent === 'Exit full screen', 'The graph did not expand');
    expect(aside.inert && canvas('primary') === beforeMain && canvas('secondary') === beforeAside &&
      beforeMain.getBoundingClientRect().width >= width && viewport.style.transform === transform,
    'Expansion keeps both canvases and the current camera while hiding the other pane');
    expect(find(primary, '[data-testid="world-graph-inspector"]').textContent?.includes('Iria Mar') &&
      beforeMain.querySelectorAll('[data-name-shown]').length === 2,
    'The selected card and filtered nodes survive expansion');
    const controls = [...primary.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Graph controls');
    check(controls, 'The fullscreen controls button is missing');
    await click(controls);
    const controlsId = controls.getAttribute('aria-controls')!;
    const settings = document.getElementById(controlsId);
    check(settings && !settings.hidden && settings.contains(spacing), 'Existing settings were not available in fullscreen');
    expect(spacing.value === '1.5' && controls.getAttribute('aria-expanded') === 'true',
      'Fullscreen controls keep the same spacing field and settings state');
    await escape(spacing);
    expect(settings.hidden && controls.getAttribute('aria-expanded') === 'false' && aside.hidden,
      'First Escape closes the graph controls while keeping fullscreen');
    await escape(primaryButton);
    await until(() => !aside.hidden && primaryButton.textContent === 'Full screen', 'Second Escape did not restore the workspace');
    check(!settings.hidden && spacing.value === '1.5', 'The original graph controls did not restore');
    check(viewport.style.transform === transform, 'Restored camera moved from ' + transform + ' to ' + viewport.style.transform);
    checks.push('Second Escape restores the original controls, camera and layout');

    await act(async () => { check((await set(past.hostId, true)).active, 'MCP could not expand the companion graph'); });
    await until(() => primary.hidden && toggle('secondary').textContent === 'Exit full screen', 'Companion graph did not expand');
    expect(primary.inert && (await get()).targets.length === 1 && !(await set(base.hostId, false)).available,
      'MCP expands the companion era and rejects operations on the obscured graph');
    await click(toggle('secondary'));
    await until(() => !primary.hidden && !aside.hidden, 'Companion exit button did not restore both panes');
    expect((await projectBytes()) === before && canvas('primary') === beforeMain && canvas('secondary') === beforeAside,
      'Focus and restoration keep both canvases and write no project data');
    await click(find(primary, '[data-testid="codex-show-cards"]'));
    await until(() => !primary.querySelector('[data-world-graph-fullscreen-toggle]'), 'The graph did not close');
    expect((await get()).targets.length === 1 && !(await set(base.hostId, true)).available,
      'Changing to cards revokes the graph target');
    return checks;
  } finally { await cleanup(); }
}
