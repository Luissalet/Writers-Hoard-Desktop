import { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorldGraphWorkspace from '@/engines/codex/worldGraph/WorldGraphWorkspace';
import { layoutWorldGraph } from '@/engines/codex/worldGraph/model';
import { worldGraphTypeAreas } from '@/engines/codex/worldGraph/areas';
import { exportWorldGraphSvg } from '@/engines/codex/worldGraph/svg';
import { DEFAULT_GRAPH_DISPLAY, WORLD_GRAPH_CARD_SIZE, type CodexGraphLayout, type WorldGraph, type WorldGraphEdge, type WorldGraphNode } from '@/engines/codex/worldGraph/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
const node = (id: string, type: WorldGraphNode['type'] = 'character'): WorldGraphNode => ({ id, title: `${id} <& "harbour">`, type, aliases: [], tags: [], summary: '', degree: 1 });
const edge = (source: string, target: string): WorldGraphEdge => ({ id: `${source}-${target}`, source, target, kind: 'codex', label: '<dock & tide>', directional: true, count: 1, ambiguousCount: 0, evidence: [] });
const nodes = [node('a'), node('b'), node('c', 'location'), node('d', 'location'), node('e', 'item')];
const edges = [edge('a', 'b'), edge('c', 'd')];
const labels = { mention: 'Mention', codex: 'Card link', reference: 'Reference', relationship: 'Relationship' };
type Point = { x: number; y: number };

// Containment oracle independent of the monotonic-chain hull construction.
function contains(polygon: Point[], point: Point): boolean {
  let positive = false, negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    positive ||= side > 0.00001; negative ||= side < -0.00001;
  }
  return !(positive && negative);
}

export async function reviewWorldGraphGeometry(): Promise<string[]> {
  const inputBefore = JSON.stringify({ nodes, edges });
  const baseline = { a: { x: 0, y: 0 }, b: { x: 290, y: 0 }, c: { x: 0, y: 192 }, d: { x: 290, y: 192 }, e: { x: 0, y: 384 } };
  assert(JSON.stringify(layoutWorldGraph(nodes, edges)) === JSON.stringify(baseline), 'Recorded disconnected legacy layout changed');
  for (const nodeSize of ['small', 'medium', 'large'] as const) {
    assert(JSON.stringify(layoutWorldGraph(nodes, edges, { positions: {}, display: { ...DEFAULT_GRAPH_DISPLAY, nodeSize } })) === JSON.stringify(baseline), `Default layout moved ${nodeSize} cards`);
    const size = WORLD_GRAPH_CARD_SIZE[nodeSize];
    let priorGap = -Infinity;
    for (const spacing of [0.5, 1, 1.5]) {
      const display = { ...DEFAULT_GRAPH_DISPLAY, nodeSize, spacing, typeAreas: true };
      const positions = layoutWorldGraph(nodes, edges, { positions: {}, display });
      const gap = positions.b.x - positions.a.x - size.width;
      assert(gap >= 0 && gap > priorGap, `Connected cards overlap or spacing does not increase their free gap: ${nodeSize}/${spacing}`);
      priorGap = gap;
      const pins = { b: { x: -913.25, y: 481.5 }, e: { x: 1700, y: -700 }, foreign: { x: 999, y: 999 } };
      const snapshot = JSON.stringify(pins);
      const final = layoutWorldGraph(nodes, edges, { positions: pins, display });
      assert(JSON.stringify(final.b) === JSON.stringify(pins.b) && JSON.stringify(final.e) === JSON.stringify(pins.e) && !('foreign' in final), 'Display moved a pin or included a foreign pin');
      const regions = worldGraphTypeAreas(nodes, final, nodeSize);
      assert(regions.length === 3, 'Missing single-card or multi-card region');
      for (const card of nodes) {
        const region = regions.find(row => row.type === card.type);
        assert(region && region.points.length >= 3 && region.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), 'Degenerate type region');
        const at = final[card.id];
        for (const point of [at, { x: at.x + size.width, y: at.y }, { x: at.x, y: at.y + size.height }, { x: at.x + size.width, y: at.y + size.height }]) assert(contains(region.points, point), `Region excludes final ${card.id} rectangle`);
      }
      const svg = new DOMParser().parseFromString(exportWorldGraphSvg(nodes, edges, final, labels, { character: 'Person <&>', location: 'Place', item: 'Item' }, display), 'image/svg+xml');
      assert(!svg.querySelector('parsererror') && !svg.querySelector('script, image, foreignObject, [href]'), 'SVG is not escaped self-contained XML');
      assert(svg.querySelectorAll('[data-world-graph-type-area]').length === 3 && [...svg.querySelectorAll('title')].some(title => title.textContent === nodes[0].title), 'Export lost regions or exact escaped title');
      const [left, top, width, height] = svg.documentElement.getAttribute('viewBox')!.split(' ').map(Number);
      for (const region of regions) for (const point of region.points) assert(point.x >= left && point.y >= top && point.x <= left + width && point.y <= top + height, 'SVG crops a pinned region');
      const filtered = worldGraphTypeAreas(nodes.filter(card => card.type === 'location'), final, nodeSize);
      assert(filtered.length === 1 && filtered[0].type === 'location', 'Filtered regions retain another category');
      assert(JSON.stringify(pins) === snapshot, 'Geometry mutated stored pins');
    }
  }
  assert(JSON.stringify({ nodes, edges }) === inputBefore, 'Geometry mutated source graph');
  assert(worldGraphTypeAreas([], {}, 'medium').length === 0, 'Empty graph retains regions');
  return ['Independent geometry oracle: legacy disconnected baseline, three sizes/spacing endpoints, final pin containment, filtered/empty regions and escaped self-contained SVG bounds'];
}

