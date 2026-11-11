import '@/engines';
import Dexie from 'dexie';
import type {Editor} from '@tiptap/core';
import {act, Suspense, useLayoutEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getEngine} from '@/engines/_registry';
import {getPrimaryEnginePaneOpenBeside} from '@/engines/_shared/EnginePaneContext';
import {registerLocalToolModules} from '@/engines/local/registry';
import {defineLocalTool, LocalToolUndoAnchor, nextLocalToolUndoStep, useLocalToolUndoableCommand, useLocalToolUndoProvider, type LocalToolClient, type LocalToolProps, type LocalToolUndoableCommand, type LocalToolUndoMode} from '@/engines/local/sdk';
import {LocalToolUndoBoundary} from '@/engines/local/LocalToolUndoBoundary';
import {createLocalToolClient} from '@/engines/local/storage';
import documentNotebook from '@/engines/local/examples/documentNotebookDefinition';
import type {LinkedNotebookState} from '@/engines/local/examples/LinkedNotebook';
import initiative from '@/engines/local/examples/initiativeDefinition';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock} from '@/engines/local/blocks/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {createWorkspaceFocusController,WorkspaceFocusContext} from '@/components/project/workspace/workspaceFocus';
import {workspaceDocumentKey} from '@/components/project/workspace/library/types';
import {getPendingWritesSnapshot,registerPendingFlusher} from '@/services/pendingWrites';
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
  unmountWorkspace(): Promise<void>;
}

async function withFixture<T>(label: string, observeClient: boolean, run: (fixture: Fixture) => Promise<T>, blockFocus = false, component?: typeof documentNotebook.component, owned?: 'codex' | 'writings'): Promise<T> {
  const projectId = `beside-${label}-${crypto.randomUUID()}`, targetId = `${projectId}-target`, ownerId = `${projectId}-owner`;
  const targetTitle = `Target B ${label}`, targetMarker = `EFFECTIVE_TARGET_${targetId}`, ownerTitle = `Owner O ${label}`, blockId = `${projectId}-world-cards`;
  const emitted = new Map<string, LocalToolClient<LinkedNotebookState>>();
  const Original = component ?? documentNotebook.component;
  function Observe(props: LocalToolProps<LinkedNotebookState>) {
    useLayoutEffect(() => {
      const id = props.client.documentId; if (!id) return;
      emitted.set(id, props.client);
      return () => { if (emitted.get(id) === props.client) emitted.delete(id); };
    }, [props.client]);
    return <Original {...props}/>;
  }
  const definition = observeClient || component ? defineLocalTool({...documentNotebook, component: observeClient ? Observe : Original}) : documentNotebook;
  registerLocalToolModules({
    './installed/examples.document-notebook/module.tsx': {default: definition},
    './installed/examples.initiative/module.tsx': {default: initiative},
  });
  const sourceEngineId = `local-tool-${documentNotebook.namespace}`;
  const engineIds = [sourceEngineId, 'codex', `local-tool-${initiative.namespace}`, ...(owned === 'writings' ? ['writings'] : [])];
  const engines = engineIds.map(id => { const engine = getEngine(id); assert(engine, `Registered engine missing ${id}`); return engine; });
  const root = createRoot(node('#root')), focus = blockFocus ? createWorkspaceFocusController() : undefined;
  let mounted = true;
  const unmountWorkspace = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => { root.unmount(); await pause(); });
  };
  useLocaleStore.setState({locale: 'en', loaded: true});
  try {
    await db.projects.put({id: projectId, title: `Beside ${label}`, description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: engineIds, engineOrder: engineIds, createdAt: 1, updatedAt: 1});
    const definition = initiative.blocks?.find(block => block.key === (owned ? 'initiative' : 'cards'));
    assert(definition, 'Source block definition absent');
    const atom = serializeLocalToolBlock(projectId, createLocalToolBlockEnvelope(initiative.namespace, definition, blockId));
    const neighbor = owned ? serializeLocalToolBlock(projectId, createLocalToolBlockEnvelope(initiative.namespace, definition, blockId + '-neighbor')) : '';
    const ownerContent = '<p>Owner prose remains exact.</p>' + atom + neighbor + (owned ? '<p>Tail prose remains exact.</p>' : '');
    await db.codexEntries.bulkPut([
      {...authorCard(projectId, targetTitle), id: targetId, content: `<p>${targetMarker}</p>` + (owned === 'codex' ? atom : '')},
      {...authorCard(projectId, ownerTitle), id: ownerId, content: ownerContent},
    ]);
    if (owned === 'writings') await db.writings.put({id: ownerId, projectId, title: ownerTitle, status: 'draft', content: ownerContent, wordCount: 9, tags: [], createdAt: 1, updatedAt: 1});
    const source = await createSourceToolDocument({projectId}, documentNotebook.namespace, `Source A ${label}`);
    const initialClient = createLocalToolClient(projectId, documentNotebook, {documentId: source.id});
    const initial = await initialClient.read();
    await initialClient.save({...documentNotebook.initialState, notes: `Saved Source A ${label}`, linked: {kind: 'codex', documentId: targetId}, ...(blockFocus ? {items: [{id: 'checklist', text: 'Block focus checklist item Ω'}]} : {})}, initial.revision, initial.document?.version);
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
      const tree = <MemoryRouter initialEntries={[sourceRoute]}><Routes><Route path="/project/:id/:tab" element={<RoutedWorkspace/>}/>{blockFocus&&<Route path="/project/:id/ordinary-destination" element={<output data-testid="legacy-beside-fallback"/>}/>}</Routes></MemoryRouter>;
      root.render(focus ? <WorkspaceFocusContext.Provider value={focus}>{tree}</WorkspaceFocusContext.Provider> : tree);
      await pause();
    });
    await until(() => !!sourceHost(main(), source.id)?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)') && !button(sourceHost(main(), source.id)!, 'Open linked document').disabled, 'Real documentary LinkedNotebook did not become ready');
    const fixture: Fixture = {
      projectId, sourceId: source.id, sourceEngineId, sourceRoute, targetId, targetTitle, targetMarker, targetRoute, ownerId, ownerTitle, blockId, emitted, unmountWorkspace,
      business: async () => JSON.stringify({project: await db.projects.get(projectId), cards: (await db.codexEntries.where('projectId').equals(projectId).toArray()).sort((left, right) => left.id.localeCompare(right.id))}),
    };
    return await run(fixture);
  } finally {
    await unmountWorkspace();
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
        ready: current.ready, draft: current.value, expectedDraft: draft, base: current.host?.querySelector(':is(section[aria-label="Linked notebook"], section[aria-label="Cuaderno vinculado"]) > header > span')?.textContent, businessExact: await fixture.business() === before};
      console.error('PICKER_FLOW_DIAGNOSTIC ' + JSON.stringify({locale, ...actual}));
      console.error('PICKER_BUSINESS_DIAGNOSTIC ' + JSON.stringify({before: JSON.parse(before), after: JSON.parse(await fixture.business())}));
      assert(actual.route === fixture.sourceRoute && actual.documentId === fixture.sourceId && actual.ready && actual.draft === draft && actual.base === (locale === 'es' ? 'Base compartida' : 'Shared base'), `Picker changed logical Source/draft/scope: ${JSON.stringify(actual)}`);
      const postFlush = await fixture.business(), beforeData = JSON.parse(before), afterData = JSON.parse(postFlush);
      const sourceBefore = beforeData.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      const sourceAfter = afterData.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      assert(sourceBefore && sourceAfter, 'Flush lost the logical Source document');
      assert(sourceAfter.data.notes === draft && sourceAfter.revision === sourceBefore.revision + 1, 'Normal beside flush did not persist exactly the pending notes in one revision');
      assert(sourceAfter.updatedAt > sourceBefore.updatedAt && afterData.project.updatedAt > beforeData.project.updatedAt, 'Normal flush timestamps did not each advance');
      const normalized = structuredClone(afterData), normalizedSource = normalized.project.sourceToolDocuments.find((document: {id: string}) => document.id === fixture.sourceId);
      normalizedSource.data.notes = sourceBefore.data.notes; normalizedSource.revision = sourceBefore.revision;
      normalizedSource.updatedAt = sourceBefore.updatedAt; normalized.project.updatedAt = beforeData.project.updatedAt;
      assert(JSON.stringify(normalized) === before, 'Beside flush changed business fields beyond Source notes/revision and Source/project timestamps');
      assert(button(sourceHost(main(), fixture.sourceId)!, locale === 'es' ? 'Guardar notas' : 'Save notes').disabled, 'Normally flushed notes still appear unsaved');
      assert(fixture.emitted.get(fixture.sourceId) === previousClient, 'Opening beside replaced the current primary client');
      const live = await previousClient.read();
      assert(previousClient.projectId === fixture.projectId && previousClient.eraId === undefined &&
        previousClient.documentId === fixture.sourceId && live.data.notes === draft &&
        mainLocation() === fixture.sourceRoute && await fixture.business() === postFlush,
        'Retained Source client did not read the exact document, Base and flushed notes');
      if (css) await capturePicker(fixture, locale, 'after');
      await fixture.unmountWorkspace();
      await rejected(() => previousClient.openDocument('codex', fixture.targetId, {placement: 'beside'}), 'local_tool_context_expired');
      assert(await fixture.business() === postFlush, 'Withdrawn Source client changed post-flush data');
    });
    passed.push(`Real ${locale} picker beside keeps principal logical A/Base/ready exact pending notes flushed and preserved with only normal save metadata changes while normal Codex B opens; the primary client stays live until its host unmounts`);
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
  return [...await testLocalToolBesideBaseline(), ...await testLocalToolBesideContract(), ...await testLocalToolBesidePicker(), ...await testLocalToolBesideRoutes(), ...await testLocalToolBesidePickerStates(), ...await testSourceAuthorUndoCommand(), ...await testSourceAuthorUndoProvider(), ...await testSourceAuthorUndoableCommand(), ...await testOwnedBlockPanel()];
}

