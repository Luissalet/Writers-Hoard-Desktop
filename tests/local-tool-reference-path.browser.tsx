import '@/engines';
import {act, Suspense, useLayoutEffect, useMemo, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getEngine} from '@/engines/_registry';
import {getAnchorAdapter} from '@/engines/_shared/anchoring';
import {EnginePaneContext, useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {saveCodexDraft} from '@/engines/codex/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import {defineLocalTool, type LocalToolClient, type LocalToolProps} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import documentNotebook from '@/engines/local/examples/documentNotebookDefinition';
import type {LinkedNotebookState} from '@/engines/local/examples/LinkedNotebook';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {authorCard} from './fixtures/local-tools/author-data';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (predicate()) return;
    await act(async () => { await pause(); });
  }
  throw Error(`${message}; ledger=${JSON.stringify(getPendingWritesSnapshot())}`);
}
function node<T extends Element = HTMLElement>(selector: string, within: ParentNode = document): T {
  const value = within.querySelector<T>(selector); assert(value, `Missing ${selector}`); return value;
}
function button(within: ParentNode, label: string): HTMLButtonElement {
  const value = [...within.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  assert(value, `Missing button ${label}`); return value;
}
const locationNow = () => node('[data-testid="reference-path-location"]').textContent;
const primary = () => node('[data-testid="workspace-primary"]');
function sourceState(id: string) {
  const host = primary().querySelector<HTMLElement>(`[data-source-document-host="${id}"]`);
  const textarea = host?.querySelector<HTMLTextAreaElement>('textarea');
  return {host, textarea, id: host?.dataset.sourceDocumentHost, ready: !!textarea && !textarea.disabled, notes: textarea?.value,
    scope: host?.querySelector('section[aria-label="Linked notebook"] header span')?.textContent};
}

interface Fixture {
  projectId: string; sourceId: string; sourceRoute: string; targetId: string; targetTitle: string; targetMarker: string;
  controlId: string; controlTitle: string; controlMarker: string;
  dispatches: {kind: 'main' | 'beside'; path: string}[];
  clients: Map<string, LocalToolClient<LinkedNotebookState>>;
  client(): LocalToolClient<LinkedNotebookState>;
  business(): Promise<string>;
}

async function withFixture<T>(label: string, run: (fixture: Fixture) => Promise<T>): Promise<T> {
  const projectId = `reference-path-${label}-${crypto.randomUUID()}`, targetId = `${projectId}-B`, controlId = `${projectId}-C`;
  const targetTitle = `Unopened target B ${label}`, controlTitle = `Opening control C ${label}`;
  const targetMarker = `BODY_B_${targetId}`, controlMarker = `BODY_C_${controlId}`;
  const clients = new Map<string, LocalToolClient<LinkedNotebookState>>(), dispatches: Fixture['dispatches'] = [];
  const Original = documentNotebook.component;
  function Observe(props: LocalToolProps<LinkedNotebookState>) {
    useLayoutEffect(() => {
      const id = props.client.documentId; if (!id) return;
      clients.set(id, props.client);
      return () => { if (clients.get(id) === props.client) clients.delete(id); };
    }, [props.client]);
    return <Original {...props}/>;
  }
  registerLocalToolModules({'./installed/examples.document-notebook/module.tsx': {default: defineLocalTool({...documentNotebook, component: Observe})}});
  const sourceEngine = `local-tool-${documentNotebook.namespace}`, engineIds = [sourceEngine, 'codex'];
  const engines = engineIds.map(id => { const engine = getEngine(id); assert(engine, `Real registered engine absent ${id}`); return engine; });
  // App imports this same engine bootstrap. Registration precedes all fixture documents and any opening.
  const registered = getAnchorAdapter('codex'); assert(registered, 'Normal renderer did not register the Codex adapter before B');
  console.error('REFERENCE_PATH_REGISTRY_BEFORE_B ' + JSON.stringify({label, engineId: registered.engineId, targetId, dispatches}));
  const root = createRoot(node('#root'));
  useLocaleStore.setState({locale: 'en', loaded: true});
  try {
    await db.projects.put({id: projectId, title: `Reference paths ${label}`, description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: engineIds, engineOrder: engineIds, createdAt: 1, updatedAt: 1});
    await db.codexEntries.bulkPut([
      {...authorCard(projectId, targetTitle), id: targetId, content: `<p>${targetMarker}</p>`},
      {...authorCard(projectId, controlTitle), id: controlId, content: `<p>${controlMarker}</p>`},
    ]);
    const source = await createSourceToolDocument({projectId}, documentNotebook.namespace, `Source A ${label}`);
    const setup = createLocalToolClient(projectId, documentNotebook, {documentId: source.id}), initial = await setup.read();
    await setup.save({...documentNotebook.initialState, notes: `Saved A ${label}`, linked: {kind: 'codex', documentId: targetId}}, initial.revision, initial.document?.version);
    const sourceRoute = `/project/${projectId}/${sourceEngine}?document=${source.id}`;
    function ObservePorts({children}: {children: ReactNode}) {
      const pane = useEnginePane(); assert(pane?.navigate && pane.openBeside, 'Real workspace navigation ports absent');
      const value = useMemo(() => ({...pane,
        navigate: (path: string) => { dispatches.push({kind: 'main', path}); pane.navigate!(path); },
        openBeside: (path: string) => { dispatches.push({kind: 'beside', path}); pane.openBeside!(path); },
      }), [pane]);
      return <EnginePaneContext.Provider value={value}>{children}</EnginePaneContext.Provider>;
    }
    function RoutedWorkspace() {
      const location = useLocation(), params = useParams(), engine = getEngine(params.tab ?? '');
      assert(engine && engineIds.includes(engine.id), 'Reactive principal has no registered enabled engine');
      const Component = engine.component;
      return <><output data-testid="reference-path-location">{location.pathname}{location.search}</output>
        <ProjectWorkspace projectId={projectId} engines={engines}><ObservePorts><Suspense fallback={<p>Loading registered engine</p>}>
          <Component key={`${projectId}:${engine.id}`} projectId={projectId}/>
        </Suspense></ObservePorts></ProjectWorkspace></>;
    }
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[sourceRoute]}><Routes><Route path="/project/:id/:tab" element={<RoutedWorkspace/>}/></Routes></MemoryRouter>);
      await pause();
    });
    await until(() => {
      const current = sourceState(source.id);
      return current.ready && !!current.host && !button(current.host, 'Open linked document').disabled && clients.has(source.id);
    }, 'Real documentary Source A did not resolve B and become ready');
    const fixture: Fixture = {projectId, sourceId: source.id, sourceRoute, targetId, targetTitle, targetMarker, controlId, controlTitle, controlMarker, dispatches, clients,
      client: () => { const client = clients.get(source.id); assert(client, 'Current Source client absent'); return client; },
      business: async () => {
        const tables: Record<string, unknown[]> = {};
        for (const table of db.tables) {
          const rows = await table.toArray();
          tables[table.name] = rows.filter(row => row.projectId === projectId || table.name === 'projects' && row.id === projectId)
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        }
        return JSON.stringify(tables);
      },
    };
    return await run(fixture);
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    clients.clear(); await deleteProject(projectId);
  }
}