interface Pending { patch: Partial<Omit<CodexGraphLayout, 'positions'>>; resolve: () => void; reject: () => void }
export async function reviewWorldGraphAsyncSettings(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const root = createRoot(document.getElementById('root')!);
  const style = document.createElement('style');
  style.textContent = '[data-testid="world-graph-canvas"]{width:900px;height:600px;position:relative}.react-flow__renderer,.react-flow__pane,.react-flow__viewport{position:absolute;width:100%;height:100%}.react-flow__node{position:absolute}';
  document.head.append(style);
  const pending: Pending[] = []; let pinWrites = 0;
  const graph: WorldGraph = { projectId: 'review-graph-a', nodes, edges, stats: { scannedDocuments: 5, scannedCharacters: 0, ambiguousMatches: 0, unresolvedReferences: 0, indexedNames: 5 } };
  const save = (patch: Pending['patch']) => new Promise<void>((resolve, reject) => pending.push({ patch: structuredClone(patch), resolve, reject: () => reject(new Error('review deferred settings failure')) }));
  const click = async (selector: string) => { const target = document.querySelector<HTMLButtonElement>(selector); assert(target, `Missing ${selector}`); await act(async () => { target.click(); await pause(); }); };
  const changeSpacing = async (value: string) => { const target = document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]'); assert(target, 'Missing spacing control'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value); target.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  try {
    const render = async (id: string, layout: CodexGraphLayout) => { await act(async () => { root.render(<WorldGraphWorkspace key={id} graph={{ ...graph, projectId: id }} initialLayout={layout} onOpenEntry={() => undefined} onSaveLayout={async () => { pinWrites++; }} onSaveSettings={save} />); await pause(); }); await click('[data-testid="world-graph-settings"]'); };
    await render('review-graph-a', { positions: { b: { x: 711, y: -93 } } });
    assert(document.querySelector('[data-testid="world-graph-node-b"] [aria-label="Manual position"]'), 'Initial manual pin was not rendered');
    await changeSpacing('0.5'); await changeSpacing('1.5');
    assert(pending.length === 2, 'Settings changes did not reach normal save callback');
    await act(async () => { pending[1].resolve(); await pause(); pending[0].reject(); await pause(); });
    assert(!document.querySelector('[data-testid="world-graph-settings-error"]') && document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]')?.value === '1.5', 'Older rejected write replaced latest UI result');
    await changeSpacing('0.7');
    await act(async () => { pending[2].reject(); await pause(); });
    const retryPatch = JSON.stringify(pending[2].patch);
    assert(document.querySelector('[data-testid="world-graph-settings-error"]')?.getAttribute('role') === 'alert', 'Latest failure is not announced');
    await click('[data-testid="world-graph-settings-error"] button');
    assert(pending.length === 4 && JSON.stringify(pending[3].patch) === retryPatch && pinWrites === 0, 'Retry changed the patch or called pin persistence');
    await render('review-graph-b', { positions: {}, display: { ...DEFAULT_GRAPH_DISPLAY, spacing: 1.2, typeAreas: false } });
    await act(async () => { pending[3].reject(); await pause(); });
    assert(document.querySelector<HTMLInputElement>('[data-testid="world-graph-spacing"]')?.value === '1.2' && !document.querySelector('[data-testid="world-graph-settings-error"]') && !document.querySelector('[data-testid="world-graph-type-areas-layer"]'), 'Old project completion leaked into remounted graph');
    const card = document.querySelector('[data-testid="world-graph-node-b"]');
    assert(card && !card.querySelector('[aria-label="Manual position"]'), 'Old project pin leaked into replacement graph');
    return ['Independent async UI oracle: stale errors cannot replace latest settings, announced Retry sends exact patch without pin writes, keyed project replacement isolates display/errors/pins'];
  } finally { await act(async () => { root.unmount(); await pause(); }); style.remove(); }
}

