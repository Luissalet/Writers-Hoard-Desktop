import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import WorldGraphWorkspace from '@/engines/codex/worldGraph/WorldGraphWorkspace';
import { buildWorldGraph, layoutWorldGraph } from '@/engines/codex/worldGraph/model';
import { saveWorldGraphLayout, saveWorldGraphSettings } from '@/engines/codex/worldGraph/store';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry } from '@/types';
import { exportWorldGraphSvg } from '@/engines/codex/worldGraph/svg';
import { contentStamp } from '@/services/aiBridge/undoStamp';
import { DEFAULT_GRAPH_DISPLAY } from '@/engines/codex/worldGraph/types';
import { worldGraphTypeAreas } from '@/engines/codex/worldGraph/areas';
import { listEraRows, mutateEraRows, saveWorldEra } from '@/services/worldEras/store';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const P = 'graph-display-next';
const pause = () => new Promise(resolve => setTimeout(resolve, 90));
const change = async (node: HTMLInputElement | HTMLSelectElement | null, value: string) => { assert(node, 'Missing control'); await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); }); };
const click = async (node: Element | null) => { assert(node, 'Missing action'); await act(async () => { (node as HTMLElement).click(); await pause(); }); };
async function seed() {
  await db.projects.put({ id: P, title: 'Graph display QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 });
  const entry = (id: string, title: string, type: CodexEntry['type']): CodexEntry => ({ id: `${P}-${id}`, projectId: P, title, type, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
  const entries = [entry('nora', 'Nora', 'character'), entry('bruno', 'Bruno', 'character'), entry('port', 'Port', 'location'), entry('inn', 'Inn', 'location')];
  entries[0].relations = [{ targetId: entries[2].id, targetTitle: 'Port', type: 'lives in' }];
  await db.codexEntries.bulkPut(entries); return entries;
}
async function clean() { for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete(); await db.projects.delete(P); }
export async function testGraphDisplayLegacySvg(): Promise<string[]> {
  const entries = await seed();
  try {
    const graph = buildWorldGraph({ projectId: P, entries, relationships: [] });
    const svg = exportWorldGraphSvg(graph.nodes, graph.edges, Object.fromEntries(graph.nodes.map((node, index) => [node.id, { x: index * 290, y: 0 }])), { mention: 'Mention', codex: 'Card link', reference: 'Reference', relationship: 'Relationship' }, { character: 'Character', location: 'Location' });
    assert(contentStamp(svg) === '2362:cs85vmae2o', 'Five-argument SVG changed from the recorded source baseline');
    return ['Legacy five-argument SVG remains byteexact to its recorded pre-change baseline'];
  } finally { await clean(); }
}
export async function testGraphDisplayControls(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const root = createRoot(document.getElementById('root')!);
  const style = document.createElement('style'); style.textContent = '[data-testid="world-graph-canvas"]{width:900px;height:600px;position:relative}.react-flow__renderer,.react-flow__pane,.react-flow__viewport{position:absolute;width:100%;height:100%}.react-flow__node{position:absolute}'; document.head.append(style);
  let opened = '';
  try {
    const entries = await seed(), graph = buildWorldGraph({ projectId: P, entries, relationships: [] });
    await saveWorldGraphLayout(P, { [`${P}-bruno`]: { x: 720, y: -120 } });
    const render = async (key: string) => { const project = (await db.projects.get(P))!; await act(async () => { root.render(<WorldGraphWorkspace key={key} initialLayout={project.codexGraphLayout} graph={graph} onOpenEntry={id => { opened = id; }} onSaveLayout={positions => saveWorldGraphLayout(P, positions)} onSaveSettings={patch => saveWorldGraphSettings(P, patch).then(() => undefined)} />); await pause(); }); };
    await render('first');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="world-graph-settings"]')!.click(); await pause(); });
    const spacing = document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]'), areas = document.querySelector<HTMLInputElement>('[data-testid="world-graph-type-areas"]');
    assert(spacing && areas, 'Normal graph settings have no spacing/type-areas controls');
    assert(spacing.min === '0.5' && spacing.max === '1.5' && spacing.step === '0.1' && spacing.value === '1' && !areas.checked, 'New controls do not preserve defaults or observed spacing range');
    assert(spacing.labels?.length && areas.labels?.length && document.querySelector('[data-testid="world-graph-spacing-value"]')?.textContent === '1.0', 'Control label/value missing');
    const node = (id: string) => document.querySelector<HTMLElement>(`[data-testid="world-graph-node-${P}-${id}"]`)!;
    const position = (id: string) => node(id).closest<HTMLElement>('.react-flow__node')!.style.transform;
    const baseline = position('port'), pinned = position('bruno');
    await change(spacing, '1.5'); const spread = position('port');
    await change(spacing, '0.5'); const tight = position('port');
    assert(baseline.includes('290px') && spread.includes('325px') && tight.includes('255px') && position('bruno') === pinned, `Actual nodes did not move independently of pins: ${baseline}/${spread}/${tight}/${position('bruno')}`);
    assert(document.querySelector('[data-testid="world-graph-spacing-value"]')?.textContent === '0.5' && Object.keys((await db.projects.get(P))!.codexGraphLayout!.positions).length === 1, 'Spacing value missing or automatic positions became pins');
    await click(areas);
    const layer = document.querySelector<SVGElement>('[data-testid="world-graph-type-areas-layer"]');
    assert(layer && getComputedStyle(layer).pointerEvents === 'none' && layer.querySelectorAll('polygon').length === 2, 'Context regions absent or intercept events');
    assert(layer.parentElement?.classList.contains('react-flow__viewport-portal'), 'Areas do not share the graph viewport');
    const beforePoints = document.querySelector('[data-testid="world-graph-type-area-location"] polygon')!.getAttribute('points');
    await click(node('port')); await click(document.querySelector('[data-testid="world-graph-open-card"]'));
    assert(opened === `${P}-port`, 'Areas blocked the normal open-card action');
    await change(document.querySelector<HTMLSelectElement>('[data-testid="world-graph-type"]'), 'character');
    assert(!document.querySelector('[data-testid="world-graph-type-area-location"]') && document.querySelector('[data-testid="world-graph-counts"]')?.textContent?.includes('2/2'), 'Areas did not follow filters or contaminated counts');
    await change(document.querySelector<HTMLSelectElement>('[data-testid="world-graph-type"]'), 'all');
    assert(document.querySelector('[data-testid="world-graph-type-area-location"] polygon')?.getAttribute('points') === beforePoints, 'Clearing the filter did not restore derived areas');
    const at = node('port').getBoundingClientRect(), mouse = { bubbles: true, cancelable: true, view: window, button: 0, clientX: at.left + 15, clientY: at.top + 15 };
    await act(async () => { node('port').dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 })); await pause(); });
    // XYDrag starts at the first threshold-crossing move; a later move changes the position.
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { ...mouse, buttons: 1, clientX: mouse.clientX + 20, clientY: mouse.clientY + 10 })); await pause(); });
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { ...mouse, buttons: 1, clientX: mouse.clientX + 80, clientY: mouse.clientY + 50 })); await pause(); });
    await act(async () => { window.dispatchEvent(new MouseEvent('mouseup', { ...mouse, clientX: mouse.clientX + 80, clientY: mouse.clientY + 50 })); await pause(); });
    assert((await db.projects.get(P))!.codexGraphLayout!.positions[`${P}-port`] && document.querySelector('[data-testid="world-graph-type-area-location"] polygon')?.getAttribute('points') !== beforePoints, `Actual ReactFlow drag did not persist its pin and update its area: ${JSON.stringify({ at: at.toJSON(), pins: (await db.projects.get(P))!.codexGraphLayout!.positions, position: position('port'), visibility: node('port').closest<HTMLElement>('.react-flow__node')!.style.visibility })}`);
    await change(document.querySelector<HTMLInputElement>('[data-testid="world-graph-view-name"]'), 'Port context');
    await click(document.querySelector('[data-testid="world-graph-view-save"]'));
    const saved = (await db.projects.get(P))!.codexGraphLayout!;
    assert(saved.display?.spacing === 0.5 && saved.display.typeAreas && saved.views?.[0].display.typeAreas && saved.positions[`${P}-bruno`].x === 720, 'Saving the view lost display/pin');
    await render('reopen'); await click(document.querySelector('[data-testid="world-graph-settings"]'));
    assert(document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]')?.value === '0.5' && document.querySelector<HTMLInputElement>('[data-testid="world-graph-type-areas"]')?.checked, 'Reopening lost display');
    await change(document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]'), '1.5');
    await change(document.querySelector<HTMLSelectElement>('[data-testid="world-graph-view-select"]'), saved.views![0].id);
    assert(document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]')?.value === '0.5' && document.querySelector('[data-testid="world-graph-type-area-location"]'), 'Saved graph did not restore its display');
    await click(document.querySelector('[data-testid="world-graph-type-areas"]'));
    assert(!document.querySelector('[data-testid="world-graph-type-areas-layer"]'), 'Areas did not switch off');
    return ['Normal graph controls change actual automatic node gaps while pins stay fixed, label the value, draw noninteractive filtered regions, open cards normally, and retain display in reopened/saved graphs'];
  } finally { await act(async () => { root.unmount(); await pause(); }); style.remove(); await clean(); }
}
export async function testGraphDisplayContract(): Promise<string[]> {
  const receipts: AuditLine[] = [];
  const execute = createToolExecutor({ writesEnabled: async () => true, relay: runBridgeTool, audit: async line => { receipts.push(line); return receipts.length - 1; } });
  const call = (args: Record<string, unknown>) => execute({ tool: 'wh_world_graph_settings', args: { projectId: P, ...args } }, { origin: 'bridge', projectId: P });
  try {
    await seed();
    const original = JSON.stringify(await db.projects.get(P));
    const defaults = await call({ action: 'read' });
    assert((defaults.result as { display: { spacing: number; typeAreas: boolean } }).display.spacing === 1 && !(defaults.result as { display: { typeAreas: boolean } }).display.typeAreas && JSON.stringify(await db.projects.get(P)) === original, 'Reading defaults wrote metadata');
    await call({ action: 'display', display: { names: 'hover', nodeSize: 'small', pictures: false, linkOpacity: 0.4 } });
    const legacy = (await db.projects.get(P))!.codexGraphLayout!.display;
    assert(legacy?.spacing === undefined && legacy.typeAreas === undefined, 'Legacy display change filled optional defaults');
    const result = await call({ action: 'display', display: { spacing: 1.5, typeAreas: true } });
    assert(result.ok, `Normal executor rejects spacing/type areas: ${JSON.stringify(result)}`);
    const read = await runBridgeTool('wh_world_graph_settings', { projectId: P });
    const display = (read.result as { display: { spacing: number; typeAreas: boolean } }).display;
    assert(display.spacing === 1.5 && display.typeAreas, 'Registered settings dropped the requested new display fields');
    const receipt = receipts.at(-1)!;
    await saveWorldGraphLayout(P, { [`${P}-bruno`]: { x: 777, y: -222 } });
    const undo = await runBridgeTool('__undo', { entry: receipt });
    assert(undo.ok && JSON.stringify((await db.projects.get(P))!.codexGraphLayout!.display) === JSON.stringify(legacy) && (await db.projects.get(P))!.codexGraphLayout!.positions[`${P}-bruno`].x === 777, 'Normal Undo lost prior display or a later pin');
    await call({ action: 'display', display: { spacing: 0.5, typeAreas: true } }); const stale = receipts.at(-1)!;
    await saveWorldGraphSettings(P, { hiddenIds: [`${P}-inn`] });
    const refused = await runBridgeTool('__undo', { entry: stale });
    assert(!refused.ok && refused.code === 'cannot-undo' && (await db.projects.get(P))!.codexGraphLayout!.hiddenIds?.includes(`${P}-inn`), 'Undo discarded a later settings change');
    const view = await call({ action: 'save-view', name: 'Area view', display: { spacing: 1.2, typeAreas: false }, filters: { type: 'location' } });
    assert(view.ok && (await db.projects.get(P))!.codexGraphLayout!.views?.[0].display.spacing === 1.2 && (await db.projects.get(P))!.codexGraphLayout!.display?.pictures === false, 'Saving a view lost its own settings or reset other fields');
    const beforeBad = JSON.stringify(await db.projects.get(P));
    for (const action of ['display', 'save-view']) for (const invalid of [{ spacing: 0.4 }, { spacing: 1.6 }, { spacing: '1' }, { spacing: NaN }, { typeAreas: 'yes' }]) {
      const bad = await call({ action, name: 'Invalid', display: invalid });
      assert(!bad.ok && bad.code === 'bad-args' && JSON.stringify(await db.projects.get(P)) === beforeBad, 'Invalid graph settings wrote metadata');
    }
    return ['Normal MCP executor reads defaults without writes, retains legacy fields, stores display and saved views, refuses invalid fields, and Undo preserves later pins while refusing later settings changes'];
  } finally { await clean(); }
}