export async function testLocalToolReferencePathBaseline(): Promise<string[]> {
  const passed: string[] = [];
  await withFixture('metadata', async fixture => {
    const reference = {kind: 'codex', documentId: fixture.targetId} as const, client = fixture.client();
    const read = await client.world.read('codex', fixture.targetId), resolved = await client.refs.resolve(reference);
    assert(read && read.document.root.id === fixture.targetId && read.document.root.title === fixture.targetTitle && read.document.root.content === `<p>${fixture.targetMarker}</p>`, 'Real world.read did not return nonempty B by stable ID');
    assert(resolved.available && resolved.title === fixture.targetTitle && resolved.provenance === 'base' && JSON.stringify(resolved.reference) === JSON.stringify(reference), 'Existing reference metadata differs from effective B');
    const expected = JSON.stringify({reference, available: true, title: fixture.targetTitle, provenance: 'base'});
    for (const args of [[reference], [reference, {}], [reference, {includePath: false}]]) {
      const result = await Reflect.apply(client.refs.resolve, client.refs, args);
      assert(JSON.stringify(result) === expected && !Object.hasOwn(result, 'path'), 'Omitted/empty/false options changed existing exact metadata shape');
    }
    const base = await db.codexEntries.get(fixture.targetId); assert(base, 'Rename baseline lost B');
    const renamedTitle = fixture.targetTitle + ' renamed';
    const renamed = await saveCodexDraft(base, {...base, title: renamedTitle});
    const after = await client.refs.resolve(reference), afterRead = await client.world.read('codex', fixture.targetId);
    assert(renamed.id === base.id && renamed.content === base.content && afterRead?.document.root.id === base.id && afterRead.document.root.content === base.content && after.title === renamedTitle && after.available && after.provenance === 'base' && JSON.stringify(after.reference) === JSON.stringify(reference), 'Normal rename changed reference identity/content or left a stale title');
    assert(fixture.dispatches.length === 0 && locationNow() === fixture.sourceRoute && !document.querySelector('[data-testid="codex-show-cards"]'), 'Metadata/rename opened B or departed A');
    passed.push('Real Source client reads nonempty B, resolves effective Base metadata, preserves omitted/empty/false JSON and stable reference/content through normal rename without opening B');
  });
  await withFixture('opening-control', async fixture => {
    await act(async () => { await fixture.client().openDocument('codex', fixture.controlId); await pause(); });
    const expected = `/project/${fixture.projectId}/codex?entry=${fixture.controlId}`;
    await until(() => locationNow() === expected && !!primary().querySelector('[data-testid="codex-show-cards"]') && [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.querySelector('h2')?.textContent === fixture.controlTitle && dialog.textContent?.includes(fixture.controlMarker)), 'Existing Open did not reach real C through reactive router/registered Codex renderer');
    assert(fixture.dispatches.length === 1 && fixture.dispatches[0].kind === 'main' && fixture.dispatches[0].path === expected && !primary().querySelector(`[data-source-document-host="${fixture.sourceId}"]`), 'Existing Open did not dispatch exactly once and depart the real Source host');
    passed.push('Independent fixture opens C through the real client, workspace port, reactive router and normal registered Codex dialog; Contract B remains a distinct unopened document');
  });
  return passed;
}