/** Product CSS runner handshake only; ROOT executes this export in its later UI batch. */
export async function testLocalToolBesideCssUi(): Promise<string[]> {
  return [...await pickerFlow(true), 'Actual product CSS ES/EN at 1280/390: layout, native Tab, dispatcher correlation and 40px target, no page overflow; before/normal global target modal captures. Unfocused-document visual focus is explicitly skipped; real Brave focus evidence is separate'];
}

interface SourceBlockFocusView {
  paneId: string;
  notes: boolean;
  items: boolean;
  noteValue: string | null;
  text: string;
}
export interface SourceBlockFocusFixture {
  projectId: string;
  documentId: string;
  namespace: string;
  unmountWorkspace(): Promise<void>;
  observe(): {main: SourceBlockFocusView | null; companion: SourceBlockFocusView | null};
}

export async function withSourceBlockFocusFixture<T>(run: (fixture: SourceBlockFocusFixture) => Promise<T>): Promise<T> {
  return withFixture('block-focus', false, fixture => {
    const observe = (pane: HTMLElement | null): SourceBlockFocusView | null => {
      const host = pane && sourceHost(pane, fixture.sourceId);
      if (!host || !pane?.dataset.enginePaneId) return null;
      const notes = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]');
      return {paneId: pane.dataset.enginePaneId, notes: !!notes, items: !!host.querySelector('[aria-label="New item"]'),
        noteValue: notes?.value ?? null, text: host.textContent ?? ''};
    };
    return run({projectId: fixture.projectId, documentId: fixture.sourceId, namespace: documentNotebook.namespace,
      unmountWorkspace: fixture.unmountWorkspace, observe: () => ({main: observe(document.querySelector<HTMLElement>('[data-testid="workspace-primary"]')), companion: observe(activeCompanion())})});
  }, true);
}

export async function testSourceBlockFocus(): Promise<string[]> {
  return withSourceBlockFocusFixture(async fixture => {
    const {projectId, documentId} = fixture;
    const original = 'Saved Source A block-focus', edited = 'Updated notes from the side panel Ω', item = 'Block focus checklist item Ω';
    const source = createLocalToolClient(projectId, documentNotebook, {documentId, readOnly: true});
    const snapshot = async () => JSON.stringify({document: await source.read(), project: await db.projects.get(projectId),
      variants: await db.worldEraVariants.where('projectId').equals(projectId).sortBy('id')});
    const open = async (blockId: string, eraId?: string, target = documentId) => {
      const reply = await runBridgeTool('wh_local_tool_document_open', {projectId, documentId: target, blockId, ...(eraId ? {eraId} : {})});
      assert(reply.ok, 'Open block dispatcher rejected: ' + JSON.stringify(reply));
      return reply.result as {available: boolean; applied: boolean};
    };
    const tabs = async () => {
      const reply = await runBridgeTool('wh_workspace_tabs', {projectId});
      assert(reply.ok, 'Could not read workspace tabs');
      return (reply.result as {tabs: {id: string; route: string}[]}).tabs;
    };
    const change = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await pause();
      });
    };
    const before = await snapshot();
    const primaryPort = getPrimaryEnginePaneOpenBeside(projectId);
    assert(primaryPort, 'The live primary workspace port is absent');
    let current = true;
    const retiring = createLocalToolClient(projectId, documentNotebook, {documentId, isCurrent: () => current, openBeside: primaryPort});
    let startFlush!: () => void, finishFlush!: () => void;
    const entered = new Promise<void>(resolve => { startFlush = resolve; });
    const pausedFlush = new Promise<void>(resolve => { finishFlush = resolve; });
    const unregister = registerPendingFlusher('source-block-focus-retiring', async () => { startFlush(); await pausedFlush; return true; });
    try {
      await act(async () => {
        const opening = rejected(() => retiring.openDocument('local-tool', documentId, {blockId: 'notes'}), 'local_tool_context_expired');
        await Promise.race([entered, opening]);
        current = false;
        finishFlush();
        await opening;
        await pause();
      });
    } finally { finishFlush(); unregister(); }
    assert(!fixture.observe().companion && (await tabs()).length === 0 && await snapshot() === before, 'The revoked SDK client opened a tab or wrote business data');
    const full = sourceHost(main(), documentId)!;
    assert(fixture.observe().main?.items && fixture.observe().main?.noteValue === original && full.textContent?.includes(item), 'Full document was not mounted');
    await click(button(full, 'Open notes beside'));
    await until(() => fixture.observe().companion?.noteValue === original, 'Notes did not open in the real workspace');
    const first = fixture.observe().companion!;
    assert(!first.items && fixture.observe().main?.items && mainLocation()?.includes('block=') === false, 'Focal notes displaced or filtered the full document');

    let duplicate: {available: boolean; applied: boolean}[] = [];
    await act(async () => { duplicate = await Promise.all([open('notes'), open('notes')]); await pause(); });
    assert(duplicate.some(reply => reply.applied) && (await tabs()).length === 1 && fixture.observe().companion?.paneId === first.paneId, 'Duplicate requests did not reuse the admitted Notes tab');

    const draft = node<HTMLInputElement>('[aria-label="New item"]', full);
    await change(draft, 'Pending draft stays in the principal');
    let blocked = {available: false, applied: false};
    await act(async () => { blocked = await open('items'); await pause(); });
    assert(blocked.available && !blocked.applied && (await tabs()).length === 1 && fixture.observe().companion?.paneId === first.paneId &&
      draft.value === 'Pending draft stays in the principal' && await snapshot() === before, 'A declined guard changed routes, data or pending input');
    await change(draft, '');

    await act(async () => { assert((await open('items')).applied, 'Items request was refused'); await pause(); });
    await until(() => fixture.observe().companion?.text.includes(item) === true, 'Items did not mount in the second companion');
    const second = fixture.observe().companion!;
    assert(!second.notes && second.paneId !== first.paneId && (await tabs()).length === 2 && await snapshot() === before, 'The two block identities or business snapshot changed');

    await click(document.getElementById('tab-' + first.paneId)!);
    const currentNotes = () => sourceHost(activeCompanion()!, documentId)!;
    await click(button(currentNotes(), 'Fullscreen'));
    await until(() => !!document.querySelector('[data-source-document-view="fullscreen"] textarea:not(:disabled)'), 'Focused fullscreen did not mount');
    const fullscreen = node('[data-source-document-view="fullscreen"]');
    assert(!fullscreen.querySelector('[aria-label="New item"]'), 'Fullscreen lost the Notes focus');
    await click(button(node('[role="dialog"]'), 'Save and return'));
    await until(() => !document.querySelector('[data-source-document-view="fullscreen"]'), 'Focused fullscreen did not return');
    assert(await snapshot() === before, 'Opening or closing focused views wrote business data');

    await change(node<HTMLTextAreaElement>('textarea', currentNotes()), edited);
    await click(button(currentNotes(), 'Save notes'));
    await until(() => fixture.observe().main?.noteValue === edited && !button(currentNotes(), 'Undo').disabled, 'The same document did not observe the focused save');
    const saved = await source.read();
    assert(saved.data.notes === edited && saved.data.items.length === 1 && saved.data.items[0].text === item, 'Focused save changed another block or another document');
    await click(button(currentNotes(), 'Undo'));
    await until(() => fixture.observe().main?.noteValue === original, 'Focused Undo did not reverse the same document');
    const afterUndo = await snapshot();
    await click(node('[data-testid="workspace-close-tab-' + first.paneId + '"]'));
    await until(() => !document.getElementById('tab-' + first.paneId), 'Notes tab did not close');
    await click(button(full, 'Open notes beside'));
    await until(() => fixture.observe().companion?.noteValue === original, 'Reopened Notes did not read the persisted result');
    assert(fixture.observe().companion?.paneId !== first.paneId && await snapshot() === afterUndo, 'Closing or reopening wrote data or reused the closed instance');

    await act(async () => { assert((await open('unknown & Ω')).applied, 'Unknown block route was not admitted'); await pause(); });
    await until(() => fixture.observe().companion?.items === true && fixture.observe().companion?.noteValue === original, 'Unknown block did not render the whole tool');
    assert((await tabs()).some(tab => new URLSearchParams(tab.route.split('?')[1]).get('block') === 'unknown & Ω'), 'Block identity was not encoded losslessly');

    const eraId = 'block-focus-era';
    await saveWorldEra(projectId, {id: eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
    const inherited = await snapshot();
    await act(async () => { assert((await open('notes', eraId)).applied, 'Inherited block was not admitted'); await pause(); });
    await until(() => fixture.observe().companion?.noteValue === original && fixture.observe().companion?.text.includes(eraId) === true, 'Inherited block lost the requested era');
    assert(await snapshot() === inherited, 'Opening an inherited block created a variant or changed Base');
    const hidden = await createSourceToolDocument({projectId}, fixture.namespace, 'Hidden in Past');
    const scope = {projectId, eraId};
    await hideEraDocument(scope, 'local-tool', hidden.id, (await readWorldDocument(scope, 'local-tool', hidden.id))!.version);
    const hiddenReply = await runBridgeTool('wh_local_tool_document_open', {...scope, documentId: hidden.id, blockId: 'notes'});
    assert(!hiddenReply.ok && (await tabs()).length === 4, 'The hidden document was not refused');
    const beside = getPrimaryEnginePaneOpenBeside(projectId);
    assert(beside, 'The real workspace port was unavailable before leaving');
    await act(async () => { assert(await beside('/project/' + projectId + '/ordinary-destination'), 'Legacy destination refused fallback'); await pause(); });
    await until(() => !!document.querySelector('[data-testid="legacy-beside-fallback"]'), 'An ordinary non-pane destination did not navigate the principal');
    await fixture.unmountWorkspace();
    const unmounted = await snapshot();
    const unavailable = await open('notes');
    assert(!unavailable.available && !unavailable.applied && fixture.observe().main === null && await snapshot() === unmounted, 'Opening without a mounted workspace had an effect');
    return ['Real Source block panes retain full view, dedup, pending draft, fullscreen, normal save and Undo, close/reopen, unknown fallback, scoped inheritance and unavailable shell'];
  });
}