export async function testGraphDisplayGeometrySvg(): Promise<string[]> {
  try {
    const entries = await seed(), graph = buildWorldGraph({ projectId: P, entries, relationships: [] });
    const normal = layoutWorldGraph(graph.nodes, graph.edges);
    assert(normal[`${P}-port`].x === 290 && normal[`${P}-bruno`].y === 192 && normal[`${P}-inn`].x === 250, 'Legacy layout differs from recorded positions');
    for (const nodeSize of ['small', 'medium', 'large'] as const) assert(JSON.stringify(layoutWorldGraph(graph.nodes, graph.edges, { positions: {}, display: { ...DEFAULT_GRAPH_DISPLAY, nodeSize, spacing: 1 } })) === JSON.stringify(normal), 'Spacing1 changed legacy layout');
    const pin = { [`${P}-bruno`]: { x: 700, y: -150 } }, display = { ...DEFAULT_GRAPH_DISPLAY, nodeSize: 'large' as const, spacing: 0.5, typeAreas: true };
    const positions = layoutWorldGraph(graph.nodes, graph.edges, { positions: pin, display });
    assert(positions[`${P}-port`].x >= 280 && positions[`${P}-bruno`].x === 700, 'Dense setting overlapped a previously clear large card or moved a pin');
    const areas = worldGraphTypeAreas(graph.nodes, positions, 'large');
    assert(areas.length === 2 && areas.every(area => area.points.length >= 4 && area.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))), 'Regions are not finite hulls');
    const character = areas.find(area => area.type === 'character')!;
    assert(Math.min(...character.points.map(point => point.y)) < -150 && Math.max(...character.points.map(point => point.x)) > 980, 'Area excludes a pinned large card');
    const labels = { mention: 'Mention', codex: '<Card link>', reference: 'Reference', relationship: 'Relationship' }, types = { character: '<Character>', location: 'Location' };
    const svg = exportWorldGraphSvg(graph.nodes, graph.edges, positions, labels, types, display), doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert(!doc.querySelector('parsererror,script') && doc.querySelectorAll('[data-world-graph-type-area]').length === 2 && doc.querySelectorAll('g > rect[width="280"]').length === 4 && doc.documentElement.textContent?.includes('<Character>'), 'SVG lost display/escaping or is malformed');
    const bounds = doc.documentElement.getAttribute('viewBox')!.split(' ').map(Number);
    for (const polygon of doc.querySelectorAll('polygon')) for (const pair of polygon.getAttribute('points')!.split(' ')) { const [x, y] = pair.split(',').map(Number); assert(x >= bounds[0] && x <= bounds[0] + bounds[2] && y >= bounds[1] && y <= bounds[1] + bounds[3], 'Export cropped a type area'); }
    assert(!doc.querySelector('[href],image') && svg.includes('x="700"'), 'Export introduced an external asset or lost final pin positions');
    return ['Default layout stays exact for every size, dense large-card gaps never worsen, final pins shape finite type hulls and optional SVG preserves dimensions, regions, escaped labels and uncropped bounds'];
  } finally { await clean(); }
}