export async function reviewWorldGraphMetadataIsolation(): Promise<string[]> {
  const { remapWorldMetadata } = await import('@/services/worldMetadata');
  const filters = { query: 'a/tpl/view are ordinary prose', type: 'all' as const, types: ['character' as const, 'location' as const], templateId: 'tpl', includeDescendants: false, tag: 'tpl', kinds: ['codex' as const], focusId: 'a', depth: 2 as const, showIsolated: false, nodeLimit: 17, edgeLimit: 23 };
  const graphDisplay = { ...DEFAULT_GRAPH_DISPLAY, spacing: 0.5, typeAreas: true };
  const project: import('@/types').Project = {
    id: 'review-metadata', title: 'Graph source', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1,
    codexTemplates: [{ id: 'tpl', name: 'Template', category: 'character', fields: {}, content: '', revision: 0, createdAt: 1, updatedAt: 1 }],
    codexGraphLayout: { positions: { a: { x: -2.5, y: 41 }, foreign: { x: 7, y: 9 } }, display: graphDisplay, hiddenIds: ['a', 'foreign'], views: [{ id: 'view', name: 'a/tpl/view unchanged', filters, display: graphDisplay }] },
    worldEras: [{ id: 'past', name: 'Past', description: '', defaults: { workspaceRevision: 5 }, revision: 0, createdAt: 1, updatedAt: 1 }],
  };
  const before = JSON.stringify(project), ids = new Map<string, string>();
  const remap = (id: string, prefix: string) => { const key = `${prefix}:${id}`; if (!ids.has(key)) ids.set(key, `copy-${prefix}-${id}`); return ids.get(key)!; };
  const mapped = remapWorldMetadata(project, remap, new Set(['a']));
  const layout = mapped.codexGraphLayout!, view = layout.views![0];
  assert(Object.keys(layout.positions).join() === 'copy-codex-a' && layout.positions['copy-codex-a'].x === -2.5 && layout.hiddenIds?.join() === 'copy-codex-a', 'Metadata retained foreign reference or changed pin');
  assert(view.id === 'copy-graph-view-view' && view.filters.focusId === 'copy-codex-a' && view.filters.templateId === 'copy-template-tpl', 'Reference identities do not use canonical maps');
  const { focusId: oldFocus, templateId: oldTemplate, ...oldOther } = filters;
  const { focusId: newFocus, templateId: newTemplate, ...newOther } = view.filters;
  assert(oldFocus !== newFocus && oldTemplate !== newTemplate && JSON.stringify(oldOther) === JSON.stringify(newOther) && view.name === 'a/tpl/view unchanged', 'Remapping changed non-reference filters or authored labels');
  const eraDefaults = mapped.worldEras?.[0].defaults;
  assert(eraDefaults && Object.keys(eraDefaults).join() === 'workspaceRevision' && eraDefaults.workspaceRevision === 0 && !Object.hasOwn(eraDefaults, 'codexGraphLayout'), 'Graph metadata invented era-scoped defaults or changed normal clone revision reset');
  view.filters.types!.push('item'); view.display.spacing = 1.5; layout.positions['copy-codex-a'].x = 999;
  assert(JSON.stringify(project) === before, 'Mapped graph aliases original nested objects');
  return ['Independent metadata oracle: canonical identities, all non-reference filters/prose intact, no era graph defaults invented, deep-copy isolation of display/filter arrays/pins'];
}
