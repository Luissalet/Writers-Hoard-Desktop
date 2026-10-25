import '@/engines';
import {act, Suspense, useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getEngine} from '@/engines/_registry';
import {registerLocalToolModules} from '@/engines/local/registry';
import {defineLocalTool, type LocalToolClient, type LocalToolProps} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import documentNotebook from '@/engines/local/examples/documentNotebookDefinition';
import type {LinkedNotebookState} from '@/engines/local/examples/LinkedNotebook';
import initiative from '@/engines/local/examples/initiativeDefinition';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock} from '@/engines/local/blocks/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {workspaceDocumentKey} from '@/components/project/workspace/library/types';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {authorCard} from './fixtures/local-tools/author-data';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (predicate()) return;
    await act(async () => { await pause(); });
  }
  throw new Error(`${message}; ledger=${JSON.stringify(getPendingWritesSnapshot())}; dialogs=${JSON.stringify([...document.querySelectorAll('[role="dialog"] h2')].map(node => node.textContent))}`);
}
function node<T extends Element = HTMLElement>(selector: string, within: ParentNode = document): T {
  const found = within.querySelector<T>(selector); assert(found, `Missing ${selector}`); return found;
}
function button(within: ParentNode, text: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text);
  assert(found, `Missing button ${text}`); return found;
}
async function click(control: HTMLElement) { await act(async () => { control.click(); await pause(); }); }
function dialogInPane(paneId: string, title: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(dialog => dialog.parentElement?.dataset.enginePaneId === paneId && dialog.querySelector('h2')?.textContent === title);
}
const main = () => node<HTMLElement>('[data-testid="workspace-primary"]');
const mainLocation = () => node('[data-testid="beside-main-location"]').textContent;
const activeCompanion = () => document.querySelector<HTMLElement>('[data-testid^="workspace-panel-"]:not([hidden])');
function sourceHost(within: ParentNode, id: string) { return within.querySelector<HTMLElement>(`[data-source-document-host="${id}"]`); }
function sourceState(within: ParentNode, id: string) {
  const host = sourceHost(within, id), textarea = host?.querySelector<HTMLTextAreaElement>('textarea');
  return {host, textarea, documentId: host?.dataset.sourceDocumentHost ?? null, ready: !!textarea && !textarea.disabled,
    value: textarea?.value ?? null, sharedBase: host?.querySelector('section[aria-label="Linked notebook"] header span')?.textContent === 'Shared base'};
}
async function readySource(within: ParentNode, id: string) {
  await until(() => sourceState(within, id).ready, 'Current Source textarea did not become ready');
  return sourceState(within, id);
}

interface Fixture {
  projectId: string; sourceId: string; sourceEngineId: string; sourceRoute: string;
  targetId: string; targetTitle: string; targetMarker: string; targetRoute: string;
  ownerId: string; ownerTitle: string; blockId: string;
  emitted: Map<string, LocalToolClient<LinkedNotebookState>>;
  business(): Promise<string>;
}