export async function testGraphDisplaySaveRetry(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!); useLocaleStore.setState({ locale: 'en' });
  let layoutWrites = 0;
  const reject = () => { throw new Error('Synthetic graph settings write failure'); };
  try {
    const entries = await seed(), graph = buildWorldGraph({ projectId: P, entries, relationships: [] });
    await saveWorldGraphLayout(P, { [`${P}-bruno`]: { x: 700, y: -100 } }); const before = JSON.stringify((await db.projects.get(P))!.codexGraphLayout);
    await act(async () => { root.render(<WorldGraphWorkspace initialLayout={(await db.projects.get(P))!.codexGraphLayout} graph={graph} onOpenEntry={() => {}} onSaveLayout={async positions => { layoutWrites++; await saveWorldGraphLayout(P, positions); }} onSaveSettings={patch => saveWorldGraphSettings(P, patch).then(() => undefined)} />); await pause(); });
    await click(document.querySelector('[data-testid="world-graph-settings"]'));
    db.projects.hook('updating', reject);
    await change(document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]'), '1.5');
    assert(document.querySelector('[data-testid="world-graph-settings-error"]') && JSON.stringify((await db.projects.get(P))!.codexGraphLayout) === before, 'Failed setting was reported saved or changed stored metadata');
    db.projects.hook('updating').unsubscribe(reject);
    await click(document.querySelector('[data-testid="world-graph-settings-error"] button'));
    assert(!document.querySelector('[data-testid="world-graph-settings-error"]') && (await db.projects.get(P))!.codexGraphLayout?.display?.spacing === 1.5 && (await db.projects.get(P))!.codexGraphLayout!.positions[`${P}-bruno`].x === 700 && layoutWrites === 0, 'Retry wrote positions instead of the failed settings patch');
    return ['Actual settings store failure leaves DB intact and retry resends the settings patch, preserving pins without a layout write'];
  } finally { db.projects.hook('updating').unsubscribe(reject); await act(async () => { root.unmount(); await pause(); }); await clean(); }
}