export async function testLocalToolReferencePathContract(): Promise<string[]> {
  return withFixture('contract', async fixture => {
    const current = sourceState(fixture.sourceId); assert(current.ready && current.textarea && current.host, 'Source not ready before draft');
    const draft = 'Pending Source notes must remain exact while projecting unopened B';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(current.textarea, draft);
      current.textarea!.dispatchEvent(new Event('input', {bubbles: true})); await pause();
    });
    await until(() => { const state = sourceState(fixture.sourceId); return state.ready && state.notes === draft && !!state.host && !button(state.host, 'Save notes').disabled; }, 'Real LinkedNotebook did not accept pending notes');
    const client = fixture.client(), reference = {kind: 'codex', documentId: fixture.targetId} as const;
    const before = await fixture.business(), ledgerBefore = JSON.stringify(getPendingWritesSnapshot()), dispatchBefore = JSON.stringify(fixture.dispatches);
    assert(fixture.dispatches.length === 0 && locationNow() === fixture.sourceRoute && !document.querySelector('[data-testid="codex-show-cards"]') && !document.querySelector('[data-testid="workspace-secondary"]'), 'Contract B was already opened or warmed through navigation');
    assert(client.projectId === fixture.projectId && client.namespace === documentNotebook.namespace && client.documentId === fixture.sourceId && client.eraId === undefined, 'Emitted real Source client has wrong logical scope');
    const read = await client.world.read('codex', fixture.targetId);
    const result = await Reflect.apply(client.refs.resolve, client.refs, [reference, {includePath: true}]);
    const after = await fixture.business(), state = sourceState(fixture.sourceId), ledgerAfter = JSON.stringify(getPendingWritesSnapshot());
    const diagnostic = {result, hasPath: Object.hasOwn(result, 'path'), expectedPath: `/project/${fixture.projectId}/codex?entry=${fixture.targetId}`,
      registryEngine: getAnchorAdapter('codex')?.engineId, route: locationNow(), sourceId: state.id, currentReady: state.ready, currentNotes: state.notes,
      currentScope: state.scope, saveEnabled: !!state.host && !button(state.host, 'Save notes').disabled, businessExact: before === after,
      ledgerBefore: JSON.parse(ledgerBefore), ledgerAfter: JSON.parse(ledgerAfter), dispatches: fixture.dispatches, targetRendererMounted: !!document.querySelector('[data-testid="codex-show-cards"]')};
    console.error('REFERENCE_PATH_CONTRACT_DIAGNOSTIC ' + JSON.stringify(diagnostic));
    assert(read && read.document.root.id === fixture.targetId && read.document.root.title === fixture.targetTitle && read.document.root.content === `<p>${fixture.targetMarker}</p>`, 'Contract B is not effective nonempty readable data');
    assert(result.available === true && result.title === fixture.targetTitle && result.provenance === 'base' && JSON.stringify(result.reference) === JSON.stringify(reference), 'Opt-in lost positive effective B metadata');
    assert(before === after && ledgerBefore === ledgerAfter && dispatchBefore === JSON.stringify(fixture.dispatches), 'Path consultation wrote/flushed business data or dispatched navigation');
    assert(locationNow() === fixture.sourceRoute && state.id === fixture.sourceId && state.ready && state.notes === draft && state.scope === 'Shared base' && diagnostic.saveEnabled && !diagnostic.targetRendererMounted && !document.querySelector('[data-testid="workspace-secondary"]'), 'Path consultation changed current logical A/scope/pending draft or opened B');
    // This expected app-path is only an oracle: it never builds UI links or dispatches a route.
    assert(result.path === diagnostic.expectedPath, `Opt-in must project the effective registered app-path of unopened B: ${JSON.stringify(diagnostic)}`);
    return ['Real Source client projects unopened B app-path with effective metadata while preserving pending notes, logical scope, every owned business row and save ledger, without writes/flush/navigation'];
  });
}

// Expansion follows the immutable first 16,358-byte Baseline/Contract oracle.
import {registerAnchorAdapter, getAllAnchorAdapters} from '@/engines/_shared/anchoring';
import {saveWorldEra, saveEraDocument, readWorldDocument, hideEraDocument} from '@/services/worldEras/store';
import type {EraDocumentKind} from '@/services/worldEras/types';
import type {CodexEntry} from '@/types';
import type {LocalToolResolvedReference} from '@/engines/local/sdk';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';