export async function testSourceAuthorUndoCommand(): Promise<string[]> {
  return withSourceBlockFocusFixture(async fixture => {
    const scope = {projectId: fixture.projectId, namespace: fixture.namespace, documentId: fixture.documentId};
    const reader = createLocalToolClient(scope.projectId, documentNotebook, {documentId: scope.documentId, readOnly: true});
    const documentHost = () => sourceHost(main(), scope.documentId)!;
    const action = (label: string) => button(documentHost(), label);
    const textbox = () => node<HTMLTextAreaElement>('textarea[aria-label="Notes"]', documentHost());
    const initial = await reader.read();
    const commandId = 'add-review-checklist';
    async function commands() {
      const reply = await runBridgeTool('wh_local_tool_command_list', scope);
      assert(reply.ok, JSON.stringify(reply));
      return (reply.result as {commands: {instanceId:string;id:string;label:{en:string;es:string};inputSchema:unknown}[]}).commands;
    }
    async function invoke(instanceId: string, input?: unknown, overrides = {}) {
      return runBridgeTool('wh_local_tool_command_run', {...scope,instanceId,commandId,...(input===undefined?{}:{input}),...overrides});
    }
    async function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        await pause();
      });
    }
    async function saveNote(value: string) {
      await change(textbox(), value);
      await click(action('Save notes'));
      await until(() => textbox().value === value && !action('Undo').disabled, 'Normal note edit did not enter history');
      assert((await reader.read()).data.notes===value,'Normal note edit was not committed');
    }
    async function shortcut(target: HTMLElement, redo = false) {
      const event = new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:redo,bubbles:true,cancelable:true});
      await act(async () => {target.dispatchEvent(event);await pause();});
      return event.defaultPrevented;
    }
    async function holdProjectAccess() {
      let enter!:()=>void,release!:()=>void;
      const entered=new Promise<void>(resolve=>{enter=resolve;});
      const held=new Promise<void>(resolve=>{release=resolve;});
      const transaction=db.transaction('rw',db.projects,async()=>{
        await db.projects.get(scope.projectId);
        enter();
        await Dexie.waitFor(held);
      });
      await entered;
      return {release,transaction};
    }
    async function expectAction(reply: Awaited<ReturnType<typeof invoke>>, available: boolean, applied: boolean) {
      assert(reply.ok && JSON.stringify(reply.result)===JSON.stringify({available,applied}), JSON.stringify(reply));
    }
    const listed = await commands();
    assert(listed.length===1 && listed[0].id===commandId && listed[0].label.en==='Add review checklist' && !!listed[0].inputSchema, 'Live author command was not discoverable');
    const first = listed[0].instanceId;

    await saveNote('Normal note before the review');
    const edited=await reader.read();
    const hold=await holdProjectAccess();
    try {
      await act(async()=>{Dexie.ignoreTransaction(()=>action('Add review checklist').click());await pause();});
      await until(()=>action('Add review checklist').disabled,'The inline author command did not render busy during the queued access check');
    } finally {hold.release();await hold.transaction;}
    await until(()=>documentHost().textContent?.includes('Check names')===true,'The inline command did not commit after its access check');
    assert((await commands())[0]?.instanceId===first,'A busy render replaced the live command binding');
    const authored=await reader.read();
    assert(authored.revision===edited.revision!+1 && authored.data.items.length===initial.data.items.length+2 &&
      authored.data.items.slice(-2).map(item=>item.text).join('|')==='Review continuity|Check names' && authored.data.notes===edited.data.notes,
      'The author command did not apply two related actions in one revision');
    assert(!await shortcut(textbox()) && (await reader.read()).revision===authored.revision,'Text-field Undo was intercepted by the command history');
    assert(await shortcut(action('Add review checklist')),'The command did not enter the normal keyboard dispatcher');
    assert((await reader.read()).data.items.length===initial.data.items.length && (await reader.read()).data.notes===edited.data.notes,'First Undo was not the single author command');
    assert(await shortcut(action('Add review checklist')) && (await reader.read()).data.notes===initial.data.notes,'Second Undo was not the prior normal edit');
    assert(await shortcut(action('Add review checklist'),true) && (await reader.read()).data.notes===edited.data.notes,'First Redo did not restore the normal edit');
    assert(await shortcut(action('Add review checklist'),true) && (await reader.read()).data.items.length===authored.data.items.length,'Second Redo did not restore the command');

    await saveNote('Redo branch remains after a no-op');
    await click(action('Undo'));
    const beforeNoop=await reader.read();
    assert(!action('Redo').disabled,'Normal Redo branch was not ready');
    await expectAction(await invoke(first,{locale:'en'}),true,false);
    const invalid=await invoke(first,{locale:'unknown'});
    assert(!invalid.ok && invalid.code==='bad-args' && JSON.stringify(await reader.read())===JSON.stringify(beforeNoop) && !action('Redo').disabled,
      'No-op or invalid input modified the saved state or removed Redo');
    const draft=node<HTMLInputElement>('[aria-label="New item"]',documentHost());
    await change(draft,'Uncommitted item');
    await expectAction(await invoke(first,{locale:'es'}),true,false);
    assert(draft.value==='Uncommitted item' && JSON.stringify(await reader.read())===JSON.stringify(beforeNoop),'Author command consumed a pending draft or wrote data');
    await change(draft,'');
    await until(()=>!action('Redo').disabled,'Declined draft command erased the old Redo branch');

    await act(async()=>{await expectAction(await invoke(first,{locale:'es'}),true,true);await pause();});
    assert(action('Redo').disabled && (await reader.read()).data.items.some(item=>item.text==='Comprobar los nombres'),'Author command did not replace normal Redo');
    await click(action('Undo'));
    assert(!action('Redo').disabled && !(await reader.read()).data.items.some(item=>item.text==='Comprobar los nombres'),'Command Undo/Redo branch was not created');
    await saveNote('Normal edit replaces the command Redo');
    assert(action('Redo').disabled,'Normal edit did not replace author Redo');

    await click(action('Fullscreen'));
    await until(()=>!!document.querySelector('[data-source-document-view="fullscreen"]'),'Fullscreen did not mount');
    assert((await commands()).length===0,'Fullscreen advertised the hidden parent or the child');
    await expectAction(await invoke(first,{locale:'es'}),false,false);
    await click(button(node('[role="dialog"]'),'Save and return'));
    await until(()=>!document.querySelector('[data-source-document-view="fullscreen"]'),'Fullscreen did not close');
    const reissued=await commands();
    assert(reissued.length===1 && reissued[0].instanceId!==first,'The command instance did not rotate after fullscreen');
    const liveInstance=reissued[0].instanceId;
    await expectAction(await invoke(first,{locale:'es'}),false,false);
    await expectAction(await invoke(liveInstance,{locale:'es'},{eraId:'different-era'}),false,false);
    await expectAction(await invoke(liveInstance,{locale:'es'},{documentId:'other-document'}),false,false);

    const beforeRetire=await reader.read(),paused=await holdProjectAccess();
    const retiring:{call?:ReturnType<typeof invoke>}={};
    try{
      await act(async()=>{retiring.call=Dexie.ignoreTransaction(()=>invoke(liveInstance,{locale:'es'}));await pause();});
      await until(()=>action('Add review checklist').disabled,'Retirement case never reached the guarded access check');
      await fixture.unmountWorkspace();
    }finally{paused.release();await paused.transaction;}
    assert(retiring.call,'Missing retiring request');
    const late=await retiring.call;
    assert(late.ok && JSON.stringify(late.result)===JSON.stringify({available:false,applied:false}) && (await commands()).length===0 &&
      JSON.stringify(await reader.read())===JSON.stringify(beforeRetire),'A retired command committed or remained reachable');
    return ['Real Source author command uses one normal receipt, shares Undo/Redo and branch with state, preserves text handling and rejects stale or pending mounts'];
  });
}

