import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { paneEngineId, workspaceRoute } from '@/components/project/workspace/routes';
import { EnginePaneContext, ownsEnginePaneEvent, paneReferenceScope, useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { registerPendingFlusher } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import { ownsEditorShortcut, registerEditorSurface } from '@/components/editor/editorShortcuts';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
export async function testProjectWorkspace(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!), P = 'workspace-test', passed: string[] = [];
  const mounts = new Map<string, number>(), shortcuts = new Map<string, number>(); let pendingCleanup: (() => void) | undefined;
  useLocaleStore.setState({ locale: 'en' });
  const node = <T extends Element = HTMLElement>(testId: string): T => { const found = document.querySelector<T>(`[data-testid="${testId}"]`); assert(found, `Missing ${testId}`); return found; };
  const click = async (id: string) => act(async () => { node<HTMLButtonElement>(id).click(); await pause(120); });
  const activePanel = () => { const panel = document.querySelector<HTMLElement>('[data-testid^="workspace-panel-"]:not([hidden])'); assert(panel, 'Missing active panel'); return panel; };
  function Tool() {
    const pane = useEnginePane(), location = useLocation(), navigate = useNavigate(), params = useParams(); const [draft, setDraft] = useState('');
    const id = pane?.instanceId ?? 'root';
    useEffect(() => { mounts.set(id, (mounts.get(id) ?? 0) + 1); }, [id]);
    useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'F8' && ownsEnginePaneEvent(pane, event)) shortcuts.set(id, (shortcuts.get(id) ?? 0) + 1); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [id, pane]);
    return <div data-testid={`tool-${id}`}>
      <output data-testid={`location-${id}`}>{location.pathname}{location.search}</output><output data-testid={`params-${id}`}>{params.id}:{params.tab}</output>
      <input data-testid={`draft-${id}`} value={draft} onChange={event => setDraft(event.target.value)} />
      <button data-testid={`local-${id}`} onClick={() => navigate('?entry=local-card')}>Local</button><button data-testid={`cross-${id}`} onClick={() => navigate('/project/other/codex?entry=foreign')}>Other project</button>
    </div>;
  }
  const engines = ['writings', 'codex', 'dictionary'].map(id => ({ id, name: id, description: '', category: 'core', icon: BookOpen, tables: {}, component: Tool }) as EngineDefinition);
  function Harness() { const location = useLocation(); return <><output data-testid="global-location">{location.pathname}{location.search}</output><ProjectWorkspace projectId={P} engines={engines}><Tool /></ProjectWorkspace></>; }
  try {
    assert(paneEngineId(workspaceRoute(`/project/${P}/codex?entry=1`), P, ['codex']) === 'codex', 'Scoped enabled engine route accepted');
    for (const path of ['/project/other/codex', `/project/${P}/disabled`, `/project/${P}/codex/nested`, '/project/%E0%A4%A/codex']) assert(!paneEngineId(workspaceRoute(path), P, ['codex']), 'Malformed, disabled and foreign routes cannot become local pane engines');
    assert(paneReferenceScope('chapter', { instanceId: 'one', visible: true }) !== paneReferenceScope('chapter', { instanceId: 'two', visible: true }), 'Same document in two panes has distinct reference event scope');
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=main`]}><Harness /></MemoryRouter>); await pause(); });
    await click('workspace-open');
    const firstId = activePanel().dataset.enginePaneId!;
    assert(node('global-location').textContent === `/project/${P}/writings?writing=main` && node(`params-${firstId}`).textContent === `${P}:codex`, 'Secondary engine receives its own route params without changing main URL');
    await click(`local-${firstId}`);
    assert(node(`location-${firstId}`).textContent?.endsWith('?entry=local-card') && !node('global-location').textContent?.includes('local-card'), 'useNavigate/query deep link stays scoped to secondary pane');
    const draft = node<HTMLInputElement>(`draft-${firstId}`);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, 'Unfinished local draft'); draft.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('workspace-add-tab'); const secondId = activePanel().dataset.enginePaneId!;
    assert(firstId !== secondId && node(`workspace-panel-${firstId}`).hasAttribute('inert') && node<HTMLInputElement>(`draft-${firstId}`).value === 'Unfinished local draft', 'Hidden tab remains mounted with exact draft and is removed from focus order');
    await act(async () => { node(`draft-${secondId}`).dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true })); });
    assert(shortcuts.get(secondId) === 1 && !shortcuts.has(firstId) && !shortcuts.has(`primary:${P}`), 'Only the focused visible pane handles a global keyboard shortcut');
    await click(`workspace-tab-${firstId}`);
    assert(mounts.get(firstId) === 1 && node<HTMLInputElement>(`draft-${firstId}`).value === 'Unfinished local draft' && node(`location-${firstId}`).textContent?.includes('local-card'), 'Returning to a tab preserves component instance, location and unsaved input');
    const back = activePanel().querySelector<HTMLButtonElement>('button[aria-label="Back in pane"]'); assert(back, 'Local back action visible'); await act(async () => { back.click(); });
    assert(!node(`location-${firstId}`).textContent?.includes('local-card') && node('global-location').textContent?.includes('writing=main'), 'Pane back history leaves the browser/project history unchanged');
    passed.push('Workspace routing: project/engine scope, independent params/deep links/back history, stable mounted tabs and preserved unsaved input');

    pendingCleanup = registerPendingFlusher('workspace-deliberate-failure', async () => false);
    await click(`workspace-close-tab-${firstId}`);
    assert(document.querySelectorAll('[role="tab"]').length === 2 && document.querySelector('[role="alert"]')?.textContent?.includes('still open'), 'Failed flush refuses tab close and preserves mounted drafts');
    await click('workspace-to-main'); assert(node('global-location').textContent?.includes('/writings'), 'Failed flush refuses moving the current secondary view to main');
    await click(`cross-${firstId}`); assert(node('global-location').textContent?.includes(P), 'Failed flush guards cross-project links');
    pendingCleanup(); pendingCleanup = undefined;
    await click(`workspace-close-tab-${firstId}`);
    assert(document.querySelectorAll('[role="tab"]').length === 1 && !document.querySelector(`[data-testid="tool-${firstId}"]`), 'Successful flush closes only the requested tab');
    await click(`cross-${secondId}`);
    assert(node('global-location').textContent === '/project/other/codex?entry=foreign', 'Cross-project navigation uses outer router after successful flush');
    await click('workspace-close'); assert(!document.querySelector('[data-testid="workspace-secondary"]'), 'Close pane flushes and unmounts the remaining tab');
    passed.push('Workspace safety: failed flushes retain tabs and reject close/main/external jumps; successful flushes complete those actions');

    const surface = document.createElement('div'), hidden = document.createElement('div'); hidden.hidden = true; hidden.append(surface); document.body.append(hidden); const unregister = registerEditorSurface(surface);
    assert(!ownsEditorShortcut(surface), 'Find shortcut registry excludes hidden mounted editors'); unregister(); hidden.remove();
    const pane = { instanceId: 'one', visible: true };
    assert(!ownsEnginePaneEvent({ ...pane, visible: false }, new KeyboardEvent('keydown')), 'Hidden pane refuses global events');
    assert(ownsEnginePaneEvent(pane, new CustomEvent('wg-undo', { detail: { enginePaneId: 'one' } })) && !ownsEnginePaneEvent({ ...pane, instanceId: 'two' }, new CustomEvent('wg-undo', { detail: { enginePaneId: 'one' } })), 'Worldgen custom history commands cannot affect a neighboring world');
    // A portal carries its pane identity even outside the pane DOM subtree.
    const portal = document.createElement('div'); portal.dataset.enginePaneId = 'one'; document.body.append(portal); const event = new KeyboardEvent('keydown', { bubbles: true }); let owned = false; portal.addEventListener('keydown', e => { owned = ownsEnginePaneEvent(pane, e); }); portal.dispatchEvent(event); portal.remove(); assert(owned, 'Portal shortcut ownership follows its originating pane identity');
    passed.push('Workspace input isolation: hidden/inert find surfaces, unique same-document reference scopes, portal ownership and world history commands');
    return passed;
  } finally { pendingCleanup?.(); await act(async () => { root.unmount(); }); }
}