export async function testGraphDisplayEraScope(): Promise<string[]> {
  try {
    const entries = await seed();
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await mutateEraRows({ projectId: P, eraId: 'past' }, [{ table: 'codexEntries', id: entries[0].id, changes: { title: 'Nora past', type: 'faction' } }]);
    const original = JSON.stringify(await db.codexEntries.toArray());
    await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'display', display: { spacing: 1.5, typeAreas: true } });
    const base = await runBridgeTool('wh_world_graph_query', { projectId: P }), era = await runBridgeTool('wh_world_graph_query', { projectId: P, eraId: 'past' });
    assert(JSON.stringify(base.result).includes('Nora') && !JSON.stringify(base.result).includes('Nora past') && JSON.stringify(era.result).includes('Nora past'), 'Graph query escaped effective era cards');
    const effective = await listEraRows<CodexEntry>({ projectId: P, eraId: 'past' }, 'codexEntries'), graph = buildWorldGraph({ projectId: P, entries: effective, relationships: [] }), layout = (await db.projects.get(P))!.codexGraphLayout!;
    assert(worldGraphTypeAreas(graph.nodes, layoutWorldGraph(graph.nodes, graph.edges, layout)).some(area => area.type === 'faction') && JSON.stringify(await db.codexEntries.toArray()) === original && !Object.hasOwn((await db.projects.get(P))!.worldEras![0].defaults ?? {}, 'codexGraphLayout'), 'Context areas wrote Base cards or invented era settings');
    return ['Effective era cards drive graph types/areas while display remains project-scoped and Base card content remains exact'];
  } finally { await clean(); }
}