async function withFixture<T>(label: string, observeClient: boolean, run: (fixture: Fixture) => Promise<T>): Promise<T> {
  const projectId = `beside-${label}-${crypto.randomUUID()}`, targetId = `${projectId}-target`, ownerId = `${projectId}-owner`;
  const targetTitle = `Target B ${label}`, targetMarker = `EFFECTIVE_TARGET_${targetId}`, ownerTitle = `Owner O ${label}`, blockId = `${projectId}-world-cards`;
  const emitted = new Map<string, LocalToolClient<LinkedNotebookState>>();
  const Original = documentNotebook.component;
  function Observe(props: LocalToolProps<LinkedNotebookState>) {
    useLayoutEffect(() => {
      const id = props.client.documentId; if (!id) return;
      emitted.set(id, props.client);
      return () => { if (emitted.get(id) === props.client) emitted.delete(id); };
    }, [props.client]);
    return <Original {...props}/>;
  }
  const definition = observeClient ? defineLocalTool({...documentNotebook, component: Observe}) : documentNotebook;
  registerLocalToolModules({
    './installed/examples.document-notebook/module.tsx': {default: definition},
    './installed/examples.initiative/module.tsx': {default: initiative},
  });
  const sourceEngineId = `local-tool-${documentNotebook.namespace}`;
  const engineIds = [sourceEngineId, 'codex', `local-tool-${initiative.namespace}`];
  const engines = engineIds.map(id => { const engine = getEngine(id); assert(engine, `Registered engine missing ${id}`); return engine; });
  const root = createRoot(node('#root'));
  useLocaleStore.setState({locale: 'en', loaded: true});
  try {
    await db.projects.put({id: projectId, title: `Beside ${label}`, description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: engineIds, engineOrder: engineIds, createdAt: 1, updatedAt: 1});
    const worldBlock = initiative.blocks?.find(block => block.key === 'cards'); assert(worldBlock, 'Original world cards block absent');
    await db.codexEntries.bulkPut([
      {...authorCard(projectId, targetTitle), id: targetId, content: `<p>${targetMarker}</p>`},
      {...authorCard(projectId, ownerTitle), id: ownerId, content: '<p>Owner prose remains exact.</p>' + serializeLocalToolBlock(projectId, createLocalToolBlockEnvelope(initiative.namespace, worldBlock, blockId))},
    ]);
    const source = await createSourceToolDocument({projectId}, documentNotebook.namespace, `Source A ${label}`);
    const initialClient = createLocalToolClient(projectId, documentNotebook, {documentId: source.id});
    const initial = await initialClient.read();
    await initialClient.save({...documentNotebook.initialState, notes: `Saved Source A ${label}`, linked: {kind: 'codex', documentId: targetId}}, initial.revision, initial.document?.version);
    const sourceRoute = `/project/${projectId}/${sourceEngineId}?document=${source.id}`;
    const targetRoute = `/project/${projectId}/codex?entry=${targetId}`;
    // This principal changes its actual registered engine when the router changes.
    // ProjectWorkspace owns companion routing; the test supplies no navigate callback.
    function RoutedWorkspace() {
      const location = useLocation(), params = useParams();
      const engine = getEngine(params.tab ?? ''); assert(engine && engineIds.includes(engine.id), 'Principal route has no enabled real engine');
      const Component = engine.component;
      return <><output data-testid="beside-main-location">{location.pathname}{location.search}</output>
        <ProjectWorkspace projectId={projectId} engines={engines}>
          <Suspense fallback={<p>Loading registered principal</p>}><Component key={`${projectId}:${engine.id}`} projectId={projectId}/></Suspense>
        </ProjectWorkspace></>;
    }
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[sourceRoute]}><Routes><Route path="/project/:id/:tab" element={<RoutedWorkspace/>}/></Routes></MemoryRouter>);
      await pause();
    });
    await until(() => !!sourceHost(main(), source.id)?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)') && !button(sourceHost(main(), source.id)!, 'Open linked document').disabled, 'Real documentary LinkedNotebook did not become ready');
    const fixture: Fixture = {
      projectId, sourceId: source.id, sourceEngineId, sourceRoute, targetId, targetTitle, targetMarker, targetRoute, ownerId, ownerTitle, blockId, emitted,
      business: async () => JSON.stringify({project: await db.projects.get(projectId), cards: (await db.codexEntries.where('projectId').equals(projectId).toArray()).sort((left, right) => left.id.localeCompare(right.id))}),
    };
    return await run(fixture);
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    emitted.clear(); await deleteProject(projectId);
  }
}

async function openFromLibrary(fixture: Fixture, engineId: string, id: string, placement: 'main' | 'beside') {
  await click(node('[data-testid="workspace-library-open"]'));
  const key = workspaceDocumentKey({engineId: engineId as 'codex', entityId: id});
  const row = () => [...document.querySelectorAll<HTMLElement>('[data-library-document]')].find(item => item.dataset.libraryDocument === key);
  await until(() => !!row(), `Library did not list ${key}`);
  await click(node<HTMLButtonElement>(`[data-library-open="${placement}"]`, row()!));
  await until(() => !document.querySelector('[data-testid="workspace-library"]'), 'Library did not finish normal opening');
}
async function waitForTarget(fixture: Fixture, placement: 'main' | 'companion') {
  await until(() => {
    const surface = placement === 'main' ? main() : activeCompanion();
    if (!surface) return false;
    const dialog = dialogInPane(surface.dataset.enginePaneId!, fixture.targetTitle);
    return !!surface.querySelector('[data-testid="codex-show-cards"]') && !!dialog?.textContent?.includes(fixture.targetMarker);
  }, `Real target B did not render in ${placement}`);
}

