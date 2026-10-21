import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { useLocaleStore } from '@/stores/localeStore';
import { createEntityCandidate } from '@/services/entityDetection/service';

const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function waitFor(check: () => boolean, message: string) { for (let i = 0; i < 200; i++) { if (check()) return; await act(async () => { await pause(50); }); } throw Error(message); }
export async function testEntityDetectionLayout() {
  const host = document.getElementById('root')!, root = createRoot(host), projectId = 'synthetic-native-entity-ui', now = Date.now();
  const surface = window as unknown as { __want?: unknown; __sizeAck?: number; __shot?: unknown; __shotDone?: string; __key?: unknown; __keyAck?: number };
  const setSize = async (w: number, h: number, n: number) => { surface.__want = { w, h, n }; await waitFor(() => surface.__sizeAck === n, 'Viewport resize'); };
  const screenshot = async (name: string) => { surface.__shot = { name }; await waitFor(() => surface.__shotDone === name, 'Screenshot'); };
  const nativeKey = async (key: string, n: number) => { surface.__key = { key, n }; await waitFor(() => surface.__keyAck === n, 'Native keyboard'); };
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: projectId, title: 'Proyecto ficticio · QA de entidades', mode: 'custom', type: 'standalone', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: now, updatedAt: now, entityDetectionPreferences: { revision: 1, detectNewEntities: true, autoLinkMentions: true, animateNewLinks: false } });
  const prose = '<p>María García viajó a San Sebastián para visitar la Universidad de Salamanca.</p><p>Ada Lovelace met Alan Turing in New York at the United Nations.</p><p>🧭 Élodie Durand llegó a Nueva York. 李明 vive en Madrid.</p>';
  let edited = 0;
  try {
    await act(async () => { root.render(<MemoryRouter><main className="mx-auto max-w-5xl p-6"><h1 className="mb-4 font-display text-xl text-accent-gold">Proyecto ficticio · QA de entidades</h1><p className="mb-4 text-sm text-text-muted">Clasificador real en CPU; red bloqueada. Fichas creadas sólo al confirmar.</p><TiptapEditor content={prose} onChange={() => edited++} referenceContext={{ projectId, scopeId: 'qa-document' }} /></main></MemoryRouter>); await pause(); });
    await waitFor(() => !!host.querySelector('.wh-entity-controls'), 'Normal editor entity controls');
    for (const details of host.querySelectorAll<HTMLDetailsElement>('[data-editor-document-tools],.wh-entity-controls')) details.open = true;
    await waitFor(() => !![...host.querySelectorAll('button')].find(button => /Preparar clasificador local/.test(button.textContent ?? '')), 'Preparation action');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => /Preparar clasificador local/.test(button.textContent ?? ''))!.click(); await pause(); });
    await waitFor(() => host.querySelectorAll('[data-create-entity]').length >= 8, 'Real local classifier results via native IPC');
    assert(edited === 0, 'Detecting must not write prose');
    const results = [...host.querySelectorAll('.wh-entity-panel li > span')].map(node => node.textContent);
    assert(results.includes('María García') && results.includes('Ada Lovelace') && results.includes('李明') && !results.includes('Él'), `ES/EN/Unicode actual candidate names: ${JSON.stringify(results)}`);
    for (const [width, sequence] of [[1440, 1], [640, 2]]) {
      await setSize(width, 1000, sequence); await pause(100);
      assert(document.documentElement.scrollWidth <= width + 1, `Page overflow at ${width}`);
      const panel = host.querySelector('.wh-entity-panel')!.getBoundingClientRect(); assert(panel.left >= 0 && panel.right <= width, `Entity panel fits at ${width}`);
      await screenshot(`entities-${width}`);
      host.querySelector<HTMLDetailsElement>('.wh-entity-controls')!.open = false;
      await screenshot(`entities-prose-${width}`);
      host.querySelector<HTMLDetailsElement>('.wh-entity-controls')!.open = true;
    }
    const first = host.querySelector<HTMLElement>('[data-wh-entity-candidate]')!;
    first.focus(); await nativeKey('Enter', 1);
    assert(document.activeElement?.hasAttribute('data-create-entity'), 'Real keyboard Enter focuses create');
    await act(async () => { (document.activeElement as HTMLButtonElement).click(); await pause(); });
    await waitFor(() => host.querySelectorAll('.wh-entity-panel li > span').length < results.length, 'Create action updates normal candidate list');
    const created = await db.codexEntries.where('projectId').equals(projectId).toArray();
    assert(created.length === 1 && created[0].title === results[0] && created[0].content === '' && edited === 0, 'Normal UI explicit creation preserves prose and makes no facts');
    const switches = host.querySelectorAll<HTMLButtonElement>('.wh-entity-panel [role=switch]');
    await act(async () => { switches[2].click(); await pause(); });
    await waitFor(() => host.querySelectorAll('.wh-entity-panel [role=switch]')[2]?.getAttribute('aria-checked') === 'true', 'Animation switch saves independently');
    assert((await db.projects.get(projectId))?.entityDetectionPreferences?.autoLinkMentions === true && (await db.projects.get(projectId))?.entityDetectionPreferences?.detectNewEntities === true, 'Animation does not change detection or linking');
    // Same product creation service is the bridge's reusable operation; invalid source remains rejected.
    let rejected = false; try { await createEntityCandidate({ projectId, text: 'edited', candidate: { from: 0, to: 12, text: 'María García', label: 'PER', score: .99 }, type: 'character' }); } catch { rejected = true; }
    assert(rejected, 'Shared operation rejects stale source');
    return ['Native entity IPC: real pinned CPU model, preparation with network blocked and Unicode ES/EN candidates', 'Normal Tiptap UI: independent switches, explicit card creation, keyboard highlight, no prose writes', 'Real compiled CSS at 1440/640: panel and page fit; native Enter moves focus to creation'];
  } finally { await act(async () => root.unmount()); await db.codexEntries.where('projectId').equals(projectId).delete(); await db.projects.delete(projectId); }
}