async function rejectsWith(run: () => Promise<unknown>, expected: string) {
  try { await run(); } catch (error) { assert(error instanceof Error && error.message === expected, `Expected ${expected}, got ${String(error)}`); return; }
  throw Error(`Expected rejection ${expected}`);
}
async function oldShapes(client: LocalToolClient<LinkedNotebookState>, reference: {kind: EraDocumentKind; documentId: string}) {
  const plain = await client.refs.resolve(reference), empty = await client.refs.resolve(reference, {}), disabled = await client.refs.resolve(reference, {includePath: false});
  assert(!Object.hasOwn(plain, 'path') && JSON.stringify(plain) === JSON.stringify(empty) && JSON.stringify(plain) === JSON.stringify(disabled), 'Omitted/empty/false metadata shapes diverged');
  return plain;
}

export async function testLocalToolReferencePathExpanded(): Promise<string[]> {
  const passed: string[] = [];
  await withFixture('expanded-scopes', async fixture => {
    const eraId = 'past', scope = {projectId: fixture.projectId, eraId}, reference = {kind: 'codex', documentId: fixture.targetId} as const;
    await act(async () => {
      await saveWorldEra(fixture.projectId, {id: eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
      const read = await readWorldDocument(scope, 'codex', fixture.targetId); assert(read, 'Era did not inherit readable B');
      await saveEraDocument(scope, 'codex', {...read.document, root: {...read.document.root, title: 'B in Past', content: '<p>PAST_EFFECTIVE_B</p>'}}, read.version);
    });
    const base = createLocalToolClient(fixture.projectId, documentNotebook, {readOnly: true}), era = createLocalToolClient(fixture.projectId, documentNotebook, {eraId, readOnly: true});
    const basePath = `/project/${fixture.projectId}/codex?entry=${fixture.targetId}`, eraPath = basePath + '&era=past';
    const before = await fixture.business(), initialBase = await base.refs.resolve(reference, {includePath: true}), initialEra = await era.refs.resolve(reference, {includePath: true});
    assert(initialBase.available && initialBase.title === fixture.targetTitle && initialBase.provenance === 'base' && initialBase.path === basePath, 'Base path/metadata scope incorrect');
    assert(initialEra.available && initialEra.title === 'B in Past' && initialEra.provenance === 'variant' && initialEra.path === eraPath, 'Era path/metadata not effective');
    await oldShapes(base, reference); await oldShapes(era, reference);
    const tool = getBridgeTool('wh_local_tool_reference_resolve');
    assert(tool?.writes === false && tool.schema.properties.includePath.type === 'boolean', 'Existing read-only MCP schema did not expose optional boolean');
    for (const [client, eraValue] of [[base, undefined], [era, eraId]] as const) {
      const args = {projectId: fixture.projectId, namespace: documentNotebook.namespace, reference, ...(eraValue ? {eraId: eraValue} : {})};
      const expected = await client.refs.resolve(reference, {includePath: true}), reply = await runBridgeTool('wh_local_tool_reference_resolve', {...args, includePath: true});
      assert(reply.ok && JSON.stringify(reply.result) === JSON.stringify(expected), 'Real MCP dispatcher differs from SDK path/metadata');
      const old = await client.refs.resolve(reference);
      for (const options of [{}, {includePath: false}]) {
        const legacy = await runBridgeTool('wh_local_tool_reference_resolve', {...args, ...options});
        assert(legacy.ok && JSON.stringify(legacy.result) === JSON.stringify(old), 'MCP omitted/false changed old exact output');
      }
    }
    assert(before === await fixture.business() && fixture.dispatches.length === 0 && locationNow() === fixture.sourceRoute, 'Scoped SDK/MCP consultation wrote or navigated');
    const effective = await readWorldDocument(scope, 'codex', fixture.targetId); assert(effective, 'Rename target missing');
    await act(async () => { await saveCodexDraft(effective.document.root as unknown as CodexEntry, {...effective.document.root, title: 'Past B renamed'} as unknown as CodexEntry, scope); });
    const renamed = await era.refs.resolve(reference, {includePath: true}), unchangedBase = await base.refs.resolve(reference, {includePath: true});
    assert(renamed.title === 'Past B renamed' && renamed.path === eraPath && renamed.reference.documentId === fixture.targetId && renamed.provenance === 'variant' && (await era.world.read('codex', fixture.targetId))?.document.root.content === '<p>PAST_EFFECTIVE_B</p>', 'Era rename changed ID/path/content or stale title');
    assert(JSON.stringify(unchangedBase) === JSON.stringify(initialBase), 'Era rename changed Base reference/path');
    passed.push('Base/era effective path and metadata, unchanged old JSON shapes and real read-only MCP dispatcher agree; normal era rename preserves identity/path/content and Base');
  });
  await withFixture('expanded-kinds', async fixture => {
    const other = defineLocalTool({...documentNotebook, namespace: 'examples.reference-path-other'});
    registerLocalToolModules({'./installed/examples.reference-path-other/module.tsx': {default: other}});
    const eraId = 'past', scope = {projectId: fixture.projectId, eraId};
    const worldId = `${fixture.projectId}-root-world`, waypointId = `${fixture.projectId}-waypoint`, hiddenId = `${fixture.projectId}-hidden`;
    let otherId = '';
    await act(async () => {
      await saveWorldEra(fixture.projectId, {id: eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
      otherId = (await createSourceToolDocument({projectId: fixture.projectId}, other.namespace, 'Other namespace Source B')).id;
      await db.generatedWorlds.put({id: worldId, projectId: fixture.projectId, title: 'World root', params: {...DEFAULT_PARAMS}, createdAt: 1, updatedAt: 1});
      await db.worldWaypoints.put({id: waypointId, projectId: fixture.projectId, worldId, name: 'Waypoint child', color: '#777777', u: .4, v: .5, createdAt: 1, updatedAt: 1});
      await db.codexEntries.put({...authorCard(fixture.projectId, 'Hidden only in Past'), id: hiddenId});
      await hideEraDocument(scope, 'codex', hiddenId, (await readWorldDocument(scope, 'codex', hiddenId))!.version);
    });
    const paths: string[] = [], client = createLocalToolClient(fixture.projectId, documentNotebook, {eraId, readOnly: true, navigate: path => paths.push(path), openBeside: path => paths.push(path)});
    const before = await fixture.business();
    for (const [kind, id, expected] of [
      ['local-tool', otherId, `/project/${fixture.projectId}/local-tool-${other.namespace}?document=${otherId}&era=past`],
      ['worldgen', worldId, `/project/${fixture.projectId}/worldgen?world=${worldId}&era=past`],
    ] as const) {
      const queryDispatchCount = paths.length;
      const projected = await client.refs.resolve({kind, documentId: id}, {includePath: true});
      assert(projected.available && projected.path === expected && projected.provenance === 'base' && paths.length === queryDispatchCount, `${kind} projection lost effective ownership/era or dispatched`);
      await client.openDocument(kind, id);
      assert(paths.at(-1) === projected.path, `${kind} projection differs from existing actual opening port`);
    }
    const count = paths.length;
    for (const [kind, id] of [['worldgen', waypointId], ['codex', hiddenId], ['codex', 'missing-B']] as const) {
      const missing = await client.refs.resolve({kind, documentId: id}, {includePath: true});
      assert(!missing.available && missing.path === null && !Object.hasOwn(missing, 'provenance'), `${kind} child/hidden/missing invented a destination`);
      await rejectsWith(() => client.openDocument(kind, id), 'world_document_missing');
    }
    assert(paths.length === count && await fixture.business() === before, 'Kinds/unavailable consultations changed data or dispatched an unavailable target');
    const project = await db.projects.get(fixture.projectId); assert(project, 'Fixture project absent');
    await act(async () => { await db.projects.update(fixture.projectId, {enabledEngines: project.enabledEngines.filter(id => id !== 'codex')}); });
    const disabledSnapshot = await fixture.business(), disabled = await client.refs.resolve({kind: 'codex', documentId: fixture.targetId}, {includePath: true});
    assert(disabled.available && disabled.path === `/project/${fixture.projectId}/codex?entry=${fixture.targetId}&era=past` && await fixture.business() === disabledSnapshot && paths.length === count, 'Disabled engine became a new document/path gate or wrote data');
    passed.push('Effective Source namespace and worldgen root/era match actual open ports; waypoint child/hidden/missing yield unavailable/null without dispatch; disabled engine adds no new gate');
  });
  await withFixture('expanded-foreign-lease', async fixture => {
    const foreignProject = fixture.projectId + '-foreign', foreignId = foreignProject + '-B';
    const project = await db.projects.get(fixture.projectId); assert(project, 'Own project absent');
    await db.projects.put({...project, id: foreignProject, sourceToolDocuments: []});
    await db.codexEntries.put({...authorCard(foreignProject, 'Foreign B'), id: foreignId});
    try {
      const before = await fixture.business(), foreignBefore = JSON.stringify([await db.projects.get(foreignProject), await db.codexEntries.get(foreignId)]), client = fixture.client();
      const foreign = await client.refs.resolve({kind: 'codex', documentId: foreignId}, {includePath: true});
      assert(!foreign.available && foreign.path === null && fixture.dispatches.length === 0, 'Foreign reference acquired a local route');
      let live = true; const paths: string[] = [], scoped = createLocalToolClient(fixture.projectId, documentNotebook, {isCurrent: () => live, navigate: path => paths.push(path)});
      const revoke = (row: {id?: string}) => { if (row?.id === fixture.targetId) live = false; return row; };
      db.codexEntries.hook('reading', revoke);
      try { await rejectsWith(() => scoped.refs.resolve({kind: 'codex', documentId: fixture.targetId}, {includePath: true}), 'local_tool_context_expired'); }
      finally { db.codexEntries.hook('reading').unsubscribe(revoke); }
      assert(!live && paths.length === 0, 'Lease revocation during await published/dispatched a path');
      // Legacy metadata keeps its existing policy; the new projection does not widen it.
      assert((await scoped.refs.resolve({kind: 'codex', documentId: fixture.targetId})).available, 'Opt-in lifetime check changed legacy metadata reads');
      await rejectsWith(() => scoped.refs.resolve({kind: 'codex', documentId: fixture.targetId}, {includePath: true}), 'local_tool_context_expired');
      assert(await fixture.business() === before && JSON.stringify([await db.projects.get(foreignProject), await db.codexEntries.get(foreignId)]) === foreignBefore && fixture.dispatches.length === 0, 'Foreign/lease checks changed own or foreign data/route');
      passed.push('Foreign scope cannot resolve a local destination; lease revoked during effective read rejects opt-in before publishing, with legacy read policy and all data unchanged');
    } finally { await deleteProject(foreignProject); }
  });
  await withFixture('expanded-noemit-fallback', async fixture => {
    const adapter = getAnchorAdapter('codex'); assert(adapter, 'Real Codex adapter absent');
    const paths: string[] = [], client = createLocalToolClient(fixture.projectId, documentNotebook, {navigate: path => paths.push(path)}), before = await fixture.business();
    let calls = 0;
    // Public fixture adapter only: restores the original even on the first failure.
    registerAnchorAdapter({...adapter, navigateToEntity: () => { calls++; }});
    try {
      const resolved = await client.refs.resolve({kind: 'codex', documentId: fixture.targetId}, {includePath: true});
      assert(resolved.available && resolved.title === fixture.targetTitle && resolved.path === null && calls === 1 && paths.length === 0, 'No-emission adapter invented a fallback or dispatched while resolving');
      await client.openDocument('codex', fixture.targetId);
      assert(calls === 2 && paths.length === 0 && await fixture.business() === before, 'No-emission opening changed data or invented navigation');
    } finally { registerAnchorAdapter(adapter); }
    const registered = getAllAnchorAdapters().map(row => row.engineId);
    console.error('REFERENCE_PATH_FALLBACK_ATTRIBUTION ' + JSON.stringify({registered, codexColdStorageExecuted: false, note: 'Normal renderer already bootstraps adapters; no private deregistration or canonical claim for isolated storage fallback'}));
    // The normal bootstrap installs this actual generic fallback adapter for tables.
    const tableId = fixture.projectId + '-table', project = await db.projects.get(fixture.projectId); assert(project, 'Project absent');
    await act(async () => { await db.projects.update(fixture.projectId, {dataTables: [...project.dataTables ?? [], {id: tableId, title: 'Table fallback', mode: 'table', columns: [], rows: []}]}); });
    const fallbackBefore = await fixture.business(), fallback = await client.refs.resolve({kind: 'tables', documentId: tableId}, {includePath: true});
    assert(getAnchorAdapter('tables') && fallback.available && fallback.path === `/project/${fixture.projectId}/tables?entity=${tableId}` && paths.length === 0, 'Registered generic tables fallback projection wrong');
    await client.openDocument('tables', tableId);
    assert(paths.length === 1 && paths[0] === fallback.path && await fixture.business() === fallbackBefore, 'Registered fallback projection differs from current opening or wrote data');
    passed.push('Available/noemit adapter returns path:null and does not navigate; actual registered tables fallback matches existing opening, explicitly no isolated cold Codex/canonical-router claim');
  });
  return passed;
}

export async function testLocalToolReferencePathAll(): Promise<string[]> {
  return [...await testLocalToolReferencePathBaseline(), ...await testLocalToolReferencePathContract(), ...await testLocalToolReferencePathExpanded()];
}

// HTTP preview only. ROOT supplies the HTML/Vite entry and performs the real browser QA.
import {useRef, useState, type MouseEvent, type FormEvent} from 'react';
import {BrowserRouter, Link, useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {readSourceToolDocument} from '@/engines/local/documents/store';

const referencePreviewBasename = '/_stage/sdk-document-links-next/preview';
interface PreviewFixture {
  projectId: string; sourceId: string; targetId: string; targetTitle: string; targetMarker: string; eraId?: string;
  sourceRoute: string; clients: Map<string, LocalToolClient<LinkedNotebookState>>;
}
const previewButton = 'min-h-10 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';

function RoutedPreviewEngine({fixture}: {fixture?: PreviewFixture}) {
  const params = useParams();
  const engines = useMemo(() => [`local-tool-${documentNotebook.namespace}`, 'codex'].map(id => {
    const engine = getEngine(id); assert(engine, `Preview registered engine missing ${id}`); return engine;
  }), [fixture?.projectId]);
  const engine = getEngine(params.tab ?? '');
  if (!fixture || params.id !== fixture.projectId || !engine || !engines.some(item => item.id === engine.id)) return <p>Prepara Base o época para abrir sólo la fixture propia.</p>;
  const Component = engine.component;
  return <ProjectWorkspace projectId={fixture.projectId} engines={engines}><Suspense fallback={<p>Abriendo motor registrado…</p>}>
    <Component key={`${fixture.projectId}:${engine.id}`} projectId={fixture.projectId}/>
  </Suspense></ProjectWorkspace>;
}

function ReferencePathPreview() {
  const navigate = useNavigate(), location = useLocation(), shell = useRef<HTMLDivElement>(null);
  const [fixture, setFixture] = useState<PreviewFixture>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sdk, setSdk] = useState<LocalToolResolvedReference>(), [result, setResult] = useState<Record<string, unknown>>({state: 'Sin fixture propia'});
  const [saveRequest, setSaveRequest] = useState<{revision: number; notes: string}>();
  const stored = useLiveQuery(async () => fixture ? readSourceToolDocument({projectId: fixture.projectId, eraId: fixture.eraId}, fixture.sourceId) : undefined,
    [fixture?.projectId, fixture?.sourceId, fixture?.eraId]);
  const sourceEngineId = `local-tool-${documentNotebook.namespace}`;
  const sourceElement = () => fixture ? shell.current?.querySelector<HTMLElement>(`[data-source-document-host="${fixture.sourceId}"]`) : undefined;
  const sourceNotes = () => sourceElement()?.querySelector<HTMLTextAreaElement>('textarea');
  const currentClient = () => { const client = fixture?.clients.get(fixture.sourceId); assert(client, 'El cliente Source actual todavía no está listo'); return client; };
  const business = async (owner: PreviewFixture) => {
    const tables: Record<string, unknown[]> = {};
    for (const table of db.tables) tables[table.name] = (await table.toArray()).filter(row => row.projectId === owner.projectId || table.name === 'projects' && row.id === owner.projectId)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify(tables);
  };
  const task = async (run: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await run(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    const own = fixture; setFixture(undefined); setSdk(undefined); setSaveRequest(undefined); navigate('/');
    if (own) await deleteProject(own.projectId);
    setResult({state: 'Fixture propia eliminada', deletedProjectId: own?.projectId ?? null});
  };
  const prepare = async (era: boolean) => {
    await clear();
    const projectId = `reference-path-preview-${crypto.randomUUID()}`, targetId = projectId + '-B', clients = new Map<string, LocalToolClient<LinkedNotebookState>>();
    const Original = documentNotebook.component;
    function Observe(props: LocalToolProps<LinkedNotebookState>) {
      useLayoutEffect(() => {
        const id = props.client.documentId; if (!id) return;
        clients.set(id, props.client);
        return () => { if (clients.get(id) === props.client) clients.delete(id); };
      }, [props.client]);
      return <Original {...props}/>;
    }
    registerLocalToolModules({'./installed/examples.document-notebook/module.tsx': {default: defineLocalTool({...documentNotebook, component: Observe})}});
    try {
      await db.projects.put({id: projectId, title: 'SDK1518 · fixture propia', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: [sourceEngineId, 'codex'], engineOrder: [sourceEngineId, 'codex'], createdAt: 1, updatedAt: 1});
      const baseTitle = 'B · Base SDK1518', targetTitle = era ? 'B · Época SDK1518' : baseTitle, targetMarker = era ? 'SDK1518_PAST_BODY' : 'SDK1518_BASE_BODY';
      await db.codexEntries.put({...authorCard(projectId, baseTitle), id: targetId, content: '<p>SDK1518_BASE_BODY</p>'});
      const source = await createSourceToolDocument({projectId}, documentNotebook.namespace, 'A · Cuaderno SDK1518');
      const baseClient = createLocalToolClient(projectId, documentNotebook, {documentId: source.id}), base = await baseClient.read();
      await baseClient.save({...documentNotebook.initialState, notes: 'Notas Base guardadas de la fixture', linked: {kind: 'codex', documentId: targetId}}, base.revision, base.document?.version);
      const eraId = era ? 'past' : undefined;
      if (eraId) {
        await saveWorldEra(projectId, {id: eraId, name: 'Época de prueba SDK1518', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
        const target = await readWorldDocument({projectId, eraId}, 'codex', targetId); assert(target, 'B heredado no está disponible');
        await saveEraDocument({projectId, eraId}, 'codex', {...target.document, root: {...target.document.root, title: targetTitle, content: `<p>${targetMarker}</p>`}}, target.version);
        const eraClient = createLocalToolClient(projectId, documentNotebook, {documentId: source.id, eraId}), inherited = await eraClient.read();
        await eraClient.save({...inherited.data, notes: 'Notas de época guardadas de la fixture'}, inherited.revision, inherited.document?.version);
      }
      const query = new URLSearchParams({document: source.id}); if (eraId) query.set('era', eraId);
      const sourceRoute = `/project/${projectId}/${sourceEngineId}?${query}`;
      setFixture({projectId, sourceId: source.id, targetId, targetTitle, targetMarker, eraId, sourceRoute, clients});
      setResult({state: 'Fixture propia preparada; B todavía sin abrir', projectId, sourceId: source.id, targetId, targetTitle, eraId: eraId ?? null,
        basename: referencePreviewBasename, adapterBeforeB: getAnchorAdapter('codex')?.engineId ?? null});
      navigate(sourceRoute);
    } catch (reason) { await deleteProject(projectId); throw reason; }
  };
  const consult = async (transport: 'SDK' | 'MCP') => {
    assert(fixture, 'Prepara una fixture propia');
    const client = currentClient(), before = await business(fixture), ledger = JSON.stringify(getPendingWritesSnapshot()), route = location.pathname + location.search;
    const draft = sourceNotes()?.value, reference = {kind: 'codex', documentId: fixture.targetId} as const;
    let resolved: LocalToolResolvedReference;
    if (transport === 'SDK') {
      resolved = await client.refs.resolve(reference, {includePath: true}); setSdk(resolved);
    } else {
      const reply = await runBridgeTool('wh_local_tool_reference_resolve', {projectId: fixture.projectId, namespace: documentNotebook.namespace,
        documentId: fixture.sourceId, ...(fixture.eraId ? {eraId: fixture.eraId} : {}), reference, includePath: true});
      assert(reply.ok, `Dispatcher MCP: ${JSON.stringify(reply)}`); resolved = reply.result as LocalToolResolvedReference;
    }
    const after = await business(fixture), current = sourceNotes();
    const diagnostic = {transport, resolved, sdkPath: transport === 'SDK' ? resolved.path : sdk?.path ?? null,
      mcpEqualsSDK: transport === 'MCP' && sdk ? JSON.stringify(resolved) === JSON.stringify(sdk) : null,
      businessExact: before === after, ledgerExact: ledger === JSON.stringify(getPendingWritesSnapshot()), draftBefore: draft ?? null, draftAfter: current?.value ?? null,
      scope: {projectId: client.projectId, namespace: client.namespace, documentId: client.documentId, eraId: client.eraId ?? null},
      routeBefore: route, browserPathAfter: window.location.pathname + window.location.search, targetTitle: fixture.targetTitle,
      targetRendererMounted: !!shell.current?.querySelector('[data-testid="codex-show-cards"]'), saveRequest: saveRequest ?? null};
    setResult(diagnostic);
    assert(resolved.available && resolved.title === fixture.targetTitle && resolved.path && diagnostic.businessExact && diagnostic.ledgerExact && draft === current?.value, 'Consulta no conservó metadata, datos, ledger o notas actuales');
  };
  const captureSave = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null, host = sourceElement();
    if (target && host?.contains(target) && ['Save notes', 'Guardar notas'].includes(target.textContent?.trim() ?? '') && stored) {
      const notes = sourceNotes(); if (notes && !notes.disabled) setSaveRequest({revision: stored.document.revision, notes: notes.value});
    }
  };
  const invalidateSave = (event: FormEvent<HTMLDivElement>) => { if (event.target === sourceNotes()) setSaveRequest(undefined); };
  const saveConfirmed = !!saveRequest && !!stored && stored.document.revision > saveRequest.revision && (stored.document.data as LinkedNotebookState).notes === saveRequest.notes;
  const readyLink = !!fixture && location.pathname + location.search === fixture.sourceRoute && saveConfirmed && typeof sdk?.path === 'string';
  return <div ref={shell} className="space-y-4 p-5 text-text-primary" onClickCapture={captureSave} onInputCapture={invalidateSave}>
    <h1 className="font-display text-xl">SDK · Rutas documentales</h1>
    <p>Fixture propia con Source y Códex reales. Escribe notas y pulsa Guardar notas / Save notes en el cuaderno antes de activar el enlace. Consultar sólo lee; el enlace usa el path recibido del SDK.</p>
    <div className="flex flex-wrap gap-2">
      <button className={previewButton} disabled={busy} onClick={() => void task(() => prepare(false))}>Preparar Base</button>
      <button className={previewButton} disabled={busy} onClick={() => void task(() => prepare(true))}>Preparar época</button>
      <button className={previewButton} disabled={busy || !fixture} onClick={() => void task(() => consult('SDK'))}>Consultar SDK</button>
      <button className={previewButton} disabled={busy || !fixture} onClick={() => void task(() => consult('MCP'))}>Consultar MCP</button>
      <button className={previewButton} disabled={busy || !fixture} onClick={() => void task(clear)}>Limpiar</button>
      {readyLink ? <Link data-testid="reference-path-sdk-link" className={previewButton} to={sdk!.path!}>Abrir B desde SDK</Link> : <span>El enlace requiere consulta SDK y Save normal confirmado.</span>}
    </div>
    {error && <p role="alert">{error}</p>}
    <output data-testid="reference-path-preview-route">{location.pathname}{location.search}</output>
    <pre data-testid="reference-path-preview-json" className="whitespace-pre-wrap break-words">{JSON.stringify({...result, currentRoute: location.pathname + location.search, explicitSaveConfirmed: saveConfirmed}, null, 2)}</pre>
    <Routes><Route path="/project/:id/:tab" element={<RoutedPreviewEngine fixture={fixture}/>}/><Route path="*" element={<p>Prepara la fixture propia para empezar.</p>}/></Routes>
  </div>;
}

/** Root-owned HTTP preview entry: no server/package/pin setup and no global locale mutation. */
export function mountLocalToolReferencePathPreview(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<BrowserRouter basename={referencePreviewBasename}><ReferencePathPreview/></BrowserRouter>);
  return () => root.unmount();
}