export async function testLocalToolBesideBaseline(): Promise<string[]> {
  const passed: string[] = [];
  try {
    await withFixture('departure', false, async fixture => {
      const before = await fixture.business();
      await click(button(sourceHost(main(), fixture.sourceId)!, 'Open linked document'));
      await waitForTarget(fixture, 'main');
      assert(mainLocation() === fixture.targetRoute && !sourceHost(main(), fixture.sourceId), 'Abrir must retarget the actual principal route and unmount Source A');
      assert(await fixture.business() === before, 'Departure changed business documents');
    });
    passed.push('Abrir actual: real principal Source A unmounts, main route becomes B, registered Codex renders effective B without business writes');

    await withFixture('library', false, async fixture => {
      const before = await fixture.business(), host = sourceHost(main(), fixture.sourceId)!, textarea = node<HTMLTextAreaElement>('textarea', host), value = textarea.value;
      await openFromLibrary(fixture, 'codex', fixture.targetId, 'beside');
      await waitForTarget(fixture, 'companion');
      const current = await readySource(main(), fixture.sourceId), currentHost = current.host, currentTextarea = current.textarea;
      console.error('LIBRARY_BASELINE_DIAGNOSTIC ' + JSON.stringify({
        route: mainLocation(), expectedRoute: fixture.sourceRoute, routeExact: mainLocation() === fixture.sourceRoute,
        sameHost: currentHost === host, oldHostConnected: host.isConnected, currentHostConnected: currentHost?.isConnected ?? false,
        sameTextarea: currentTextarea === textarea, oldTextareaConnected: textarea.isConnected, currentTextareaConnected: currentTextarea?.isConnected ?? false,
        oldValueBefore: value, oldValueNow: textarea.value, currentValue: currentTextarea?.value ?? null,
        oldDisabled: textarea.disabled, currentDisabled: currentTextarea?.disabled ?? null,
        currentHostPresent: !!currentHost, currentTextareaPresent: !!currentTextarea,
        currentOpenDisabled: currentHost ? [...currentHost.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Open linked document')?.disabled ?? null : null,
        capturedClient: fixture.emitted.get(fixture.sourceId) ? 'present' : null,
        currentDocumentId: current.documentId, expectedDocumentId: fixture.sourceId, sharedBase: current.sharedBase,
      }));
      assert(mainLocation() === fixture.sourceRoute, 'Normal Library beside changed the principal Source route');
      assert(current.documentId === fixture.sourceId && current.sharedBase, 'Normal Library beside changed logical Source document/scope');
      assert(current.value === value, `Normal Library beside changed ready current Source content: ${JSON.stringify({expected: value, actual: current.value})}`);
      assert(await fixture.business() === before, 'Library consultation changed business documents');
    });
    passed.push('Biblioteca lateral actual: main route/logical Source A/Base/ready content preserved, effective B in real companion, business documents exact; DOM identity is diagnostic only');

    await withFixture('owned', false, async fixture => {
      await openFromLibrary(fixture, 'codex', fixture.ownerId, 'main');
      await until(() => !!dialogInPane(main().dataset.enginePaneId!, fixture.ownerTitle), 'Normal owner O detail did not open');
      await click(button(dialogInPane(main().dataset.enginePaneId!, fixture.ownerTitle)!, 'Edit'));
      const ownerDialog = () => dialogInPane(main().dataset.enginePaneId!, 'Edit Entry');
      await until(() => !!ownerDialog()?.querySelector(`[data-source-block-id="${fixture.blockId}"] button`) && !!ownerDialog()?.querySelector('.ProseMirror'), 'Real editor O and its world cards source block did not mount');
      const editor = node('.ProseMirror', ownerDialog()!), block = node(`[data-source-block-id="${fixture.blockId}"]`, ownerDialog()!), before = await fixture.business(), route = mainLocation();
      await until(() => [...block.querySelectorAll('button')].some(item => item.textContent === fixture.targetTitle), 'Real WorldCardList did not resolve target B');
      const editorText = editor.textContent;
      await click(button(block, fixture.targetTitle));
      await waitForTarget(fixture, 'companion');
      await until(() => !!ownerDialog()?.querySelector('.ProseMirror[contenteditable="true"]') && [...(ownerDialog()?.querySelectorAll(`[data-source-block-id="${fixture.blockId}"] button`) ?? [])].some(item => item.textContent === fixture.targetTitle), 'Current logical owner editor did not become ready');
      const currentEditor = ownerDialog()?.querySelector('.ProseMirror'), currentBlock = ownerDialog()?.querySelector(`[data-source-block-id="${fixture.blockId}"]`);
      const actual = {route: mainLocation(), expectedRoute: route, ownerId: new URLSearchParams((mainLocation() ?? '').split('?')[1]).get('entry'), expectedOwnerId: fixture.ownerId,
        baseScope: !new URLSearchParams((mainLocation() ?? '').split('?')[1]).has('era'), editorReady: !!currentEditor, blockPresent: !!currentBlock,
        content: currentEditor?.textContent, expectedContent: editorText, sameEditorDiagnostic: currentEditor === editor, oldEditorConnected: editor.isConnected};
      console.error('OWNED_BASELINE_DIAGNOSTIC ' + JSON.stringify(actual));
      assert(actual.route === route && actual.ownerId === fixture.ownerId && actual.baseScope, `Owned consultation changed logical owner/scope: ${JSON.stringify(actual)}`);
      assert(actual.editorReady && actual.blockPresent && actual.content === editorText, `Owned consultation changed current ready owner content: ${JSON.stringify(actual)}`);
      assert(await fixture.business() === before, 'Owned consultation changed business documents');
    });
    passed.push('Owned lateral actual: real Codex logical owner O/Base/current editor content preserved while B opens in companion, without business writes');

    await withFixture('companion', false, async fixture => {
      await openFromLibrary(fixture, fixture.sourceEngineId, fixture.sourceId, 'beside');
      await until(() => !!activeCompanion() && !!sourceHost(activeCompanion()!, fixture.sourceId)?.querySelector('textarea:not(:disabled)'), 'Documentary Source A did not mount in real companion');
      const panel = activeCompanion()!, paneId = panel.dataset.enginePaneId!, host = sourceHost(panel, fixture.sourceId)!, textarea = node<HTMLTextAreaElement>('textarea', host), draft = 'Unsubmitted companion note retained', before = await fixture.business();
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, draft); textarea.dispatchEvent(new Event('input', {bubbles: true})); await pause(); });
      assert(textarea.value === draft && !button(sourceHost(panel, fixture.sourceId)!, 'Save notes').disabled, 'Source companion draft input was not accepted by the actual LinkedNotebook');
      await click(button(host, 'Open linked document'));
      await waitForTarget(fixture, 'companion');
      const hiddenCurrent = await readySource(panel, fixture.sourceId), hiddenActual = {paneId, panelHidden: panel.hidden, panelInert: panel.hasAttribute('inert'), documentId: hiddenCurrent.documentId,
        expectedDocumentId: fixture.sourceId, sharedBase: hiddenCurrent.sharedBase, currentDraft: hiddenCurrent.value, expectedDraft: draft,
        sameTextareaDiagnostic: hiddenCurrent.textarea === textarea, oldTextareaConnected: textarea.isConnected, mainRoute: mainLocation(), expectedMainRoute: fixture.sourceRoute,
        businessExact: await fixture.business() === before};
      console.error('COMPANION_HIDDEN_DIAGNOSTIC ' + JSON.stringify(hiddenActual));
      assert(hiddenActual.panelHidden && hiddenActual.panelInert && hiddenActual.documentId === fixture.sourceId && hiddenActual.sharedBase, `Cross-engine Abrir changed Source pane/logical document/scope: ${JSON.stringify(hiddenActual)}`);
      assert(hiddenActual.currentDraft === draft, `Cross-engine Abrir must retain the exact pending Source draft: ${JSON.stringify(hiddenActual)}`);
      assert(hiddenActual.businessExact, `Cross-engine consultation changed business documents: ${JSON.stringify(hiddenActual)}`);
      await click(node(`[data-testid="workspace-tab-${paneId}"]`));
      await until(() => activeCompanion() === panel, 'Returning to original Source companion failed');
      const returned = await readySource(panel, fixture.sourceId), returnedActual = {paneId: activeCompanion()?.dataset.enginePaneId, expectedPaneId: paneId, documentId: returned.documentId,
        expectedDocumentId: fixture.sourceId, sharedBase: returned.sharedBase, currentDraft: returned.value, expectedDraft: draft, mainRoute: mainLocation(), expectedMainRoute: fixture.sourceRoute,
        businessExact: await fixture.business() === before};
      console.error('COMPANION_RETURN_DIAGNOSTIC ' + JSON.stringify(returnedActual));
      assert(returnedActual.paneId === paneId && returnedActual.documentId === fixture.sourceId && returnedActual.sharedBase && mainLocation() === fixture.sourceRoute, `Returning changed Source pane/document/scope/main route: ${JSON.stringify(returnedActual)}`);
      assert(returnedActual.currentDraft === draft, `Returning lost the exact pending Source draft: ${JSON.stringify(returnedActual)}`);
      assert(returnedActual.businessExact, `Returning changed business documents: ${JSON.stringify(returnedActual)}`);
    });
    passed.push('Companion cross-engine actual: Source A remains logically scoped in the same hidden/inert pane with exact pending draft and returns with exact draft/business data; no third visible pane promised');
    return passed;
  } catch (error) {
    throw new Error(`Baseline stopped; completed=${JSON.stringify(passed)}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}

export async function testLocalToolBesideContract(): Promise<string[]> {
  return withFixture('contract', true, async fixture => {
    await until(() => fixture.emitted.has(fixture.sourceId), 'Actual documentary host did not emit its client');
    const host = sourceHost(main(), fixture.sourceId)!, textarea = node<HTMLTextAreaElement>('textarea', host), value = textarea.value, before = await fixture.business();
    const client = fixture.emitted.get(fixture.sourceId)!;
    await act(async () => { await Reflect.apply(client.openDocument, client, ['codex', fixture.targetId, {placement: 'beside'}]); await pause(); });
    await until(() => {
      const beside = activeCompanion();
      return mainLocation() === fixture.targetRoute || !!beside && !!dialogInPane(beside.dataset.enginePaneId!, fixture.targetTitle)?.textContent?.includes(fixture.targetMarker);
    }, 'Requested placement neither departed nor produced a real target companion');
    if (mainLocation() === fixture.sourceRoute) await readySource(main(), fixture.sourceId);
    const companion = activeCompanion(), current = sourceState(main(), fixture.sourceId), actual = {
      mainRoute: mainLocation(), expectedSourceRoute: fixture.sourceRoute,
      currentDocumentId: current.documentId, expectedDocumentId: fixture.sourceId, currentReady: current.ready, sharedBase: current.sharedBase,
      currentValue: current.value, expectedValue: value,
      sameSourceHost: sourceHost(main(), fixture.sourceId) === host,
      sameTextarea: host.isConnected && host.querySelector('textarea') === textarea,
      sameValue: textarea.value === value,
      companionId: companion?.dataset.enginePaneId ?? null,
      effectiveTargetInCompanion: !!companion && !!dialogInPane(companion.dataset.enginePaneId!, fixture.targetTitle)?.textContent?.includes(fixture.targetMarker),
      businessExact: await fixture.business() === before,
    };
    assert(actual.businessExact, `Placement consultation changed business data: ${JSON.stringify(actual)}`);
    assert(actual.mainRoute === fixture.sourceRoute, `Source principal must retain route A for explicit beside: ${JSON.stringify(actual)}`);
    assert(actual.currentDocumentId === fixture.sourceId && actual.sharedBase && actual.currentReady && actual.currentValue === value, `Explicit beside must preserve ready logical Source A/scope/content: ${JSON.stringify(actual)}`);
    assert(actual.effectiveTargetInCompanion, `Explicit beside must render effective B through normal companion: ${JSON.stringify(actual)}`);
    return ['Explicit beside through the real documentary client preserves principal route/logical Source A/Base/ready content and renders effective B in the normal companion, without business writes; DOM identity is diagnostic only'];
  });
}


// Additive UI/route coverage. Everything above remains the exact cc7 historical oracle.
import {LocalToolReferencePicker} from '@/engines/local/ReferencePicker';
import {saveWorldEra, readWorldDocument, hideEraDocument} from '@/services/worldEras/store';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import type {LocalToolResolvedReference} from '@/engines/local/references';

async function rejected(run: () => Promise<unknown>, expected: string) {
  let reason = ''; try { await run(); } catch (error) { reason = String(error); }
  assert(reason.includes(expected), `Expected ${expected}, received ${reason || 'success'}`);
}

const uiChannel = window as unknown as {__want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number};
let uiSequence = 0;
async function capturePicker(fixture: Fixture, locale: 'es' | 'en', phase: string) {
  for (const width of [1280, 390]) {
    const n = ++uiSequence;
    await act(async () => { uiChannel.__want = {n, w: width, h: 1000}; await pause(); });
    await until(() => uiChannel.__sizeAck === n, 'Product CSS runner did not resize');
    await readySource(main(), fixture.sourceId);
    await until(() => {
      const current = sourceState(main(), fixture.sourceId), controls = [...(current.host?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const currentOpen = controls.find(control => control.textContent?.trim() === (locale === 'es' ? 'Abrir' : 'Open linked document'));
      const currentBeside = controls.find(control => control.textContent?.trim() === (locale === 'es' ? 'Ver al lado' : 'Open beside'));
      const currentReference = current.host?.querySelector('section[aria-label="Local reference"] span[draggable="true"], section[aria-label="Referencia local"] span[draggable="true"]');
      return current.ready && !!currentOpen && !currentOpen.disabled && !!currentBeside && !currentBeside.disabled && currentReference?.textContent === fixture.targetTitle;
    }, 'Current Source picker did not become ready and resolve B after resize');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, `Picker page overflow at ${width}`);
    if (phase === 'before') {
      const host = sourceHost(main(), fixture.sourceId)!, open = button(host, locale === 'es' ? 'Abrir' : 'Open linked document'), beside = button(host, locale === 'es' ? 'Ver al lado' : 'Open beside');
      beside.scrollIntoView({block: 'center', inline: 'nearest'});
      const a = getComputedStyle(open), b = getComputedStyle(beside), rect = beside.getBoundingClientRect();
      const diagnoseFocus = (stage: string) => {
        const active = document.activeElement;
        const currentHost = sourceHost(main(), fixture.sourceId), currentControls = [...(currentHost?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const currentOpen = currentControls.find(control => control.textContent?.trim() === (locale === 'es' ? 'Abrir' : 'Open linked document'));
        const currentBeside = currentControls.find(control => control.textContent?.trim() === (locale === 'es' ? 'Ver al lado' : 'Open beside'));
        const outline = (element: Element, pseudo?: string) => { const style = getComputedStyle(element, pseudo); return {width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, offset: style.outlineOffset}; };
        console.error('PICKER_CSS_FOCUS_DIAGNOSTIC ' + JSON.stringify({stage, locale, phase, width, innerWidth, innerHeight,
          documentHasFocus: document.hasFocus(), active: active?.outerHTML ?? null, activeIsOpen: active === open, activeIsBeside: active === beside,
          capturedOpenDisabled: open.disabled, capturedBesideDisabled: beside.disabled, capturedOpenConnected: open.isConnected, capturedBesideConnected: beside.isConnected,
          currentOpenDisabled: currentOpen?.disabled ?? null, currentBesideDisabled: currentBeside?.disabled ?? null, currentOpenConnected: currentOpen?.isConnected ?? false, currentBesideConnected: currentBeside?.isConnected ?? false,
          currentOpenSameNodeDiagnostic: currentOpen === open, currentBesideSameNodeDiagnostic: currentBeside === beside, currentHostSameNodeDiagnostic: currentHost === host,
          currentSourceReady: sourceState(main(), fixture.sourceId).ready, currentResolvedTitle: currentHost?.querySelector('span[draggable="true"]')?.textContent ?? null,
          openFocus: open.matches(':focus'), openFocusVisible: open.matches(':focus-visible'), besideFocus: beside.matches(':focus'), besideFocusVisible: beside.matches(':focus-visible'),
          besideOutline: outline(beside), beforePseudoOutline: outline(beside, '::before'), afterPseudoOutline: outline(beside, '::after'),
          openOutline: outline(open), besideRect: beside.getBoundingClientRect().toJSON(), openRect: open.getBoundingClientRect().toJSON(), hostRect: host.getBoundingClientRect().toJSON(),
          nativeAck: uiChannel.__nativeAck ?? null}));
      };
      diagnoseFocus('before-layout-assertions');
      assert(rect.height >= 40 && rect.left >= 0 && rect.right <= innerWidth + 1, 'Beside control is clipped or below native control height');
      assert(a.backgroundColor === b.backgroundColor && a.color === b.color && a.borderColor === b.borderColor && a.fontSize === b.fontSize, 'Beside action differs from native Open palette/type');
      open.focus();
      const nativeSequence = ++uiSequence;
      await act(async () => { uiChannel.__native = {n: nativeSequence, events: [{type: 'keyDown', keyCode: 'Tab'}, {type: 'keyUp', keyCode: 'Tab'}]}; await pause(); });
      await until(() => uiChannel.__nativeAck === nativeSequence, 'Product CSS runner did not acknowledge native Tab');
      diagnoseFocus('after-native-tab-before-focus-assertion');
      if (document.hasFocus()) {
        assert(document.activeElement === beside && beside.matches(':focus-visible') && parseFloat(getComputedStyle(beside).outlineWidth) >= 2, 'Beside keyboard focus is not visible');
      } else {
        assert(document.activeElement === beside, 'Native Tab did not reach beside in the unfocused document');
        console.error('SKIP_FOCO_VISUAL_DOCUMENTO_UNFOCUSED ' + JSON.stringify({locale, width, documentHasFocus: false, nativeTabReachedBeside: true, evidence: 'Visual focus is checked separately in real Brave; hidden-window pseudo-focus is not certified here'}));
      }
      const focusedRect = beside.getBoundingClientRect();
      assert(focusedRect.top >= 0 && focusedRect.bottom <= innerHeight + 1, 'Focused beside control is not vertically visible');
    }
    const name = `local-tool-beside-${locale}-${phase}-${width}`;
    await act(async () => { uiChannel.__shot = {name}; await pause(); });
    await until(() => uiChannel.__shotDone === name, 'Product CSS runner did not capture');
  }
}

async function pickerFlow(css: boolean): Promise<string[]> {
  const passed: string[] = [];
  for (const locale of ['en', 'es'] as const) {
    await withFixture(`picker-${locale}`, true, async fixture => {
      await act(async () => { useLocaleStore.setState({locale, loaded: true}); await pause(); });
      const openLabel = locale === 'es' ? 'Abrir' : 'Open linked document', besideLabel = locale === 'es' ? 'Ver al lado' : 'Open beside';
      await until(() => {
        const host = sourceHost(main(), fixture.sourceId);
        return !!host && [...host.querySelectorAll<HTMLButtonElement>('button')].some(control => control.textContent === besideLabel && !control.disabled) && fixture.emitted.has(fixture.sourceId);
      }, 'Real localized picker did not resolve B');
      const host = sourceHost(main(), fixture.sourceId)!, textarea = node<HTMLTextAreaElement>('textarea', host), draft = `Unsubmitted ${locale} principal notes remain here`;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, draft); textarea.dispatchEvent(new Event('input', {bubbles: true})); await pause(); });
      assert(!button(host, locale === 'es' ? 'Guardar notas' : 'Save notes').disabled && textarea.value === draft, 'Real principal did not accept pending draft');
      assert(button(host, openLabel).className === button(host, besideLabel).className, 'Beside does not reuse existing Open control style');
      const before = await fixture.business(), previousClient = fixture.emitted.get(fixture.sourceId)!;
      if (css) await capturePicker(fixture, locale, 'before');
      await click(button(sourceHost(main(), fixture.sourceId)!, besideLabel));
      await waitForTarget(fixture, 'companion');
      if (css) {
        const reply = await runBridgeTool('wh_local_tool_reference_resolve', {projectId: fixture.projectId, namespace: documentNotebook.namespace, reference: {kind: 'codex', documentId: fixture.targetId}});
        assert(reply.ok, `Normal reference-resolve dispatcher failed: ${JSON.stringify(reply)}`);
        const resolved = reply.result as LocalToolResolvedReference, companion = activeCompanion();
        const targetVisible = !!companion && !!dialogInPane(companion.dataset.enginePaneId!, fixture.targetTitle)?.textContent?.includes(fixture.targetMarker);
        const sourceScopeExact = mainLocation() === fixture.sourceRoute && sourceHost(main(), fixture.sourceId)?.dataset.sourceDocumentHost === fixture.sourceId && !new URLSearchParams((mainLocation() ?? '').split('?')[1]).has('era');
        console.error('PICKER_CSS_REFERENCE_CORRELATION ' + JSON.stringify({projectId: fixture.projectId, namespace: documentNotebook.namespace, sourceId: fixture.sourceId, sourceRoute: mainLocation(), sourceScopeExact, targetVisible, resolved}));
        assert(resolved?.reference?.kind === 'codex' && resolved.reference.documentId === fixture.targetId && resolved.title === fixture.targetTitle && resolved.available === true && resolved.provenance === 'base' && targetVisible && sourceScopeExact, 'Normal reference resolver disagrees with visible B or principal Source/Base scope');
      }
      const current = await readySource(main(), fixture.sourceId), actual = {route: mainLocation(), expectedRoute: fixture.sourceRoute, documentId: current.documentId,
        ready: current.ready, draft: current.value, expectedDraft: draft, base: current.host?.querySelector('header span')?.textContent, businessExact: await fixture.business() === before};
      console.error('PICKER_FLOW_DIAGNOSTIC ' + JSON.stringify({locale, ...actual}));
      console.error('PICKER_BUSINESS_DIAGNOSTIC ' + JSON.stringify({before: JSON.parse(before), after: JSON.parse(await fixture.business())}));
      assert(actual.route === fixture.sourceRoute && actual.documentId === fixture.sourceId && actual.ready && actual.draft === draft && actual.base === (locale === 'es' ? 'Base compartida' : 'Shared base'), `Picker changed logical Source/draft/scope: ${JSON.stringify(actual)}`);
      const postFlush = await fixture.business(), beforeData = JSON.parse(before), afterData = JSON.parse(postFlush);
      const sourceBefore = beforeData.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      const sourceAfter = afterData.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      assert(sourceBefore && sourceAfter, 'Flush lost the logical Source document');
      assert(sourceAfter.data.notes === draft && sourceAfter.revision === sourceBefore.revision + 1, 'Normal beside flush did not persist exactly the pending notes in one revision');
      assert(sourceAfter.updatedAt === afterData.project.updatedAt && sourceAfter.updatedAt >= sourceBefore.updatedAt && afterData.project.updatedAt >= beforeData.project.updatedAt, 'Normal flush timestamps diverged or moved backwards');
      const normalized = structuredClone(afterData), normalizedSource = normalized.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      normalizedSource.data.notes = sourceBefore.data.notes; normalizedSource.revision = sourceBefore.revision;
      normalizedSource.updatedAt = sourceBefore.updatedAt; normalized.project.updatedAt = beforeData.project.updatedAt;
      assert(JSON.stringify(normalized) === before, 'Beside flush changed business fields beyond Source notes/revision and Source/project timestamps');
      assert(button(sourceHost(main(), fixture.sourceId)!, locale === 'es' ? 'Guardar notas' : 'Save notes').disabled, 'Normally flushed notes still appear unsaved');
      await until(() => !!fixture.emitted.get(fixture.sourceId) && fixture.emitted.get(fixture.sourceId) !== previousClient, 'Navigation change did not emit a current Source client');
      await rejected(() => previousClient.openDocument('codex', fixture.targetId, {placement: 'beside'}), 'local_tool_context_expired');
      assert(mainLocation() === fixture.sourceRoute && await fixture.business() === postFlush, 'Expired Source client changed post-flush route/data');
      if (css) await capturePicker(fixture, locale, 'after');
    });
    passed.push(`Real ${locale} picker beside keeps principal logical A/Base/ready exact pending notes flushed and preserved with only normal save metadata changes while normal Codex B opens; previous navigation client remains revoked`);
  }
  return passed;
}

export async function testLocalToolBesidePicker(): Promise<string[]> { return pickerFlow(false); }

export async function testLocalToolBesideRoutes(): Promise<string[]> {
  return withFixture('routes', false, async fixture => {
    const eraId = 'past', scope = {projectId: fixture.projectId, eraId};
    await saveWorldEra(fixture.projectId, {id: eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
    const sourceB = await createSourceToolDocument({projectId: fixture.projectId}, documentNotebook.namespace, 'Source B');
    const worldId = 'imported-world-' + fixture.projectId, waypointId = 'imported waypoint & ' + fixture.projectId;
    await db.generatedWorlds.put({id: worldId, projectId: fixture.projectId, title: 'Stored world owner', params: {...DEFAULT_PARAMS}, createdAt: 1, updatedAt: 1});
    await db.worldWaypoints.put({id: waypointId, projectId: fixture.projectId, worldId, name: 'Stored harbour', color: '#777777', u: .3, v: .4, createdAt: 1, updatedAt: 1});
    const hiddenId = fixture.projectId + '-hidden'; await db.codexEntries.put({...authorCard(fixture.projectId, 'Hidden in Past'), id: hiddenId});
    await hideEraDocument(scope, 'codex', hiddenId, (await readWorldDocument(scope, 'codex', hiddenId))!.version);
    const business = async () => JSON.stringify({project: await db.projects.get(fixture.projectId), cards: await db.codexEntries.where('projectId').equals(fixture.projectId).sortBy('id'),
      worlds: await db.generatedWorlds.where('projectId').equals(fixture.projectId).sortBy('id'), waypoints: await db.worldWaypoints.where('projectId').equals(fixture.projectId).sortBy('id'), variants: await db.worldEraVariants.where('projectId').equals(fixture.projectId).sortBy('id')});
    const before = await business(), beside: string[] = [], mainPaths: string[] = [];
    // These ports record final route contracts only; they never create or route panes.
    const client = createLocalToolClient(fixture.projectId, documentNotebook, {eraId, readOnly: true, navigate: path => mainPaths.push(path), openBeside: path => beside.push(path)});
    const prefix = `/project/${fixture.projectId}`;
    for (const [kind, id, expected] of [
      ['local-tool', sourceB.id, `${prefix}/local-tool-${documentNotebook.namespace}?document=${sourceB.id}&era=past`],
      ['codex', fixture.targetId, `${prefix}/codex?entry=${fixture.targetId}&era=past`],
      ['worldgen', worldId, `${prefix}/worldgen?world=${encodeURIComponent(worldId)}&era=past`],
    ] as const) {
      const count = beside.length; await client.openDocument(kind, id, {placement: 'beside'});
      assert(beside.length === count + 1 && beside.at(-1) === expected && mainPaths.length === 0, `Beside ${kind} route/scope wrong: ${JSON.stringify({beside, mainPaths, expected})}`);
    }
    await client.openDocument('codex', fixture.targetId);
    assert(mainPaths.length === 1 && mainPaths[0] === `${prefix}/codex?entry=${fixture.targetId}&era=past`, 'Original two-argument Open lost departure semantics');
    const fallbackPaths: string[] = [], fallback = createLocalToolClient(fixture.projectId, documentNotebook, {eraId, navigate: path => fallbackPaths.push(path)});
    await fallback.openDocument('local-tool', sourceB.id, {placement: 'beside'});
    assert(fallbackPaths.length === 1 && fallbackPaths[0] === `${prefix}/local-tool-${documentNotebook.namespace}?document=${sourceB.id}&era=past`, 'Absent beside port did not use existing navigation with effective Source route/era');
    const count = beside.length;
    await rejected(() => client.openDocument('codex', hiddenId, {placement: 'beside'}), 'world_document_missing');
    await rejected(() => client.openDocument('local-tool', 'absent-source', {placement: 'beside'}), 'world_document_missing');
    // Existing SDK contract accepts world roots, not waypoint child IDs.
    await rejected(() => client.openDocument('worldgen', waypointId, {placement: 'beside'}), 'world_document_missing');
    assert(beside.length === count && mainPaths.length === 1, 'Unavailable target dispatched a route');
    let live = true; const stalePaths: string[] = [], lifetime = createLocalToolClient(fixture.projectId, documentNotebook, {isCurrent: () => live, openBeside: path => stalePaths.push(path)});
    const revoke = (row: {id?: string}) => { if (row?.id === fixture.targetId) live = false; return row; };
    db.codexEntries.hook('reading', revoke);
    try { await rejected(() => lifetime.openDocument('codex', fixture.targetId, {placement: 'beside'}), 'local_tool_context_expired'); }
    finally { db.codexEntries.hook('reading').unsubscribe(revoke); }
    assert(!live && stalePaths.length === 0, 'Revocation during effective read reached the beside port');
    assert(await business() === before, 'Readonly route consultations changed business documents');
    return ['Real Source, anchor and worldgen root routes preserve era in beside; original departure and missing-port fallback remain effective; readonly reads navigate without writes, waypoint child IDs, hidden/missing targets and mid-read expired context never dispatch'];
  });
}

export async function testLocalToolBesidePickerStates(): Promise<string[]> {
  return withFixture('picker-states', false, async fixture => {
    const element = document.createElement('div'); document.body.append(element); const root = createRoot(element), paths: string[] = [];
    let live = true;
    const client = createLocalToolClient(fixture.projectId, documentNotebook, {readOnly: true, isCurrent: () => live, openBeside: path => paths.push(path)});
    const render = async (id: string, disabled: boolean) => {
      await act(async () => { root.render(<LocalToolReferencePicker client={client} value={{kind: 'codex', documentId: id}} disabled={disabled} onChange={() => { throw Error('Consultation changed reference'); }}/>); await pause(); });
    };
    try {
      const before = await fixture.business();
      await render(fixture.targetId, true);
      await until(() => element.textContent?.includes(fixture.targetTitle) === true, 'Readonly picker reference did not resolve');
      assert(button(element, 'Open beside').disabled && button(element, 'Open linked document').disabled, 'Disabled picker enabled a consultation action');
      await render('absent-card', false);
      await until(() => element.textContent?.includes('Unavailable') === true, 'Missing reference did not settle');
      assert(button(element, 'Open beside').disabled && button(element, 'Open linked document').disabled, 'Unavailable picker enabled opening');
      await render(fixture.targetId, false);
      await until(() => !button(element, 'Open beside').disabled, 'Available readonly picker did not allow consultation');
      live = false; await click(button(element, 'Open beside'));
      await until(() => !!element.querySelector('[role="alert"]'), 'Rejected beside action did not use the existing picker error');
      assert(element.querySelector('[role="alert"]')?.textContent?.includes('Check that it belongs to this project') && paths.length === 0 && await fixture.business() === before, 'Rejected beside changed routes/data or lost existing recovery text');
      return ['Existing picker disabled/unavailable states cover both actions; beside rejection uses the normal error/recovery without route/data writes'];
    } finally { await act(async () => { root.unmount(); await pause(); }); element.remove(); }
  });
}

export async function testLocalToolBesideAll(): Promise<string[]> {
  return [...await testLocalToolBesideBaseline(), ...await testLocalToolBesideContract(), ...await testLocalToolBesidePicker(), ...await testLocalToolBesideRoutes(), ...await testLocalToolBesidePickerStates()];
}

/** Product CSS runner handshake only; ROOT executes this export in its later UI batch. */
export async function testLocalToolBesideCssUi(): Promise<string[]> {
  return [...await pickerFlow(true), 'Actual product CSS ES/EN at 1280/390: layout, native Tab, dispatcher correlation and 40px target, no page overflow; before/normal global target modal captures. Unfocused-document visual focus is explicitly skipped; real Brave focus evidence is separate'];
}
