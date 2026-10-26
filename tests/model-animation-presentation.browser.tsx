import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import type { Project } from '@/types';
import ModelViewerEngine, { ModelView } from '@/engines/model-viewer/ModelViewerEngine';
import { assetBytes, modelStoredBytes, validateGlb, type ModelAsset } from '@/engines/model-viewer/model';
import { readerModel, modelReaderMarkup } from '@/engines/model-viewer/readerMarkup';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { onDataChanged } from '@/engines/_shared/dataChanged';
import { readWorldDocument, saveEraDocument, saveWorldEra } from '@/services/worldEras/store';
import { validateProjectArchiveMetadata } from '@/services/projectArchiveMetadata';
import { clearUndoJournal, getUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';
import { modelAnimationPresentationFixture } from './model-animation-presentation-fixture';

type Scope = { projectId: string; eraId?: string };
type Presentation = { order?: number[]; labels?: Record<string, string> };
type PresentedAsset = ModelAsset & { animationPresentation?: Presentation };
interface Inventory { projectId: string; modelId: string; version: string; order: number[]; clips: Array<{ index: number; name: string; label: string }> }
interface ActionResult extends Inventory { receiptId?: string; __audit?: { projectId?: string; entityId?: string; kind?: string; summary?: string; before?: Record<string, unknown> } }
interface CaptureReceipt { sha256: string; width: number; height: number; marker: { count: number; x: number | null; y: number | null } }
type CaptureWindow = Window & { __modelAnimationCapture?: (name: string, metrics: Record<string, unknown>) => Promise<CaptureReceipt> };
const GET = 'wh_model_animation_get', ACTION = 'wh_model_animation_action';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, child]) => child !== undefined).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const encoded = (value: unknown) => JSON.stringify(canonical(value));
const equal = (a: unknown, b: unknown, message: string) => check(encoded(a) === encoded(b), message);
const pause = (ms = 35) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>, message: string) {
  for (let n = 0; n < 200; n++) { if (await predicate()) return; await act(async () => { await pause(); }); }
  throw Error(message);
}
async function click(node: HTMLElement) { await act(async () => { node.click(); await pause(); }); }
async function select(node: HTMLSelectElement, value: number) { await act(async () => { node.value = String(value); node.dispatchEvent(new Event('change', { bubbles: true })); await pause(); }); }
async function input(node: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
}
function button(host: ParentNode, label: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  check(node, 'Missing button: ' + label); return node;
}
function animationSelect(host: ParentNode) { const node = host.querySelector<HTMLSelectElement>('[data-testid="model-animation"]'); check(node, 'Missing animation selector'); return node; }
function canvas(host: ParentNode) { const node = host.querySelector<HTMLCanvasElement>('[data-testid="model-viewport"] canvas'); check(node, 'Missing actual model canvas'); return node; }
function withoutPresentation(asset: PresentedAsset) { const result = { ...asset }; delete result.animationPresentation; return result; }
async function stored(scope: Scope, id: string): Promise<PresentedAsset> { const read = await readWorldDocument(scope, 'model-viewer', id); check(read, 'Missing scoped model'); return read.document.root as unknown as PresentedAsset; }
async function allRows() { return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))); }
async function accepted(reply: Promise<BridgeReply>, message: string): Promise<unknown> { const result = await reply; check(result.ok, message + ': ' + JSON.stringify(result)); return result.result; }
async function rejected(reply: Promise<BridgeReply>, message: string) { const result = await reply; check(!result.ok, message); return result; }
async function read(scope: Scope, id: string): Promise<Inventory> {
  const result = await accepted(runBridgeTool(GET, { ...scope, modelId: id }), 'Animation presentation getter missing or failed') as Inventory;
  check(result.projectId === scope.projectId && result.modelId === id && typeof result.version === 'string' && !!result.version, 'Getter lost identity/version');
  check(!encoded(result).includes('base64') && !encoded(result).includes('dataUrl'), 'Getter leaked binary payload');
  check(result.order.length === 3 && new Set(result.order).size === 3 && result.order.every(index => Number.isInteger(index) && index >= 0 && index < 3), 'Getter lost a source clip');
  equal(result.clips.map(clip => clip.index), result.order, 'Getter clips and presentation order differ');
  return result;
}
async function action(scope: Scope, id: string, args: Record<string, unknown>): Promise<ActionResult> {
  return await accepted(runBridgeTool(ACTION, { ...scope, modelId: id, expectedVersion: (await read(scope, id)).version, ...args }), 'Animation presentation action failed') as ActionResult;
}
function entry(scope: Scope, id: string, result: ActionResult) {
  check(typeof result.receiptId === 'string' && !!result.receiptId, 'Mutation did not return a receipt');
  const audit = result.__audit; check(audit?.before && Object.keys(audit.before).length === 1, 'Audit did not contain one small opaque receipt');
  check(Object.values(audit.before)[0] === result.receiptId && encoded(audit.before).length < 512 && !encoded(audit).includes('base64'), 'Audit duplicates binary or presentation preimage');
  return { ...audit, tool: ACTION, ...scope, entityId: id, kind: 'update' };
}
async function undo(scope: Scope, id: string, result: ActionResult) {
  return accepted(runBridgeTool('__undo', { entry: entry(scope, id, result) }), 'Existing internal Undo route failed');
}
async function capture(name: string, host: HTMLElement, extra: Record<string, unknown> = {}) {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const view = canvas(host), rect = view.getBoundingClientRect(), selector = animationSelect(host), gl = view.getContext('webgl2');
  check(gl && !gl.isContextLost() && view.width > 0 && view.height > 0, 'Capture has no real WebGL');
  check(rect.width > 300 && rect.height >= 300, 'Current application CSS did not size the real viewport');
  const checkpoint = (window as CaptureWindow).__modelAnimationCapture; check(checkpoint, 'Specialized runner capture callback is required');
  return checkpoint(name, {
    canvas: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    drawingBuffer: { width: view.width, height: view.height }, viewport: { width: innerWidth, height: innerHeight },
    selectedSourceIndex: Number(selector.value), options: [...selector.options].map(option => ({ index: Number(option.value), label: option.textContent })),
    playing: host.querySelector('[data-testid="model-animation-play"]')?.textContent === 'Pause animation',
    loop: host.querySelector<HTMLInputElement>('[data-testid="model-animation-loop"]')?.checked,
    overflow: document.documentElement.scrollWidth > innerWidth,
    css: { fontFamily: getComputedStyle(host).fontFamily, color: getComputedStyle(selector).color, background: getComputedStyle(selector).backgroundColor }, ...extra,
  });
}

