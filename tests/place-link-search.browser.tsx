import type { CodexEntry } from '@/types';
import { matchEntries, searchKey } from '@/components/maps/codexSearch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const entry = (id: string, title: string, fields: Record<string, string> = {}): CodexEntry => ({ id, projectId: 'qa-place-link-search', type: 'character', title, fields, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });

export async function testPlaceLinkSearchMatching(): Promise<string[]> {
  const entries = [entry('port', 'Puerto de Ávila'), entry('avila', 'Ávila del Estuario'), entry('salt', 'Orden de la Sal'), entry('keeper', 'Nora del Puerto', { aliases: '["La Guardiana del Faro","Torres, Lucía"]', Apodos: 'Vigía; Vigia; Custodia' }), entry('other', 'Nora del Puerto', { aka: 'Luz del Norte' }), entry('split', 'Puerto Azul', { aliases: 'Fortaleza Roja' })];
  const before = JSON.stringify(entries);
  assert(searchKey(' ÁVILA ') === 'avila', 'Existing accent/case normalization changed');
  assert(matchEntries(entries.slice(0, 3), 'avila').map(row => row.id).join() === 'avila,port', 'Existing title prefix order changed');
  assert(matchEntries(entries, 'sal orden').map(row => row.id).join() === 'salt', 'Existing unordered title words changed');
  assert(matchEntries(entries, 'guardiana faro').map(row => row.id).join() === 'keeper', 'Stored JSON alias must be searchable by its words');
  assert(matchEntries(entries, 'LUCIA torres').map(row => row.id).join() === 'keeper', 'An alias with JSON punctuation must remain one name');
  assert(matchEntries(entries, 'vigia').map(row => row.id).join() === 'keeper', 'Legacy alias fields must not duplicate a card');
  assert(matchEntries(entries, 'nora puerto').map(row => row.id).join() === 'keeper,other', 'Different cards with the same title must keep distinct identities');
  assert(!matchEntries(entries, 'puerto roja').length, 'Words from different names must not be joined');
  assert(!matchEntries(entries, 'no matching card').length, 'No-match must stay empty');
  const ranked = [entry('alias', 'A first title', { aliases: 'Faro del Puerto' }), entry('middle', 'Casa del Faro'), entry('prefix', 'Faro Gris')];
  assert(matchEntries(ranked, 'faro').map(row => row.id).join() === 'prefix,middle,alias', 'Alias-only matches must preserve existing title priority');
  assert(matchEntries(entries, '').map(row => row.id).join() === [...entries].sort((a, b) => a.title.localeCompare(b.title)).map(row => row.id).join(), 'Empty query must keep the title catalogue');
  assert(!matchEntries([entry('body', 'Unrelated', { occupation: 'secret lighthouse' })].map(row => ({ ...row, tags: ['secret lighthouse'], content: 'secret lighthouse' })), 'secret lighthouse').length, 'Card picker must not search unrelated fields, tags or body');
  assert(JSON.stringify(entries) === before, 'Searching must not rewrite source cards or aliases');
  return ['Place-card matching keeps native title words/order and adds lossless stored aliases without crossing names, duplicating cards or searching body/tags'];
}