export async function testSourceAuthorUndoProvider(): Promise<string[]> {
  type Scope={projectId:string;namespace:string;documentId:string};
  type Provider={instanceId:string;providerId:string;providerToken:string;label?:{en:string;es:string};canUndo:boolean;canRedo:boolean};
  const checks:string[]=[];
  async function list(scope:Scope){
    const reply=await runBridgeTool('wh_local_tool_undo_provider_list',scope);assert(reply.ok,JSON.stringify(reply));
    return (reply.result as {providers:Provider[]}).providers;
  }
  function invoke(scope:Scope,provider:Provider,mode:LocalToolUndoMode,overrides={}){
    const {instanceId,providerId,providerToken}=provider;
    return runBridgeTool('wh_local_tool_undo_provider_run',{...scope,instanceId,providerId,providerToken,mode,...overrides});
  }
  function expect(reply:Awaited<ReturnType<typeof invoke>>,available:boolean,applied:boolean){
    assert(reply.ok&&JSON.stringify(reply.result)===JSON.stringify({available,applied}),JSON.stringify(reply));
  }
  async function key(target:HTMLElement,redo=false){
    const event=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:redo,bubbles:true,cancelable:true});
    await act(async()=>{target.dispatchEvent(event);await pause();});return event.defaultPrevented;
  }
  async function note(host:HTMLElement,value:string){
    const textarea=node<HTMLTextAreaElement>('textarea[aria-label="Notes"]',host);
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,value);textarea.dispatchEvent(new Event('input',{bubbles:true}));await pause();});
    assert(!button(host,'Save notes').disabled,'The note draft was not accepted');
    await click(button(host,'Save notes'));
  }
  async function holdAccess(projectId:string){
    let enter!:()=>void,release!:()=>void;
    const entered=new Promise<void>(resolve=>{enter=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
    const done=db.transaction('rw',db.projects,async()=>{await db.projects.get(projectId);enter();await Dexie.waitFor(held);});
    await entered;return{release,done};
  }
  await withSourceBlockFocusFixture(async fixture=>{
    const scope={projectId:fixture.projectId,documentId:fixture.documentId,namespace:fixture.namespace};
    const reader=createLocalToolClient(scope.projectId,documentNotebook,{documentId:scope.documentId,readOnly:true});
    const host=()=>sourceHost(main(),scope.documentId)!;
    const region=(within=host())=>node<HTMLElement>('section[aria-label="Rehearsal order"]',within);
    const names=(within=host())=>[...region(within).querySelectorAll('ol > li > span')].map(row=>row.textContent).join('|');
    const snapshot=async()=>JSON.stringify(await reader.read());
    const before=await reader.read(),original='Block focus checklist item Ω',authored=`${original}|Review continuity|Check names`,reordered=`Review continuity|${original}|Check names`;
    const listRehearsals=async()=>(await list(scope)).filter(row=>row.providerId==='rehearsal-order');
    const first=(await listRehearsals())[0];
    assert(first?.providerId==='rehearsal-order'&&first.label?.en==='Rehearsal order'&&!first.canUndo&&!first.canRedo,'Initial live model was not listed without history');
    await note(host(),'Normal note before rehearsal');
    await click(button(host(),'Add review checklist'));
    await until(()=>names()===authored,'Author command was not visible in the rehearsal');
    const edited=await snapshot(),move=()=>node<HTMLButtonElement>(`button[aria-label="Move ${original} down"]`,region());
    await click(move());
    assert(names()===reordered&&await snapshot()===edited,'A rehearsal edit changed saved data');
    assert(!await key(node('textarea',host()))&&await snapshot()===edited,'Text Undo was intercepted by the provider');
    assert(await key(button(region(),'Undo rehearsal'))&&names()===authored&&await snapshot()===edited,'Keyboard did not undo the provisional order');
    assert(await key(button(host(),'Add review checklist'))&&names()===original&&(await reader.read()).data.notes==='Normal note before rehearsal','The normal command receipt did not follow the provider');
    assert(await key(button(host(),'Add review checklist'))&&(await reader.read()).data.notes===before.data.notes,'The older state receipt did not follow the command');
    assert(!button(region(),'Redo rehearsal').disabled&&!button(host(),'Redo').disabled,'Both redo directions must be ready for ordering');
    assert(await key(button(host(),'Add review checklist'),true)&&(await reader.read()).data.notes==='Normal note before rehearsal'&&names()===original,'Redo picked the provider before the newer normal step');
    assert(await key(button(host(),'Add review checklist'),true)&&names()===authored,'The next normal Redo did not restore the command');
    assert(await key(button(region(),'Redo rehearsal'),true)&&names()===reordered,'Redo did not return to the provider after the normal steps');
    assert((await listRehearsals())[0]?.providerToken===first.providerToken,'Inline handle rerender replaced the model token');
    const retained=await snapshot(),hold=await holdAccess(scope.projectId);
    let pending:ReturnType<typeof invoke>|undefined;
    try{
      await act(async()=>{pending=Dexie.ignoreTransaction(()=>invoke(scope,first,'undo'));await pause();});
      await until(()=>button(region(),'Undo rehearsal').disabled&&move().disabled&&button(region(),'Apply order').disabled,'Pending provider did not guard its model controls');
      await click(move());await click(button(region(),'Apply order'));
      expect(await invoke(scope,first,'undo'),true,false);
      assert(names()===reordered,'A second operation changed the model while Undo waited');
    }finally{hold.release();await hold.done;}
    assert(pending,'The pending provider request was not started');
    await act(async()=>{expect(await pending!,true,true);await pause();});
    assert(names()===authored&&await snapshot()===retained,'Provider MCP Undo changed persistence or skipped the live model');
    await act(async()=>{expect(await invoke(scope,first,'redo'),true,true);await pause();});
    assert(names()===reordered&&await snapshot()===retained,'Provider MCP Redo did not use the same model');
    const invalid=await invoke(scope,first,'undo',{mode:'invalid'});
    assert(!invalid.ok&&invalid.code==='bad-args','Invalid mode reached the provider');
    expect(await invoke(scope,first,'undo',{eraId:'another-era'}),false,false);
    await click(button(region(),'Discard rehearsal'));
    await until(()=>names()===authored&&button(region(),'Undo rehearsal').disabled,'Deliberate discard did not clear the rehearsal');

    await act(async()=>{const opened=await runBridgeTool('wh_local_tool_document_open',{projectId:scope.projectId,documentId:scope.documentId,blockId:'items'});assert(opened.ok&&JSON.stringify(opened.result)===JSON.stringify({available:true,applied:true}),JSON.stringify(opened));await pause();});
    const companion=()=>sourceHost(activeCompanion()!,scope.documentId)!;
    await until(()=>!!activeCompanion()?.querySelector('section[aria-label="Rehearsal order"]'),'Real Items companion did not publish its provider');
    const both=await listRehearsals(),second=both.find(row=>row.providerToken!==first.providerToken);
    assert(both.length===2&&second&&second.instanceId!==first.instanceId,'The companion reused the principal model identity');
    const moveCompanion=()=>node<HTMLButtonElement>(`button[aria-label="Move ${original} down"]`,region(companion()));
    await click(moveCompanion());
    assert(names(companion())===reordered&&names()===authored&&await snapshot()===retained,'Companion rehearsal retargeted the principal or saved data');
    await click(button(region(companion()),'Apply order'));
    await until(()=>names()===reordered&&button(region(companion()),'Undo rehearsal').disabled,'Apply did not synchronize the saved order and clear the provisional stack');
    const applied=await reader.read();
    assert(applied.revision===JSON.parse(retained).revision+1&&applied.data.items.map(row=>row.text).join('|')===reordered,'Apply did not use one normal writer revision');
    await click(button(companion(),'Undo'));
    await until(()=>names()===authored&&names(companion())===authored,'Regular Undo did not restore the applied order');
    await click(moveCompanion());
    const other=createLocalToolClient(scope.projectId,documentNotebook,{documentId:scope.documentId});
    const remoteItem='A different view added this item';
    await act(async()=>{const baseline=await other.read();await other.state!.apply(baseline,[{type:'list-insert',field:'items',item:{id:'remote-rehearsal-item',text:remoteItem},afterId:baseline.data.items.at(-1)!.id}]);await pause();});
    const remote=await snapshot();
    await click(button(region(companion()),'Apply order'));
    await until(()=>!!region(companion()).querySelector('[role="alert"]'),'Changed baseline did not surface a conflict');
    assert(names(companion())===reordered&&await snapshot()===remote,'Conflicting Apply lost the draft or changed saved data');
    await click(button(region(companion()),'Discard rehearsal'));
    await until(()=>names(companion())===`${authored}|${remoteItem}`,'Discard did not recover the latest saved list');
    const paneId=activeCompanion()!.dataset.enginePaneId;
    await click(node(`[data-testid="workspace-close-tab-${paneId}"]`));
    await until(()=>!activeCompanion(),'The companion did not close');
    expect(await invoke(scope,second,'undo'),false,false);
    assert((await listRehearsals()).map(row=>row.providerToken).join()===first.providerToken,'Closing a companion retired another provider');
    checks.push('Real Source rehearsal stays local through ordered keyboard and MCP, isolates panes, applies one Writer receipt, preserves conflicts and retires the closed token');
  });

  type Step={value:number;step:number};
  type Model={value:number;undo:Step[];redo:Step[];calls:number;fault?:'false'|'throw'|'getter';gate?:()=>Promise<void>};
  const createModel=():Model=>({value:0,undo:[],redo:[],calls:0});
  let model=createModel();
  const Notebook=documentNotebook.component;
  function ModelNotebook(props:LocalToolProps<LinkedNotebookState>){
    const [selected,setSelected]=useState(model),[stamped,setStamped]=useState(true),[allowUndo,setAllowUndo]=useState(true),[,refresh]=useState(0);
    const redraw=()=>refresh(value=>value+1);
    async function reverse(target:Model,mode:LocalToolUndoMode,operation:{isCurrent():boolean}){
      target.calls++;
      await target.gate?.();
      if(!operation.isCurrent())return false;
      if(target.fault==='throw')throw Error('Model refused the change');
      if(target.fault==='false')return false;
      const step=target[mode].at(-1);if(!step)return false;
      target[mode==='undo'?'redo':'undo'].push({value:target.value,step:nextLocalToolUndoStep()});
      target[mode].pop();target.value=step.value;redraw();return true;
    }
    const provider=useLocalToolUndoProvider(props.client,props.context,{id:'probe',model:selected,
      canUndo:target=>allowUndo&&!!target.undo.length,canRedo:target=>!!target.redo.length,
      ...(stamped?{lastStep:(target:Model,mode:LocalToolUndoMode)=>target.fault==='getter'?undefined:target[mode].at(-1)?.step}:{}),
      undo:(target,operation)=>reverse(target,'undo',operation),redo:(target,operation)=>reverse(target,'redo',operation)});
    return <><Notebook {...props}/><section aria-label="Model history probe">
      <output>{selected.value}</output>
      <button type="button" onClick={()=>{selected.undo.push({value:selected.value,step:nextLocalToolUndoStep()});selected.value++;selected.redo=[];redraw();}}>Model edit</button>
      <button type="button" onClick={()=>setStamped(false)}>Use unranked model</button>
      <button type="button" onClick={()=>setAllowUndo(value=>!value)}>Toggle model Undo</button>
      <button type="button" onClick={redraw}>Render model again</button>
      <button type="button" onClick={()=>{model=createModel();setSelected(model);}}>Replace model</button>
      <button type="button" disabled={!provider.canUndo||provider.busy} onClick={()=>void provider.undo().catch(()=>undefined)}>Undo model</button>
      {provider.error&&<p role="alert">{provider.error}</p>}
    </section></>;
  }
  await withFixture('undo-provider-sdk',false,async fixture=>{
    const scope={projectId:fixture.projectId,namespace:documentNotebook.namespace,documentId:fixture.sourceId};
    const reader=createLocalToolClient(scope.projectId,documentNotebook,{documentId:scope.documentId,readOnly:true});
    const host=()=>sourceHost(main(),scope.documentId)!,probe=()=>node<HTMLElement>('section[aria-label="Model history probe"]',host());
    const action=(label:string)=>button(probe(),label),display=()=>node('output',probe()).textContent;
    const descriptor=async()=>{const found=(await list(scope)).find(row=>row.providerId==='probe');assert(found,'The actual Source host did not publish the author model');return found;};
    const first=await descriptor(),initial=await reader.read();
    await click(action('Model edit'));await click(action('Model edit'));
    assert(!action('Undo model').disabled,'The author stack did not become available');
    await click(action('Toggle model Undo'));
    assert(action('Undo model').disabled,'The UI did not use the current inline getter on its only render');
    const disabled=await descriptor();
    assert(!disabled.canUndo&&disabled.providerToken===first.providerToken,'The list did not agree with the new getter on the same model');
    await click(action('Toggle model Undo'));
    assert(!action('Undo model').disabled&&(await descriptor()).canUndo,'Re-enabling the same model did not refresh UI and MCP');
    await note(host(),'Newer normal receipt');
    assert(await key(action('Model edit'))&&display()==='2'&&(await reader.read()).data.notes===initial.data.notes,'A stamped older provider beat a newer ready Writer receipt');
    await note(host(),'Normal receipt remains after getter error');
    model.fault='getter';const beforeFault=JSON.stringify(await reader.read());
    assert(await key(action('Model edit'))&&!!probe().querySelector('[role="alert"]')&&model.calls===0&&JSON.stringify(await reader.read())===beforeFault,'Invalid getter fell through to another history or invoked a callback');
    model.fault=undefined;
    await click(action('Use unranked model'));
    assert(await key(action('Model edit'))&&display()==='1'&&JSON.stringify(await reader.read())===beforeFault,'An available unranked model did not take precedence');
    const branches=JSON.stringify([model.value,model.undo,model.redo]);
    model.fault='false';expect(await invoke(scope,first,'undo'),true,false);
    model.fault='throw';const refused=await invoke(scope,first,'undo');
    assert(!refused.ok&&JSON.stringify([model.value,model.undo,model.redo])===branches,'No-op or rejected provider changed an author branch');
    model.fault=undefined;
    const hold=await holdAccess(scope.projectId);let delayed:ReturnType<typeof invoke>|undefined;
    try{
      await act(async()=>{delayed=Dexie.ignoreTransaction(()=>invoke(scope,first,'redo'));await pause();});
      await click(action('Render model again'));
      assert(action('Undo model').disabled,'The provider did not stay busy across the inline render');
    }finally{hold.release();await hold.done;}
    assert(delayed,'No delayed operation was admitted');
    await act(async()=>{expect(await delayed!,true,true);await pause();});
    assert(display()==='2'&&(await descriptor()).providerToken===first.providerToken,'Rerender replaced the model or canceled its pending operation');
    const old=model,oldBranch=JSON.stringify([old.value,old.undo,old.redo]);
    let entered=false,release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    old.gate=()=>{entered=true;return held;};
    const retiring=invoke(scope,first,'undo');
    try{await until(()=>entered,'The callback never reached its own await');await click(action('Replace model'));}finally{release();}
    expect(await retiring,false,false);
    const replacement=await descriptor();
    assert(replacement.instanceId===first.instanceId&&replacement.providerToken!==first.providerToken&&display()==='0'&&JSON.stringify([old.value,old.undo,old.redo])===oldBranch,'An asynchronous old model mutated after replacement or kept its token');
    expect(await invoke(scope,first,'redo'),false,false);
    assert(JSON.stringify(await reader.read())===beforeFault&&!probe().querySelector('[role="alert"]'),'Old work changed the replacement or persisted data');
    checks.push('Live SDK model selection checks stamps and unranked priority, handles errors without fallback, preserves branches and invalidates an async old model within the same mount');
  },true,ModelNotebook);
  return checks;
}

export async function testSourceAuthorUndoableCommand(): Promise<string[]> {
  const checks: string[] = [];
  type Provider = {instanceId: string; providerToken: string; providerId: string; canUndo: boolean; canRedo: boolean};
  type Scope = {projectId: string; documentId: string; namespace: string};
  async function listed(scope: Scope, id: string): Promise<Provider[]> {
    const reply = await runBridgeTool('wh_local_tool_undo_provider_list', scope);
    assert(reply.ok, JSON.stringify(reply));
    return (reply.result as {providers: Provider[]}).providers.filter(provider => provider.providerId === id);
  }
  function invoke(scope: Scope, provider: Provider, mode: LocalToolUndoMode) {
    const {instanceId, providerId, providerToken} = provider;
    return runBridgeTool('wh_local_tool_undo_provider_run', {...scope, instanceId, providerId, providerToken, mode});
  }
  function expectProvider(reply: Awaited<ReturnType<typeof invoke>>, available: boolean, applied: boolean) {
    assert(reply.ok && JSON.stringify(reply.result) === JSON.stringify({available, applied}), JSON.stringify(reply));
  }
  async function shortcut(target: HTMLElement, redo = false) {
    const event = new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true});
    await act(async () => { target.dispatchEvent(event); await pause(); });
    return event.defaultPrevented;
  }

  await withSourceBlockFocusFixture(async fixture => {
    const scope = {projectId: fixture.projectId, documentId: fixture.documentId, namespace: fixture.namespace};
    const reader = createLocalToolClient(scope.projectId, documentNotebook, {documentId: scope.documentId, readOnly: true});
    const principal = () => sourceHost(main(), scope.documentId)!;
    const list = (host: HTMLElement) => node<HTMLElement>('section[aria-label="Review shortlist"]', host);
    const marks = (host: HTMLElement) => [...list(host).querySelectorAll('button[aria-pressed="true"]')].map(item => item.getAttribute('aria-label'));
    await click(button(principal(), 'Add review checklist'));
    await until(() => list(principal()).querySelectorAll('button[aria-pressed]').length >= 3, 'Checklist items did not become available');
    const saved = JSON.stringify(await reader.read());
    const choices = [...list(principal()).querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    await click(choices[0]); await click(choices[1]);
    assert(marks(principal()).length === 2, 'Shortlist did not mark both items');
    assert(!await shortcut(node('textarea', principal())), 'Native note Undo was intercepted');
    assert(await shortcut(choices[1]), 'Shortlist Undo shortcut was not handled');
    await until(() => marks(principal()).length === 0, 'One anchored Undo did not reverse both marks');
    assert(await shortcut(choices[0], true), 'Shortlist Redo shortcut was not handled');
    await until(() => marks(principal()).length === 2, 'One anchored Redo did not restore both marks');
    const entries = await listed(scope, 'review-shortlist');
    assert(entries.length === 1 && entries[0].canUndo && !entries[0].canRedo, 'Shortlist did not publish its live journal');
    const principalProvider = entries[0];
    await act(async () => { expectProvider(await invoke(scope, principalProvider, 'undo'), true, true); });
    assert(marks(principal()).length === 0, 'Provider Undo did not reverse the visible batch');
    await act(async () => { expectProvider(await invoke(scope, principalProvider, 'redo'), true, true); });
    assert(marks(principal()).length === 2, 'Provider Redo did not restore the visible batch');

    await act(async () => {
      const opened = await runBridgeTool('wh_local_tool_document_open', {projectId: scope.projectId, documentId: scope.documentId, blockId: 'items'});
      assert(opened.ok && JSON.stringify(opened.result) === JSON.stringify({available: true, applied: true}), JSON.stringify(opened));
      await pause();
    });
    await until(() => (activeCompanion()?.querySelectorAll('section[aria-label="Review shortlist"] button[aria-pressed]').length ?? 0) >= 3, 'Companion shortlist rows were not available');
    const companion = () => sourceHost(activeCompanion()!, scope.documentId)!;
    assert(marks(companion()).length === 0 && marks(principal()).length === 2, 'Companion reused the principal selection');
    await click(node('button[aria-pressed]', list(companion())));
    await click(button(list(companion()), 'Undo selection'));
    await until(() => marks(companion()).length === 0, 'Companion Undo did not settle');
    assert(marks(principal()).length === 2, 'Companion Undo changed the principal');
    const both = await listed(scope, 'review-shortlist');
    assert(both.length === 2 && both.some(entry => entry.providerToken === principalProvider.providerToken) &&
      both.some(entry => entry.providerToken !== principalProvider.providerToken && entry.canRedo), 'Companion did not publish its own journal');
    const primaryButtons = () => [...list(principal()).querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    await click(primaryButtons()[2]);
    await click(node('button[aria-pressed]', list(companion())));
    await click(primaryButtons()[0]);
    assert(await shortcut(primaryButtons()[0]), 'Principal Undo did not run after an intervening companion step');
    await until(() => marks(principal()).length === 3, 'A companion step did not break the principal group');
    assert(marks(companion()).length === 1, 'Principal Undo changed the companion selection');
    assert(JSON.stringify(await reader.read()) === saved, 'Session selection wrote the Source document');
    checks.push('Real shortlist reverses consecutive marks through keys and the opt-in provider, preserves native text Undo and keeps companion selection and saved data separate');
  });

  interface Model {
    marks: Set<string>;
    stale: Set<string>;
    failUndo?: string;
    failRedo?: string;
    staleError?: string;
    wait?: {id: string; promise: Promise<void>};
  }
  const model = (): Model => ({marks: new Set(), stale: new Set()});
  const models = {root: model(), child: model(), peer: model(), sibling: model(), nested: model(), unavailable: model()};
  type Name = keyof typeof models;
  type History = ReturnType<typeof useLocalToolUndoableCommand<LinkedNotebookState, Model>>;
  const histories = new Map<Name, History>();
  const calls: string[] = [];
  const Notebook = documentNotebook.component;
  const command = (id: string, batchKey?: string): LocalToolUndoableCommand<Model> => ({
    label: {en: id, es: id}, batchKey,
    isStale(current) {
      if (current.staleError === id) throw Error('stale probe failed');
      return current.stale.has(id);
    },
    async undo(current, operation) {
      calls.push('undo:' + id);
      if (current.wait?.id === id) await current.wait.promise;
      if (!operation.isCurrent() || current.failUndo === id) return false;
      current.marks.delete(id);
      return true;
    },
    async redo(current, operation) {
      calls.push('redo:' + id);
      if (!operation.isCurrent() || current.failRedo === id) return false;
      current.marks.add(id);
      return true;
    },
  });
  function Probe({name, client, context, selected, expose = false}: LocalToolProps<LinkedNotebookState> & {name: Name; selected: Model; expose?: boolean}) {
    const history = useLocalToolUndoableCommand(name === 'unavailable' ? null : client, context, selected,
      expose ? {expose: {id: 'exposed-inverse-probe'}} : undefined);
    useLayoutEffect(() => {
      histories.set(name, history);
      return () => { histories.delete(name); };
    }, [name, history]);
    return <button type="button" data-undo-probe={name}>{name}</button>;
  }
  function ProbedNotebook(props: LocalToolProps<LinkedNotebookState>) {
    const [child, setChild] = useState(models.child);
    const [anchor, setAnchor] = useState(true);
    const [expose, setExpose] = useState(false);
    return <><Notebook {...props}/>
      <Probe {...props} name="root" selected={models.root}/>
      <Probe {...props} name="unavailable" selected={models.unavailable}/>
      <LocalToolUndoAnchor>
        <Probe {...props} name="sibling" selected={models.sibling}/>
      </LocalToolUndoAnchor>
      {anchor && <LocalToolUndoAnchor>
        <Probe {...props} name="child" selected={child} expose={expose}/>
        <Probe {...props} name="peer" selected={models.peer}/>
        <input aria-label="Native text in anchor"/>
        <LocalToolUndoBoundary><Probe {...props} name="nested" selected={models.nested}/></LocalToolUndoBoundary>
      </LocalToolUndoAnchor>}
      <button type="button" onClick={() => { models.child = model(); setChild(models.child); }}>Replace command model</button>
      <button type="button" onClick={() => setExpose(value => !value)}>Toggle command exposure</button>
      <button type="button" onClick={() => setAnchor(false)}>Retire command anchor</button>
    </>;
  }

  await withFixture('undoable-command-sdk', false, async fixture => {
    const host = () => sourceHost(main(), fixture.sourceId)!;
    const target = (name: Name) => node<HTMLElement>('[data-undo-probe="' + name + '"]', host());
    const history = (name: Name) => { const value = histories.get(name); assert(value, 'Missing controller ' + name); return value; };
    const record = async (name: Name, id: string, key?: string) => {
      const spec = command(id, key);
      await act(async () => {
        models[name].marks.add(id);
        assert(history(name).push(spec), 'Refused fixture push: ' + id);
      });
      // Existing entries keep the callbacks captured at push.
      spec.undo = async () => { throw Error('mutated callback'); };
    };
    const reverse = async (name: Name, mode: LocalToolUndoMode, expected: boolean) => {
      await act(async () => { assert(await history(name)[mode]() === expected, 'Unexpected ' + mode + ' result for ' + name); });
    };
    const expectCalls = (expected: string[]) => assert(JSON.stringify(calls.splice(0)) === JSON.stringify(expected), 'Wrong inversion order: ' + JSON.stringify(expected));
    await until(() => !!histories.get('child')?.available && !!histories.get('nested')?.available, 'Command probes did not mount');
    assert(!history('unavailable').available && !history('unavailable').push(command('no-client')) && !await history('unavailable').undo(), 'Null client offered a history');

    await record('child', 'old-child');
    await record('root', 'new-root');
    await record('sibling', 'latest-sibling');
    assert(!await shortcut(target('nested')), 'An empty nested Boundary consumed an outer history');
    assert(!await shortcut(node('input[aria-label="Native text in anchor"]', host())), 'Native input in anchor consumed Undo');
    assert(await shortcut(target('child')), 'Child did not consume its own Undo');
    await until(() => !history('child').busy && calls.length > 0, 'Child inversion did not settle');
    expectCalls(['undo:old-child']);
    assert(models.root.marks.has('new-root') && models.sibling.marks.has('latest-sibling'), 'A deeper candidate did not beat root and exclude sibling');
    assert(await shortcut(target('root')), 'Root did not retain its own Undo');
    await until(() => !history('root').busy && calls.length > 0, 'Root inversion did not settle');
    expectCalls(['undo:new-root']);
    await record('child', 'rank-child');
    await record('peer', 'rank-peer');
    assert(await shortcut(target('child')), 'Same-level Undo was not handled');
    await until(() => !history('peer').busy && calls.length > 0, 'Same-level inversion did not settle');
    expectCalls(['undo:rank-peer']);

    await record('child', 'barrier-before', 'barrier');
    await record('sibling', 'intervening-anchor');
    await record('child', 'barrier-after', 'barrier');
    await reverse('child', 'undo', true);
    expectCalls(['undo:barrier-after']);
    assert(models.child.marks.has('barrier-before'), 'A shared step in a sibling anchor did not break batching');

    for (const id of ['group-a', 'group-b', 'group-c']) await record('child', id, 'partial');
    models.child.failUndo = 'group-b';
    await reverse('child', 'undo', false);
    expectCalls(['undo:group-c', 'undo:group-b']);
    assert(models.child.marks.has('group-b') && !models.child.marks.has('group-c') &&
      !history('child').canRedo && !!history('child').error &&
      !history('child').push(command('partial-push')), 'Partial Undo lost its unfinished direction');
    models.child.failUndo = undefined;
    await reverse('child', 'undo', true);
    expectCalls(['undo:group-b', 'undo:group-a']);
    models.child.failRedo = 'group-b';
    await reverse('child', 'redo', false);
    expectCalls(['redo:group-a', 'redo:group-b']);
    assert(models.child.marks.has('group-a') && !models.child.marks.has('group-b') && !history('child').canUndo, 'Partial Redo advanced past the refusal');
    models.child.failRedo = undefined;
    await reverse('child', 'redo', true);
    expectCalls(['redo:group-b', 'redo:group-c']);

    await record('child', 'stale-skip', 'stale');
    models.child.staleError = 'stale-skip';
    await reverse('child', 'undo', false);
    expectCalls([]);
    assert(history('child').error === 'stale probe failed', 'A throwing stale predicate lost feedback');
    models.child.staleError = undefined;
    models.child.stale.add('stale-skip');
    await reverse('child', 'undo', true);
    expectCalls(['undo:group-c', 'undo:group-b', 'undo:group-a']);

    await record('child', 'old-first', 'late'); await record('child', 'old-last', 'late');
    const old = models.child;
    const oldHistory = history('child');
    let release!: () => void;
    old.wait = {id: 'old-last', promise: new Promise<void>(resolve => { release = resolve; })};
    let running!: Promise<boolean>;
    await act(async () => { running = oldHistory.undo(); await pause(); });
    try {
      await until(() => calls.includes('undo:old-last'), 'The inverse did not reach its await');
      assert(oldHistory.busy && !oldHistory.push(command('busy-push')), 'Busy push was accepted');
      await click(button(host(), 'Replace command model'));
    } finally {
      release();
    }
    await act(async () => { assert(!await running, 'Retired inverse reported completion'); });
    expectCalls(['undo:old-last']);
    assert(old.marks.has('old-last') && old.marks.has('old-first') && models.child.marks.size === 0 &&
      !oldHistory.push(command('old-model')) && !await oldHistory.undo(), 'Old work retargeted the replacement model');

    const scope = {projectId: fixture.projectId, documentId: fixture.sourceId, namespace: documentNotebook.namespace};
    await click(button(host(), 'Toggle command exposure'));
    await until(() => !!histories.get('child')?.available, 'Opt-in provider did not become available');
    await record('child', 'exposed-busy');
    const exposed = await listed(scope, 'exposed-inverse-probe');
    assert(exposed.length === 1 && exposed[0].canUndo, 'Opt-in probe did not list its live step');
    let unlock!: () => void;
    let holdEntered = false;
    const held = new Promise<void>(resolve => { unlock = resolve; });
    const transaction = db.transaction('rw', db.projects, async () => {
      await db.projects.get(scope.projectId);
      holdEntered = true;
      await Dexie.waitFor(held);
    });
    let pending!: ReturnType<typeof invoke>;
    try {
      await until(() => holdEntered, 'Project access hold did not start');
      await act(async () => { pending = Dexie.ignoreTransaction(() => invoke(scope, exposed[0], 'undo')); await pause(); });
      assert(history('child').busy && !history('child').push(command('during-access')), 'Push was accepted during provider access');
      expectCalls([]);
    } finally {
      unlock();
      await transaction;
    }
    await act(async () => { expectProvider(await pending, true, true); });
    expectCalls(['undo:exposed-busy']);
    const exposedHistory = history('child');
    await click(button(host(), 'Toggle command exposure'));
    expectProvider(await invoke(scope, exposed[0], 'redo'), false, false);
    assert(!exposedHistory.push(command('retired-exposure')) && !history('child').canRedo, 'Changed opt-in retained the old journal or token');

    await record('child', 'retired-anchor');
    const retired = history('child');
    await click(button(host(), 'Retire command anchor'));
    assert(!retired.push(command('after-anchor')) && !await retired.undo(), 'A withdrawn anchor retained live commands');
    expectCalls([]);
    checks.push('Anchor depth and same-level chronology, batch barriers, partial inverse cursors, stale handling and retirement work through the Source host');
  }, true, ProbedNotebook);
  return checks;
}

function ownedInline(blockId: string) {
  return document.querySelector<HTMLElement>(`[data-wh-source-live-view][data-source-block-id="${blockId}"]`);
}
function ownedPanel(blockId: string) {
  return document.querySelector<HTMLElement>(`[data-owned-block-panel="${blockId}"]`);
}
const ownedRound = (view: ParentNode | null) =>
  view?.querySelector('section[aria-label="Initiative turns"] .tabular-nums')?.textContent ?? null;

export interface OwnedBlockPanelFixture {
  projectId: string;
  ownerKind: 'codex';
  ownerId: string;
  blockId: string;
  otherOwnerId: string;
  otherEraId: string;
  observe(): {inline: boolean; panel: boolean; unavailable: boolean; companionCount: number; inlineRound: string | null; panelRound: string | null};
  openOtherOwner(): Promise<string>;
  retireOwner(): Promise<void>;
}

export async function withOwnedBlockPanelFixture<T>(run: (fixture: OwnedBlockPanelFixture) => Promise<T>): Promise<T> {
  return withFixture('owned-panel', false, async fixture => {
    const {projectId, ownerId, blockId} = fixture, otherEraId = crypto.randomUUID();
    await saveWorldEra(projectId, {id: otherEraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1}, null);
    await openFromLibrary(fixture, 'codex', ownerId, 'main');
    await until(() => !!dialogInPane(main().dataset.enginePaneId!, fixture.ownerTitle), 'Codex owner detail did not open');
    await click(button(dialogInPane(main().dataset.enginePaneId!, fixture.ownerTitle)!, 'Edit'));
    const ownerDialog = () => dialogInPane(main().dataset.enginePaneId!, 'Edit Entry');
    await until(() => ownedRound(ownedInline(blockId)) === '1' && !!ownerDialog(), 'Live Codex editor and Owned atom did not mount');
    return run({
      projectId, ownerKind: 'codex', ownerId, blockId, otherOwnerId: fixture.targetId, otherEraId,
      observe: () => ({
        inline: !!ownedInline(blockId), panel: !!ownedPanel(blockId),
        unavailable: !!document.querySelector('[data-owned-block-panel-unavailable]'),
        companionCount: document.querySelectorAll('[data-testid^="workspace-panel-"]').length,
        inlineRound: ownedRound(ownedInline(blockId)), panelRound: ownedRound(ownedPanel(blockId)),
      }),
      openOtherOwner: async () => {
        await openFromLibrary(fixture, 'codex', fixture.targetId, 'beside');
        const paneId = activeCompanion()?.dataset.enginePaneId;
        assert(paneId, 'Other owner tab missing');
        await until(() => !!dialogInPane(paneId, fixture.targetTitle), 'Other Codex owner detail missing');
        await click(button(dialogInPane(paneId, fixture.targetTitle)!, 'Edit'));
        await until(() => !!dialogInPane(paneId, 'Edit Entry')?.querySelector('[data-wh-source-live-view]'), 'Other Codex owner not mounted');
        return paneId;
      },
      retireOwner: async () => {
        await click(button(ownerDialog()!, 'Cancel'));
        await until(() => !ownerDialog() && !ownedInline(blockId) && !ownedPanel(blockId), 'Closing the Codex editor did not revoke its atom panel');
      },
    });
  }, false, undefined, 'codex');
}

export async function testOwnedBlockPanel(): Promise<string[]> {
  const checks = await withOwnedBlockPanelFixture(async fixture => {
    const {projectId, ownerId, blockId} = fixture;
    const owner = {kind: 'codex', documentId: ownerId};
    const args = {projectId, owner, blockId};
    const mounted = () => ownedPanel(blockId);
    const editorOf = () => {
      const view = ownedInline(blockId)?.closest('.ProseMirror') as (HTMLElement & {editor?: Editor}) | null;
      assert(view?.editor, 'Real mounted Tiptap editor missing');
      return view.editor;
    };
    const atom = (id: string) => {
      const editor = editorOf();
      let value: {pos: number; size: number; attrs: {envelope: {revision: number}}} | undefined;
      editor.state.doc.descendants((child, pos) => {
        if (child.type.name === 'sourceToolBlock' && child.attrs.envelope?.id === id)
          value = {pos, size: child.nodeSize, attrs: child.attrs as NonNullable<typeof value>['attrs']};
      });
      assert(value, 'Exact mounted atom missing ' + id);
      return value;
    };
    const persisted = () => db.codexEntries.get(ownerId);
    const read = () => runBridgeTool('wh_local_tool_block_read', args);
    const open = async (overrides = {}) => {
      let result;
      await act(async () => { result = await runBridgeTool('wh_local_tool_block_open', {...args, ...overrides}); });
      assert(result && (result as {ok: boolean}).ok, JSON.stringify(result));
      return (result as {result: {available: boolean; applied: boolean}}).result;
    };
    const before = await persisted(), route = mainLocation(), editor = editorOf();
    const prose = editor.state.doc.textContent, selection = JSON.stringify(editor.state.selection.toJSON());
    const neighbor = JSON.stringify(atom(blockId + '-neighbor').attrs), revision = atom(blockId).attrs.envelope.revision;
    const tabs = await runBridgeTool('wh_workspace_tabs', {projectId});
    assert(tabs.ok, JSON.stringify(tabs));
    await click(button(ownedInline(blockId)!, 'Open block beside'));
    await until(() => ownedRound(mounted()) === '1', 'Normal inline action did not open live Owned panel');
    assert(mainLocation() === route && editorOf() === editor && !mounted()!.closest('[inert]'), 'Panel must retain actual editor and be reachable');
    const panelControl = button(mounted()!, 'Next round');
    panelControl.focus();
    assert(document.activeElement === panelControl, 'The companion cannot receive focus while the Codex editor is open');
    await act(async () => {
      panelControl.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    });
    assert(editorOf() === editor && document.activeElement === panelControl, 'Codex dialog intercepted a companion key');
    const dedup = await open();
    assert(dedup.available && dedup.applied && fixture.observe().companionCount === 1, 'Exact open did not deduplicate');
    for (const testId of ['workspace-to-main', 'workspace-tab-pin', 'workspace-tab-duplicate']) {
      const control = node<HTMLButtonElement>(`[data-testid="${testId}"]`);
      assert(control.disabled, 'Temporary panel exposed unavailable control ' + testId);
      await click(control);
    }
    assert(mainLocation() === route && editorOf() === editor && fixture.observe().companionCount === 1,
      'Temporary panel changed its owner, placement or tab identity');
    const tabsAfter = await runBridgeTool('wh_workspace_tabs', {projectId});
    assert(JSON.stringify(tabsAfter) === JSON.stringify(tabs) && JSON.stringify(await persisted()) === JSON.stringify(before), 'Opening wrote owner or durable tab state');
    for (const outside of [{owner: {...owner, documentId: fixture.otherOwnerId}}, {eraId: fixture.otherEraId}]) {
      const result = await open(outside);
      assert(!result.available && !result.applied, 'Open escaped live owner or era');
    }
    for (const [label, round, increment] of [['Next round', '2', 1], ['Undo', '1', 2], ['Redo', '2', 3]] as const) {
      await click(button(mounted()!, label));
      await until(() => ownedRound(mounted()) === round && ownedRound(ownedInline(blockId)) === round, 'Two presentations did not converge after ' + label);
      assert(atom(blockId).attrs.envelope.revision === revision + increment, 'Expected one exact atom revision after ' + label);
      assert(editor.state.doc.textContent === prose && JSON.stringify(atom(blockId + '-neighbor').attrs) === neighbor &&
        JSON.stringify(editor.state.selection.toJSON()) === selection, 'Panel changed neighboring atom, prose or selection');
    }
    const companionId = activeCompanion()?.dataset.enginePaneId;
    assert(companionId, 'Active companion not found');
    const otherPaneId = await fixture.openOtherOwner();
    const otherDialog = () => dialogInPane(otherPaneId, 'Edit Entry');
    await click(node(`[data-testid="workspace-tab-${companionId}"]`));
    const ownerDialog = () => dialogInPane(main().dataset.enginePaneId!, 'Edit Entry');
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText('Local retained prose ', 1));
    });
    const baseline = await read();
    assert(baseline.ok, JSON.stringify(baseline));
    const expectedVersion = (baseline.result as {ownerVersion: string}).ownerVersion;
    const remove = () => runBridgeTool('wh_local_tool_block_remove', {...args, expectedVersion});
    const input = node<HTMLInputElement>('form input:not([type="number"])', mounted()!);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Unsaved participant');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    assert(!button(mounted()!, 'Add participant').disabled, 'Panel draft did not reach React state');
    await click(button(ownerDialog()!, 'Save Changes'));
    assert(ownerDialog()?.textContent?.includes('Save or discard the block changes before saving the card.'), 'Save ignored the exact owner draft');
    await click(button(ownerDialog()!, 'Cancel'));
    assert(ownerDialog()?.querySelector('[data-testid="codex-owned-close-pending"]') && input.value === 'Unsaved participant', 'Owner Cancel discarded the panel draft');
    await click(node('[aria-label="Close"]', ownerDialog()!));
    assert(ownerDialog() && mounted() && input.value === 'Unsaved participant', 'Owner X discarded the panel draft');
    await click(node(`[data-testid="workspace-tab-${otherPaneId}"]`));
    await click(button(otherDialog()!, 'Save Changes'));
    await until(() => !otherDialog(), 'A draft in A blocked saving distinct mounted owner B');
    await click(node(`[data-testid="workspace-tab-${companionId}"]`));
    assert(input.value === 'Unsaved participant', 'Saving another owner altered the draft');
    await click(node(`[data-testid="workspace-close-tab-${companionId}"]`));
    assert(mounted() && input.value === 'Unsaved participant', 'Closing companion discarded the draft');
    const current = atom(blockId);
    await act(async () => { editor.view.dispatch(editor.state.tr.delete(current.pos, current.pos + current.size)); });
    assert(atom(blockId), 'Owner editor removed an atom with a panel draft');
    const denied = await remove();
    assert(!denied.ok && JSON.stringify(denied).includes('pending') && JSON.stringify(await persisted()) === JSON.stringify(before),
      'Durable removal was not blocked by the exact panel draft: ' + JSON.stringify(denied));
    await click(button(mounted()!, 'Discard draft and reload'));
    await until(() => input.value === '', 'Normal Discard did not release the draft');
    const removed = await remove();
    assert(removed.ok, JSON.stringify(removed));
    await until(() => fixture.observe().unavailable && !mounted(), 'Durable deletion did not retire the panel');
    const late = await open();
    assert(!late.available && !late.applied, 'Dirty retained owner reopened a durably removed atom');
    const missing = await read();
    assert(!missing.ok && JSON.stringify(missing).includes('local_tool_block_missing_or_ambiguous'), 'Removed atom was still persisted');
    assert(ownerDialog() && ownedInline(blockId), 'The dirty editor did not retain the cached atom needed to exercise its save guard');
    await click(button(ownerDialog()!, 'Save Changes'));
    await until(() => !!ownerDialog()?.querySelector('[data-conflict-field="content"]'), 'Stale owner save did not show an exact content conflict');
    await click(button(node('[data-conflict-field="content"]', ownerDialog()!), 'Keep my version'));
    await until(() => !ownerDialog()?.querySelector('[data-conflict-field="content"]'), 'Normal conflict resolution did not rebase the owner');
    await click(button(ownerDialog()!, 'Save Changes'));
    await until(() => !ownerDialog(), 'Saving after rebasing local prose did not finish');
    const saved = await persisted();
    assert(saved?.content.includes('Local retained prose ') && saved.content.includes('Tail prose remains exact.') &&
      saved.content.includes(blockId + '-neighbor'), 'Rebasing the retired atom lost unrelated prose or neighboring block');
    const afterStaleSave = await read();
    assert(!afterStaleSave.ok && JSON.stringify(afterStaleSave).includes('local_tool_block_missing_or_ambiguous'), 'Stale owner save resurrected the removed atom');
    return [
      'Real Codex inline and panel share one atom, deduplicate exact MCP opens and leave business/tab persistence intact on open.',
      'Panel action, Undo and Redo update one atom revision and preserve editor, selection, prose and neighbor.',
      'Temporary panel cannot be promoted, pinned or duplicated. Draft protects owner close, same-owner Save, tab close and both removal paths. Other-owner Save is isolated. Keeping local prose after a conflict does not restore the retired atom.',
    ];
  });

  await withOwnedBlockPanelFixture(async fixture => {
    const {projectId, ownerId, blockId} = fixture;
    const before = await db.codexEntries.get(ownerId);
    let started = false, release = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const unregister = registerPendingFlusher('owned-open-' + projectId, async () => {
      started = true;
      await waiting;
      return true;
    });
    let pending: ReturnType<typeof runBridgeTool> | undefined;
    try {
      await act(async () => {
        pending = runBridgeTool('wh_local_tool_block_open', {projectId, owner: {kind: 'codex', documentId: ownerId}, blockId});
        await pause();
      });
      await until(() => started, 'Normal workspace flusher did not intercept the open');
      await fixture.retireOwner();
    } finally {
      release();
      unregister();
      await act(async () => { await pending; });
    }
    const reply = await pending;
    assert(reply?.ok && JSON.stringify(reply.result) === JSON.stringify({available: false, applied: false}) &&
      fixture.observe().companionCount === 0 && JSON.stringify(await db.codexEntries.get(ownerId)) === JSON.stringify(before),
      'Admission used the withdrawn session after the workspace flush');
  });
  checks.push('Owner retirement during the real pending flush rejects admission and leaves owner and tabs exact.');
  await withFixture('owned-writing', false, async fixture => {
    const {projectId, ownerId, blockId} = fixture;
    const before = await db.writings.get(ownerId);
    await openFromLibrary(fixture, 'writings', ownerId, 'beside');
    await until(() => ownedRound(ownedInline(blockId)) === '1' && !!activeCompanion(), 'Real Writing owner editor did not mount in its tab');
    const ownerPane = activeCompanion()!, inline = ownedInline(blockId)!;
    await click(button(inline, 'Open block beside'));
    await until(() => ownerPane.hidden && ownedRound(ownedPanel(blockId)) === '1', 'Writing owner should stay mounted but hidden behind the atom panel');
    assert(inline.isConnected && JSON.stringify(await db.writings.get(ownerId)) === JSON.stringify(before), 'Opening remounted or persisted the Writing owner');
    await click(button(ownedPanel(blockId)!, 'Next round'));
    await until(() => ownedRound(ownedPanel(blockId)) === '2' && ownedRound(inline) === '2', 'Panel did not edit the still-live hidden Writing owner');
    const result = await runBridgeTool('wh_local_tool_block_open', {projectId, owner: {kind: 'writings', documentId: ownerId}, blockId});
    assert(result.ok && JSON.stringify(result.result) === JSON.stringify({available: true, applied: true}), 'Hidden Writing owner lost exact MCP access');
    assert(document.querySelectorAll('[data-testid^="workspace-panel-"]').length === 2, 'Writing atom request did not deduplicate');
  }, false, undefined, 'writings');
  return [...checks, 'An editable Writing in a hidden companion keeps its exact atom and shares edits and MCP admission with its panel.'];
}