export async function testModelAnimationPresentation(): Promise<string[]> {
  const passed: string[] = [], P = 'synthetic-model-animation-presentation', F = P + '-foreign', scope = { projectId: P };
  const rootNode = document.getElementById('root'); check(rootNode, 'Missing root');
  rootNode.style.cssText = 'max-width:1200px;margin:20px auto;padding:0 24px';
  let root: Root | undefined = createRoot(rootNode);
  const note = (text: string) => { passed.push(text); console.log('PASS ' + text); };
  const project: Project = { id: P, title: 'Synthetic clip presentation', description: 'Authored local QA only.', mode: 'novelist', type: 'standalone', status: 'draft', color: '#957648', enabledEngines: ['model-viewer'], engineOrder: ['model-viewer'], createdAt: 1, updatedAt: 1 };
  const copiedProjects: string[] = [];
  clearUndoJournal(); useLocaleStore.setState({ locale: 'en' });
  try {
    await db.projects.bulkAdd([project, { ...project, id: F, title: 'Untouched foreign control' }]);
    const bytes = await modelAnimationPresentationFixture(), json = validateGlb(bytes);
    const sourceClips = json.animations as Array<{ name?: string; channels: unknown[] }>;
    equal(sourceClips.map(clip => clip.name), ['Same name', 'Same name', ''], 'Authored duplicate/empty fixture names changed');
    check(sourceClips.every(clip => clip.channels.length > 0), 'Fixture contains a clip without real movement');
    await act(async () => { root!.render(<StrictMode><MemoryRouter><ModelViewerEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(); });
    const fileInput = rootNode.querySelector<HTMLInputElement>('input[type="file"]'); check(fileInput, 'Missing normal import file picker');
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'Three-clips.glb', { type: 'model/gltf-binary' })); fileInput.files = transfer.files;
    await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    await until(() => rootNode.textContent?.includes('Model ready') === true && animationSelect(rootNode).options.length === 3, 'Normal UI import did not render all three clips');
    const model = (await db.projects.get(P))!.modelAssets![0] as PresentedAsset, id = model.id;
    check(!Object.hasOwn(model, 'animationPresentation'), 'Legacy import materialized a presentation');
    equal(new Uint8Array(assetBytes(model)), new Uint8Array(bytes), 'Import changed authored GLB bytes');
    const sibling = { ...model, id: id + '-sibling', name: 'Untouched sibling.glb' };
    await db.projects.update(P, { modelAssets: [model, sibling] });
    await db.projects.update(F, { modelAssets: [{ ...model, id: id + '-foreign' }] });
    const foreignBefore = encoded(await db.projects.get(F));
    const selector = animationSelect(rootNode);
    equal([...selector.options].map(option => option.textContent), ['Same name', 'Same name', 'animation_2'], 'Incumbent renderer names/fallback changed');
    for (const index of [0, 1, 2]) {
      await select(selector, index); check(Number(selector.value) === index, 'Duplicate/empty clip could not be selected by source index');
      await click(button(rootNode, 'Play animation')); await act(async () => { await pause(160); });
      check(button(rootNode, 'Pause animation'), 'Playback did not start for clip ' + index);
      await click(button(rootNode, 'Pause animation'));
    }
    const loop = rootNode.querySelector<HTMLInputElement>('[data-testid="model-animation-loop"]'); check(loop?.checked, 'Incumbent loop default missing');
    await click(loop); check(!loop.checked, 'Loop off stopped responding'); await click(loop); check(loop.checked, 'Loop on stopped responding');
    await select(selector, 1); await click(button(rootNode, 'Play animation')); await act(async () => { await pause(180); });
    const baseline = await capture('baseline', rootNode, { sourceNames: sourceClips.map(clip => clip.name), importedSize: model.size, controlsPositive: [0, 1, 2] });
    check(baseline.width === 1280 && baseline.height === 1000 && baseline.marker.count > 30, 'Baseline screenshot lacks the rendered authored marker');
    note('Existing normal file import renders three real clips, duplicate/empty names, source-index selection and play/pause/loop; compiled-CSS baseline captured');

    // First causal RED: everything above must succeed on the incumbent. No new
    // product symbol is imported; the absent dispatch route fails only here.
    const beforeRead = encoded(await allRows()), journalBeforeRead = encoded(getUndoJournal());
    const initial = await read(scope, id);
    equal(initial.order, [0, 1, 2], 'Absent presentation changed natural order');
    equal(initial.clips.map(clip => clip.name), ['Same name', 'Same name', ''], 'Getter lost original duplicate/empty names');
    equal(initial.clips.map(clip => clip.label), ['Same name', 'Same name', 'animation_2'], 'Getter default differs from incumbent renderer');
    check(initial.version.startsWith('sha256:'), 'Base does not use its existing content CAS token');
    check(encoded(await allRows()) === beforeRead && encoded(getUndoJournal()) === journalBeforeRead, 'Readonly getter wrote data/journal');
    check(getBridgeTool(GET)?.writes === false && getBridgeTool(ACTION)?.writes === true, 'New MCP tools have wrong readonly/write classification');
    note('Readonly getter exposes every source clip, preserves absence and binary-free inventory with existing Base CAS');

    await click(button(rootNode, 'Pause animation')); await click(button(rootNode, 'Rotate right'));
    const retainedCanvas = canvas(rootNode), pausedFrame = await capture('paused-before', rootNode);
    const renamed = await action(scope, id, { action: 'rename', index: 1, label: 'Lift' }); entry(scope, id, renamed);
    await until(() => animationSelect(rootNode).selectedOptions[0]?.textContent === 'Lift', 'Live UI did not adopt renamed selected source clip');
    check(canvas(rootNode) === retainedCanvas && Number(animationSelect(rootNode).value) === 1, 'Rename recreated canvas or changed source selection');
    check((await capture('paused-after-rename', rootNode)).sha256 === pausedFrame.sha256, 'Rename changed paused camera/pose/frame');
    const moved = await action(scope, id, { action: 'move', index: 1, position: 0 });
    await until(() => animationSelect(rootNode).options[0]?.value === '1', 'Live UI did not adopt full reordered presentation');
    equal((await read(scope, id)).order, [1, 0, 2], 'Move lost or replaced a clip');
    check(canvas(rootNode) === retainedCanvas && Number(animationSelect(rootNode).value) === 1 && rootNode.querySelector('[data-testid="model-animation-count"]')?.textContent === '1/3', 'Move changed source selection/count or recreated canvas');
    check((await capture('paused-after-move', rootNode)).sha256 === pausedFrame.sha256, 'Move changed paused camera/pose/frame');
    await click(button(rootNode, 'Next animation')); check(Number(animationSelect(rootNode).value) === 0, 'Next did not follow presentation order');
    await click(button(rootNode, 'Previous animation')); check(Number(animationSelect(rootNode).value) === 1, 'Previous did not keep source identity');
    note('Rename/move retain the identical actual Canvas, selected source index, paused camera/pose pixels and every navigation control');

    await click(button(rootNode, 'Play animation')); await act(async () => { await pause(350); });
    const phaseStart = await capture('phase-start', rootNode); await act(async () => { await pause(500); });
    const phaseBefore = await capture('phase-before', rootNode);
    const running = await action(scope, id, { action: 'rename', index: 1, label: 'Rising' }); entry(scope, id, running);
    await until(() => animationSelect(rootNode).selectedOptions[0]?.textContent === 'Rising', 'Running rename did not reach UI');
    const phaseAfter = await capture('phase-after', rootNode);
    for (const frame of [phaseStart, phaseBefore, phaseAfter]) check(frame.marker.count > 30 && frame.marker.x !== null && frame.marker.y !== null, 'Cannot measure actual animated marker');
    const vx = phaseBefore.marker.x! - phaseStart.marker.x!, vy = phaseBefore.marker.y! - phaseStart.marker.y!, magnitude = Math.hypot(vx, vy);
    check(magnitude > .5, 'Selected source clip did not visibly move');
    const progress = ((phaseAfter.marker.x! - phaseBefore.marker.x!) * vx + (phaseAfter.marker.y! - phaseBefore.marker.y!) * vy) / magnitude;
    check(progress >= -.75, 'Metadata rename restarted the visibly advancing clip phase');
    check(canvas(rootNode) === retainedCanvas && Number(animationSelect(rootNode).value) === 1 && loop.checked && button(rootNode, 'Pause animation'), 'Running rename reset viewport, selected clip, playback or loop');
    await click(button(rootNode, 'Pause animation'));
    const labelInput = rootNode.querySelector<HTMLInputElement>('input[aria-label="Animation label"]'); check(labelInput, 'Owner has no animation label editor');
    await input(labelInput, 'Rise from UI'); await click(button(rootNode, 'Save animation label'));
    await until(async () => (await read(scope, id)).clips[0].label === 'Rise from UI', 'Owner UI did not persist selected clip label');
    check(getUndoJournal().some(item => item.projectId === P && item.kind === 'asset'), 'Owner UI did not record its normal Undo journal');
    check(await undoLast(P) === 'undone', 'Normal UI Undo did not reverse presentation');
    await until(async () => (await read(scope, id)).clips[0].label === 'Rising', 'UI Undo did not restore prior selected label');
    check(canvas(rootNode) === retainedCanvas, 'UI edit/Undo recreated actual Canvas');
    note('Metadata preserves measured playback phase and loop; owner UI uses shared persistence and normal session Undo');

    const beforeReset = await stored(scope, id), reset = await action(scope, id, { action: 'reset' });
    check(!Object.hasOwn(await stored(scope, id), 'animationPresentation'), 'Reset did not restore absence');
    await undo(scope, id, reset); equal(await stored(scope, id), beforeReset, 'MCP Undo did not restore just the presentation field');
    await rejected(runBridgeTool('__undo', { entry: entry(scope, id, reset) }), 'Committed receipt could be used twice');
    const noOpBefore = encoded(await allRows()), noOpJournal = encoded(getUndoJournal());
    const noOp = await action(scope, id, { action: 'rename', index: 1, label: 'Rising' });
    check(!noOp.receiptId && !noOp.__audit?.before, 'No-op created a receipt');
    check(encoded(await allRows()) === noOpBefore && encoded(getUndoJournal()) === noOpJournal, 'No-op mutated data or owner journal');
    // The incumbent generic writes:true dispatcher event is intentionally kept.
    const stale = await read(scope, id), original = await stored(scope, id);
    await db.projects.update(P, { modelAssets: (await db.projects.get(P))!.modelAssets!.map(item => item.id === id ? { ...item, name: 'Later filename.glb' } : item) });
    await rejected(runBridgeTool(ACTION, { ...scope, modelId: id, action: 'rename', index: 0, label: 'Stale writer', expectedVersion: stale.version }), 'Stale content CAS overwrote later model edit');
    check((await stored(scope, id)).name === 'Later filename.glb', 'Rejected stale writer lost winning filename');
    await rejected(runBridgeTool('__undo', { entry: entry(scope, id, moved) }), 'Stale old presentation Undo overwrote later changes');
    equal(withoutPresentation(await stored(scope, id)), { ...withoutPresentation(original), name: 'Later filename.glb' }, 'Sidecar writer changed binary or unrelated fields');
    note('Reset/absence Undo, receipt single-use and no-op work; conservative model CAS refuses stale writes and stale Undo');

    let notices = 0; const stop = onDataChanged(() => { notices++; });
    let aborted: ActionResult | undefined;
    const beforeAbort = encoded(await allRows());
    try {
      try { await db.transaction('rw', db.tables, async () => { aborted = await action(scope, id, { action: 'rename', index: 0, label: 'Must roll back' }); check(notices === 0, 'Authoring published before root complete'); throw Error('Intentional outer action abort'); }); }
      catch (error) { check(String(error).includes('Intentional outer action abort'), 'Unexpected outer action failure: ' + String(error)); }
      check(aborted && encoded(await allRows()) === beforeAbort && notices === 0, 'Outer action abort left data or provisional notice');
      await rejected(runBridgeTool('__undo', { entry: entry(scope, id, aborted) }), 'Aborted authoring receipt remained usable');
      const live = await action(scope, id, { action: 'rename', index: 0, label: 'Committed receipt' });
      const beforeUndoAbort = encoded(await allRows()); notices = 0;
      try { await db.transaction('rw', db.tables, async () => { await undo(scope, id, live); check(notices === 0, 'Undo published before root complete'); throw Error('Intentional outer Undo abort'); }); }
      catch (error) { check(String(error).includes('Intentional outer Undo abort'), 'Unexpected outer Undo failure: ' + String(error)); }
      check(encoded(await allRows()) === beforeUndoAbort && notices === 0, 'Outer Undo abort committed or published');
      await undo(scope, id, live);
    } finally { stop(); }
    note('Root abort rolls back edits/notices and invalidates new receipt; aborted Undo retains its retryable receipt until a real commit');

    for (const eraId of ['past', 'sibling-era', 'own']) await saveWorldEra(P, { id: eraId, name: eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const era = { projectId: P, eraId: 'past' }, siblingVersion = (await readWorldDocument({ projectId: P, eraId: 'sibling-era' }, 'model-viewer', id))!.version;
    const baseBeforeEra = await stored(scope, id), inherited = await read(era, id);
    check(inherited.version.startsWith('sha256:'), 'Inherited model did not retain Base CAS semantics');
    const eraEdit = await action(era, id, { action: 'rename', index: 2, label: 'Era-only empty-name clip' });
    check((await read(era, id)).version.startsWith('variant:'), 'Own era did not use existing variant revision CAS');
    equal(await stored(scope, id), baseBeforeEra, 'Era edit changed Base');
    await rejected(runBridgeTool('__undo', { entry: entry(scope, id, eraEdit) }), 'Era receipt accepted Base scope');
    await db.projects.update(P, { modelAssets: (await db.projects.get(P))!.modelAssets!.map(item => item.id === id ? { ...item, name: 'New inherited Base.glb' } : item) });
    await undo(era, id, eraEdit);
    check((await readWorldDocument(era, 'model-viewer', id))!.provenance === 'base' && (await stored(era, id)).name === 'New inherited Base.glb', 'First inherited Undo froze a copy instead of restoring current Base inheritance');
    check((await readWorldDocument({ projectId: P, eraId: 'sibling-era' }, 'model-viewer', id))!.provenance === 'base' && siblingVersion === inherited.version, 'Sibling era received an authored variant');
    const own = { projectId: P, eraId: 'own' }, ownRead = (await readWorldDocument(own, 'model-viewer', id))!;
    await saveEraDocument(own, 'model-viewer', { ...ownRead.document, root: { ...ownRead.document.root, name: 'Existing own era.glb' } }, ownRead.version);
    const ownBefore = await stored(own, id), ownAction = await action(own, id, { action: 'move', index: 2, position: 0 });
    await undo(own, id, ownAction); equal(await stored(own, id), ownBefore, 'Existing era Undo changed other authored fields');
    check((await readWorldDocument(own, 'model-viewer', id))!.provenance === 'variant', 'Existing own era Undo removed its variant');
    note('Scoped era tokens, Base isolation and Undo distinguish first inheritance from an existing authored variant');

    const current = await stored(scope, id), portable = readerModel(current) as PresentedAsset;
    equal(portable.animationPresentation, current.animationPresentation, 'Reader whitelist lost presentation');
    const legacy = withoutPresentation(current), legacyReader = { id: legacy.id, name: legacy.name, size: legacy.size, dataUrl: legacy.dataUrl, createdAt: legacy.createdAt };
    check(JSON.stringify(readerModel(legacy)) === JSON.stringify(legacyReader), 'Reader legacy DTO bytes changed');
    const escaped = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
    const legacyHtml = `<div data-wh-model-reader="true" data-locale="en"><template data-wh-model-data>${escaped(JSON.stringify(legacyReader))}</template><div data-model-controls></div><div data-model-surface></div><p data-model-status role="status">Loading model…</p></div>`;
    check(modelReaderMarkup(legacy, 'en') === legacyHtml, 'Legacy Reader HTML bytes changed');
    for (const bad of [{ order: [0, 0, 2] }, { order: [0, 1] }, { order: [0, 1, 3] }, { labels: { '01': 'Alias' } }, { labels: { '3': 'Missing' } }, { labels: { '0': 7 } }]) {
      const malformed = { ...current, animationPresentation: bad } as unknown as ModelAsset;
      let portableFailed = false, projectFailed = false;
      try { assetBytes(malformed); } catch { portableFailed = true; }
      try { validateProjectArchiveMetadata({ ...project, modelAssets: [malformed] } as Parameters<typeof validateProjectArchiveMetadata>[0]); } catch { projectFailed = true; }
      check(portableFailed && projectFailed, 'Malformed presentation passed shared model/project portability boundary: ' + JSON.stringify(bad));
    }
    const roundtripId = await importProjectData(await exportProjectData(P)); copiedProjects.push(roundtripId);
    const roundtrip = (await db.projects.get(roundtripId))!.modelAssets!.find(item => item.name === current.name && item.dataUrl === current.dataUrl) as PresentedAsset;
    equal(roundtrip.animationPresentation, current.animationPresentation, 'Real project JSON roundtrip lost sidecar');
    check(roundtrip.dataUrl === current.dataUrl && roundtrip.size === current.size && modelStoredBytes(roundtrip) === modelStoredBytes(current), 'JSON roundtrip changed canonical binary/size');
    equal(withoutPresentation(await stored(scope, id)), { ...withoutPresentation(model), name: 'New inherited Base.glb' }, 'Metadata batch changed canonical GLB or unrelated model fields');
    check(encoded(await db.projects.get(F)) === foreignBefore, 'Foreign project changed');
    equal((await db.projects.get(P))!.modelAssets!.find(item => item.id === sibling.id), sibling, 'Sibling model changed');
    await act(async () => { root!.unmount(); await pause(); }); root = createRoot(rootNode);
    await act(async () => { root!.render(<MemoryRouter><ModelView asset={current} compact /></MemoryRouter>); await pause(); });
    await until(() => rootNode.textContent?.includes('Model ready') === true, 'Readonly compact model did not mount');
    equal([...animationSelect(rootNode).options].map(option => Number(option.value)), (await read(scope, id)).order, 'Readonly compact order differs from shared inventory');
    check(!rootNode.querySelector('input[aria-label="Animation label"]') && !rootNode.textContent?.includes('Save animation label'), 'Readonly compact obtained writer controls');
    note('Shared portable boundaries reject invalid sidecars, JSON carries them, legacy Reader bytes stay exact and compact projection stays readonly');
    return passed;
  } finally {
    if (root) await act(async () => { root!.unmount(); await pause(); });
    clearUndoJournal();
    for (const id of copiedProjects) await deleteProject(id);
    await deleteProject(P); await deleteProject(F);
  }
}