export async function testPlaceLinkSearchUi(): Promise<string[]> {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { db } = await import('@/db');
  const { default: Inspector } = await import('@/engines/worldgen/components/SpatialEntityInspector');
  const { default: Picker } = await import('@/components/maps/CodexEntryPicker');
  const { EnginePaneContext } = await import('@/engines/_shared/EnginePaneContext');
  const { useLocaleStore } = await import('@/stores/localeStore');
  const { listWorldLinks } = await import('@/engines/worldgen/era');
  const P = 'qa-place-link-search', W = P + '-world', card = entry(P + '-keeper', 'Nora del Puerto', { aliases: '["La Guardiana del Faro"]' });
  const worldEntry = { key: 'settlement:20,10', legacyKeys: [], kind: 'settlement' as const, type: 'village', name: 'QA Faro', x: 20, y: 10, sourceX: 20, sourceY: 10, extent: 1, importance: 1, source: 'painted' as const, hidden: false, style: {} };
  const root = createRoot(document.getElementById('root')!), paths: string[] = [], picks: Array<string | undefined> = [];
  const pause = () => new Promise(resolve => setTimeout(resolve, 50)), noop = () => {};
  const click = async (node: Element | null) => { assert(node, 'Missing real picker control'); await act(async () => { (node as HTMLElement).click(); await pause(); }); };
  const type = async (value: string, testId = 'place-card-link-search') => { const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`); assert(input, 'Place inspector must expose the native card search input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  const render = async (classic = false, visible = true) => { await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'qa-search-pane', projectId: P, visible: true, navigate: to => paths.push(to) }}>{visible && (classic ? <Picker entries={[card]} onChange={id => picks.push(id)} testId="classic-search" /> : <Inspector projectId={P} worldId={W} entity={worldEntry} onRename={noop} onRemove={noop} onRestore={noop} onMove={noop} onStyle={noop} onOpenRegion={noop} onReveal2D={noop} onReveal3D={noop} />)}</EnginePaneContext.Provider></MemoryRouter>); await pause(); }); await act(async () => { await pause(); }); };
  const oldLocale = useLocaleStore.getState().locale;
  try {
    useLocaleStore.setState({ locale: 'en' });
    await db.projects.put({ id: P, title: 'QA card search', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen', 'codex'], createdAt: 1, updatedAt: 1 });
    await db.codexEntries.put(card);
    await db.scenes.put({ id: P + '-scene', projectId: P, title: 'Existing scene', order: 0, tags: [], createdAt: 1, updatedAt: 1 });
    await render();
    const before = JSON.stringify(await db.entityLinks.where('projectId').equals(P).toArray());
    await click(document.querySelector('[data-testid="place-card-link"]'));
    await type('guardiana faro');
    assert(document.querySelector(`[data-testid="place-card-link-option-${card.id}"]`)?.textContent?.includes(card.title), 'Alias result must show the real card title');
    await type('absent card');
    assert(document.querySelector('[data-testid="place-card-link-picker"]')?.textContent?.includes('No entry matches'), 'No-match state must explain the empty result');
    assert(JSON.stringify(await db.entityLinks.where('projectId').equals(P).toArray()) === before, 'Typing a search wrote a link');
    await type('FARO guardiana');
    await click(document.querySelector(`[data-testid="place-card-link-option-${card.id}"]`));
    assert((await listWorldLinks({ projectId: P }, W)).filter(link => link.targetEntityId === card.id).length === 1, 'Alias choice must persist one link by the original ID');
    assert(document.querySelector('option[value="scene:qa-place-link-search-scene"]'), 'Codex search removed existing scene links');
    await click(document.querySelector(`[data-testid="place-open-card-${card.id}"]`));
    assert(paths.at(-1)?.includes(`entry=${card.id}`), 'Alias choice must open the real ID in the current pane');
    await render(false, false); await render();
    assert(document.querySelector(`[data-testid="place-open-card-${card.id}"]`), 'Reopened inspector lost the saved alias-selected link');
    await click(document.querySelector('[data-testid="place-card-link"]'));
    await type('guardiana');
    assert(!document.querySelector(`[data-testid="place-card-link-option-${card.id}"]`), 'Already linked card must not be added again');
    await render(true);
    await click(document.querySelector('[data-testid="classic-search"]'));
    await type('guardiana faro', 'classic-search-search');
    const input = document.querySelector<HTMLInputElement>('[data-testid="classic-search-search"]')!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    assert(picks.join() === card.id, 'Classic picker keyboard choice must use the same alias matcher and original ID');
    return ['Actual Worldgen inspector searches aliases, keeps non-Codex links, persists/reopens/opens one logical card and the reused Classic picker selects it by keyboard'];
  } finally {
    await act(async () => root.unmount());
    await db.entityLinks.where('projectId').equals(P).delete(); await db.codexEntries.where('projectId').equals(P).delete(); await db.scenes.where('projectId').equals(P).delete(); await db.projects.delete(P);
    useLocaleStore.setState({ locale: oldLocale });
  }
}

export async function testPlaceLinkSearchScopes(): Promise<string[]> {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { db } = await import('@/db');
  const { default: Inspector } = await import('@/engines/worldgen/components/SpatialEntityInspector');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const { EnginePaneContext } = await import('@/engines/_shared/EnginePaneContext');
  const { useLocaleStore } = await import('@/stores/localeStore');
  const { saveWorldEra, readWorldDocument, saveEraDocument, hideEraDocument } = await import('@/services/worldEras/store');
  const { listWorldLinks } = await import('@/engines/worldgen/era');
  const P = 'qa-place-search-scopes', W = P + '-world', F = P + '-foreign', era = { projectId: P, eraId: 'past' };
  const base = { ...entry(P + '-card', 'Nora Base', { aliases: 'Base beacon' }), projectId: P }, hidden = { ...entry(P + '-hidden', 'Hidden card', { aliases: 'Past beacon' }), projectId: P };
  const root = createRoot(document.getElementById('root')!), paths: string[] = [], pause = () => new Promise(resolve => setTimeout(resolve, 60)), noop = () => {};
  const place = { key: 'settlement:20,10', legacyKeys: [], kind: 'settlement' as const, type: 'village', name: 'QA Faro', x: 20, y: 10, sourceX: 20, sourceY: 10, extent: 1, importance: 1, source: 'painted' as const, hidden: false, style: {} };
  const render = async (eraId?: string, key = place.key) => { await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'qa-search-scope-pane', projectId: P, eraId, visible: true, navigate: to => paths.push(to) }}><Inspector projectId={P} worldId={W} entity={{ ...place, key }} onRename={noop} onRemove={noop} onRestore={noop} onMove={noop} onStyle={noop} onOpenRegion={noop} onReveal2D={noop} onReveal3D={noop} /></EnginePaneContext.Provider></MemoryRouter>); await pause(); }); await act(async () => { await pause(); }); };
  const click = async (selector: string) => { const node = document.querySelector<HTMLElement>(selector); assert(node, `Missing ${selector}`); await act(async () => { node.click(); await pause(); }); };
  const query = async (value: string) => { const input = document.querySelector<HTMLInputElement>('[data-testid="place-card-link-search"]'); assert(input, 'Missing scoped card search input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  const oldLocale = useLocaleStore.getState().locale, originalAdd = db.entityLinks.add;
  let release: (() => void) | undefined;
  try {
    useLocaleStore.setState({ locale: 'en' });
    await db.projects.bulkPut([P, F].map(id => ({ id, title: 'QA scoped card search', description: '', mode: 'custom' as const, type: 'standalone' as const, color: '#888888', status: 'draft' as const, enabledEngines: ['worldgen', 'codex'], createdAt: 1, updatedAt: 1 })));
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'QA world', params: { ...DEFAULT_PARAMS, width: 128 }, createdAt: 1, updatedAt: 1 });
    await db.codexEntries.bulkPut([base, hidden, { ...entry(F + '-card', 'Foreign card', { aliases: 'Past beacon' }), projectId: F }]);
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const before = await readWorldDocument(era, 'codex', base.id), concealed = await readWorldDocument(era, 'codex', hidden.id);
    assert(before && concealed, 'Missing actual era fixture sources');
    await saveEraDocument(era, 'codex', { root: { ...before.document.root, title: 'Nora Past', fields: { aliases: 'Past beacon' } }, children: {} }, before.version);
    await hideEraDocument(era, 'codex', hidden.id, concealed.version);
    await render('past'); await click('[data-testid="place-card-link"]'); await query('past beacon');
    assert(document.querySelector(`[data-testid="place-card-link-option-${base.id}"]`)?.textContent?.includes('Nora Past'), 'Era alias must use the effective variant title');
    assert(!document.querySelector(`[data-testid="place-card-link-option-${hidden.id}"]`) && !document.querySelector(`[data-testid="place-card-link-option-${F}-card"]`), 'Hidden or foreign card leaked into era results');
    await query('base beacon'); assert(!document.querySelector(`[data-testid="place-card-link-option-${base.id}"]`), 'Era search leaked the Base alias');
    await query('past beacon'); await click(`[data-testid="place-card-link-option-${base.id}"]`);
    assert((await listWorldLinks(era, W)).some(link => link.targetEntityId === base.id) && !(await listWorldLinks({ projectId: P }, W)).length, 'Era linking wrote Base');
    await click(`[data-testid="place-open-card-${base.id}"]`); assert(paths.at(-1)?.includes('era=past'), 'Opening alias result escaped the era');
    assert(JSON.stringify(await db.codexEntries.get(base.id)) === JSON.stringify(base), 'Era searching or linking rewrote the Base card');
    await render(); await click('[data-testid="place-card-link"]'); await query('base beacon');
    const waiting = new Promise<void>(resolve => { release = resolve; });
    db.entityLinks.add = (async () => { await waiting; throw Error('synthetic delayed link failure'); }) as typeof db.entityLinks.add;
    await click(`[data-testid="place-card-link-option-${base.id}"]`);
    await render(undefined, 'settlement:21,10');
    assert(!document.querySelector('[data-testid="place-card-link-search"]'), 'A new place retained the previous picker query');
    await act(async () => { release!(); await pause(); });
    assert(!document.querySelector('[role="alert"]'), 'A late failure from another place contaminated the current owner');
    await render(); await click('[data-testid="place-card-link"]');
    assert(document.querySelector<HTMLInputElement>('[data-testid="place-card-link-search"]')?.value === '', 'A to B to A revived an old query');
    return ['Effective era aliases exclude Base/hidden/foreign names, links and open keep era/pane, and delayed failure/query state cannot escape a place binding'];
  } finally {
    release?.(); db.entityLinks.add = originalAdd;
    await act(async () => root.unmount());
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) { await table.where('projectId').equals(P).delete(); await table.where('projectId').equals(F).delete(); }
    await db.projects.bulkDelete([P, F]); useLocaleStore.setState({ locale: oldLocale });
  }
}
