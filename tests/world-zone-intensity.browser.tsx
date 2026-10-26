import { normalizeZone, type WorldZone } from '@/engines/worldgen/core/zones';
import { drawZones } from '@/engines/worldgen/cartography/zoneMarks';
import type { PaintTool } from '@/engines/worldgen/components/PaintPanel';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const square = [{ x: 30, y: 30 }, { x: 220, y: 30 }, { x: 220, y: 220 }, { x: 30, y: 220 }];
const zone = { id: 'qa-intensity', name: 'QA', pts: square, color: '#b8432f', pattern: 'wash' as const };

export async function testWorldZoneIntensityModel(): Promise<string[]> {
  const original = JSON.stringify(zone), old = normalizeZone(zone);
  assert(!('opacity' in old) && JSON.stringify(zone) === original, 'Reading a legacy zone must not add opacity or mutate its source');
  assert(normalizeZone({ ...zone, opacity: 0 }).opacity === 0, 'Zero intensity must be a valid explicit zone value');
  for (const opacity of [.05, .5, 1]) assert(normalizeZone({ ...zone, opacity }).opacity === opacity, 'Positive intensity changed');
  for (const opacity of [-.01, 1.01, NaN, Infinity, null, '0']) {
    let refused = false; try { normalizeZone({ ...zone, opacity }); } catch { refused = true; }
    assert(refused, `Invalid intensity accepted: ${String(opacity)}`);
  }
  assert(JSON.stringify(old) === original, 'Legacy normalized shape changed');
  return ['Zone intensity accepts zero and positive values, rejects invalid values and leaves legacy absence and source bytes unchanged'];
}

type CanvasFactory = () => HTMLCanvasElement;
export function zoneIntensitySamples(makeCanvas: CanvasFactory, inspect?: (pattern: WorldZone['pattern'], opacity: number | 'absent', pixels: Uint8ClampedArray) => void) {
  const samples: Array<{ pattern: WorldZone['pattern']; opacity: number | 'absent'; fill: number; border: number; label: number; sum: number }> = [];
  for (const pattern of ['outline', 'wash', 'hatch'] as const) for (const opacity of [undefined, 0, .05, .5, 1]) {
    const canvas = makeCanvas(); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    drawZones(ctx, [{ ...zone, pattern, ...(opacity === undefined ? {} : { opacity }) }], 512, x => x, y => y, 1);
    const data = ctx.getImageData(0, 0, 256, 256).data;
    inspect?.(pattern, opacity ?? 'absent', data);
    const alpha = (x: number, y: number) => data[(y * 256 + x) * 4 + 3];
    const max = (x: number, y: number, w: number, h: number) => { let value = 0; for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) value = Math.max(value, alpha(px, py)); return value; };
    let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i];
    samples.push({ pattern, opacity: opacity ?? 'absent', fill: max(60, 60, 10, 10), border: max(28, 45, 4, 28), label: max(105, 110, 40, 30), sum });
  }
  return samples;
}

export async function testWorldZoneIntensityCanvas(makeCanvas: CanvasFactory = () => document.createElement('canvas')): Promise<string[]> {
  const samples = zoneIntensitySamples(makeCanvas);
  for (const pattern of ['outline', 'wash', 'hatch'] as const) {
    const get = (opacity: number | 'absent') => samples.find(row => row.pattern === pattern && row.opacity === opacity)!;
    assert(get(0).fill === 0 && get(0).border === 0, `Zero must leave no zone fill or residual border: ${JSON.stringify(get(0))}`);
    assert(get(0).label > 100, `Zero intensity hid the zone name: ${pattern}`);
    assert(get(.05).sum < get(.5).sum && get(.5).sum < get(1).sum, `Positive intensity must change real pixels: ${pattern}`);
    assert(get('absent').sum === get(1).sum, `Absent intensity must retain legacy strength: ${pattern}`);
  }
  return ['Actual shared zone Canvas keeps the label at zero, scales fill/border pixels at 5/50/100 percent and renders absent opacity as legacy one: ' + JSON.stringify(samples)];
}

export async function testWorldZoneIntensityUi(): Promise<string[]> {
  const { act, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: PaintPanel, DEFAULT_PAINT_TOOL } = await import('@/engines/worldgen/components/PaintPanel');
  const { useLocaleStore } = await import('@/stores/localeStore');
  const { PaintSession } = await import('@/engines/worldgen/core/paintSession');
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const { zonesFrom } = await import('@/engines/worldgen/core/zones');
  const root = createRoot(document.getElementById('root')!), pause = () => new Promise(resolve => setTimeout(resolve, 60));
  const own = { ...zone, id: 'own', name: 'Own zone' }, sibling = { ...zone, id: 'sibling', name: 'Other zone', opacity: .35 };
  const session = new PaintSession(generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'qa-intensity' }), [{ kind: 'zone', ...own }, { kind: 'zone', ...sibling }]);
  const siblingBefore = JSON.stringify(sibling), legacyBefore = session.serialize(), changed: WorldZone[] = [], tools: unknown[] = [];
  const oldLocale = useLocaleStore.getState().locale;
  function Host() {
    const [tool, setTool] = useState<PaintTool>({ ...DEFAULT_PAINT_TOOL, mode: 'zone' });
    const [zones, setZones] = useState(() => zonesFrom(session.edits));
    return <PaintPanel tool={tool} onChange={next => { tools.push(next); setTool(next); }} strokeCount={session.edits.length} canUndo={session.canUndo} canRedo={session.canRedo} onUndo={() => { session.undo(); setZones(zonesFrom(session.edits)); }} onRedo={() => { session.redo(); setZones(zonesFrom(session.edits)); }} onClear={() => {}} zones={zones} onUpdateZone={next => { changed.push(next); session.push({ kind: 'zone', ...next }); setZones(zonesFrom(session.edits)); }} />;
  }
  const input = async (id: string, value: string) => { const node = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`); assert(node, `Missing zone intensity control: ${id}`); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); await act(async () => { node.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); await pause(); }); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await act(async () => { root.render(<Host />); await pause(); });
    const next = document.querySelector<HTMLInputElement>('[data-testid="zone-intensity"]'); assert(next, 'Zone creation needs a real intensity slider');
    assert(next.min === '0' && next.max === '100' && next.step === '5' && next.value === '100', 'Creation intensity must expose 0..100 step5 and preserve Writer default one');
    assert(session.serialize() === legacyBefore, 'Mounting intensity UI rewrote legacy zones');
    await input('zone-intensity', '0');
    assert((tools.at(-1) as { zoneOpacity?: number }).zoneOpacity === 0 && document.querySelector<HTMLInputElement>('[data-testid="zone-intensity-value"]')?.value === '0', 'Zero creation intensity was lost');
    for (const value of ['0', '50', '100']) {
      await input('zone-intensity-own', value);
      assert(changed.at(-1)?.opacity === Number(value) / 100 && zonesFrom(session.edits).find(row => row.id === 'own')?.opacity === Number(value) / 100, 'Existing zone intensity did not create a normal edit');
      assert(JSON.stringify(zonesFrom(session.edits).find(row => row.id === 'sibling')) === siblingBefore, 'Changing intensity touched another zone');
    }
    session.undo(); assert(zonesFrom(session.edits).find(row => row.id === 'own')?.opacity === .5, 'Normal Undo lost the previous zone intensity');
    session.undo(); assert(zonesFrom(session.edits).find(row => row.id === 'own')?.opacity === 0, 'Normal Undo lost explicit zero');
    session.undo(); assert(!('opacity' in zonesFrom(session.edits).find(row => row.id === 'own')!), 'Normal Undo did not restore legacy absence');
    return ['Actual PaintPanel creation and saved-zone controls expose 0/50/100 percent, store normal zone edits, retain the sibling and Undo restores zero then legacy absence'];
  } finally { await act(async () => root.unmount()); useLocaleStore.setState({ locale: oldLocale }); }
}

export async function testWorldZoneIntensityMapCommit(): Promise<string[]> {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: Map2D } = await import('@/engines/worldgen/components/Map2D');
  const { DEFAULT_PAINT_TOOL } = await import('@/engines/worldgen/components/PaintPanel');
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'qa-zone-map-commit' });
  const host = document.createElement('div'); host.id = 'qa-zone-map-commit'; host.style.cssText = 'position:relative;width:480px;height:320px';
  const style = document.createElement('style'); style.textContent = '#qa-zone-map-commit>div{position:absolute;inset:0}'; document.head.append(style); document.body.append(host);
  const root = createRoot(host), edits: import('@/engines/worldgen/core/edits').WorldEdit[] = [], pause = () => new Promise(resolve => setTimeout(resolve, 70));
  try {
    for (const opacity of [undefined, 0, .5, 1]) {
      await act(async () => { root.render(<Map2D world={world} viewMode="elevation" projection="equirect" showRivers={false} showLandmarks={false} showWaypoints={false} showGrid={false} showSettlements={false} showFeatures={false} showRoads={false} showBorders={false} waypoints={[]} selectedWaypointId={null} onSelectWaypoint={() => {}} tool={{ ...DEFAULT_PAINT_TOOL, mode: 'zone', zoneName: 'QA drawn zone', ...(opacity === undefined ? {} : { zoneOpacity: opacity }) }} onEdit={edit => edits.push(edit)} />); await pause(); });
      const end = Date.now() + 5000; while (!host.querySelector('canvas')?.width && Date.now() < end) await act(async () => { await pause(); });
      const canvas = host.querySelector('canvas')!; assert(canvas?.width > 0, 'Actual Map2D never became drawable');
      const rect = canvas.getBoundingClientRect(), before = edits.length;
      for (const [x, y] of [[.42, .4], [.58, .4], [.5, .6]]) await act(async () => { canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', bubbles: true })); canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y, button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true })); await pause(); });
      await act(async () => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
      assert(edits.length === before + 1, 'Actual zone polygon gesture did not commit exactly one edit');
      const saved = edits.at(-1); assert(saved?.kind === 'zone', 'Actual map gesture committed the wrong edit');
      assert(saved.opacity === opacity && (opacity !== undefined || !('opacity' in saved)), `Map2D lost explicit intensity or wrote a legacy default: ${JSON.stringify(saved)}`);
    }
    return ['Actual Map2D corner gestures commit chosen zero/50/100 percent and keep the opacity field absent when untouched'];
  } finally { await act(async () => root.unmount()); host.remove(); style.remove(); }
}

export async function testWorldZoneIntensityBridge(): Promise<string[]> {
  const { db } = await import('@/db');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { serializeEdits, deserializeEdits } = await import('@/engines/worldgen/core/edits');
  const { zonesFrom } = await import('@/engines/worldgen/core/zones');
  const { worldRuntimeKey } = await import('@/engines/worldgen/era');
  const { saveWorldEra, readEraRow } = await import('@/services/worldEras/store');
  const { paramsKey } = await import('@/engines/worldgen/useWorldGeneration');
  const { saveSnapshot } = await import('@/engines/worldgen/snapshots');
  const { runBridgeTool } = await import('@/services/aiBridge/dispatch');
  const P = 'qa-zone-intensity-bridge', W = P + '-world', era = { projectId: P, eraId: 'past' };
  const params = { ...DEFAULT_PARAMS, width: 128, seed: 'qa-zone-intensity-bridge' }, world = generateWorld(params);
  const pts = [{ x: 10, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 25 }, { x: 10, y: 25 }];
  const own = { ...zone, id: 'own', pts }, sibling = { ...zone, id: 'sibling', pts: pts.map(p => ({ x: p.x + 35, y: p.y })), opacity: .35 };
  const initial = serializeEdits([{ kind: 'zone', ...own }, { kind: 'zone', ...sibling }]), renders: string[] = [];
  try {
    await db.projects.put({ id: P, title: 'QA zone intensity', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 });
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'QA world', params, edits: initial, createdAt: 1, updatedAt: 1 });
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await saveSnapshot(worldRuntimeKey(W), paramsKey(params), world); await saveSnapshot(worldRuntimeKey(W, 'past'), paramsKey(params), world);
    for (const opacity of [0, .5, 1]) {
      const reply = await runBridgeTool('wh_update_zone', { worldId: W, id: 'own', opacity }); assert(reply.ok, `Registered zone update rejected intensity ${opacity}: ${JSON.stringify(reply)}`);
      const listed = await runBridgeTool('wh_list_zones', { worldId: W }); assert(listed.ok && (listed.result as { zones: WorldZone[] }).zones.find(row => row.id === 'own')?.opacity === opacity, 'MCP read disagreed with persisted intensity');
      assert(JSON.stringify(zonesFrom(deserializeEdits((await db.generatedWorlds.get(W))!.edits!)).find(row => row.id === 'sibling')) === JSON.stringify(sibling), 'MCP intensity changed another zone');
      let rendered: Awaited<ReturnType<typeof runBridgeTool>> | undefined;
      for (let attempt = 0; attempt < 20; attempt++) { rendered = await runBridgeTool('wh_render_world_map', { worldId: W, width: 384 }); if (!(rendered.ok && (rendered.result as { pending?: boolean }).pending)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert(rendered?.ok && (rendered.result as { dataUrl?: string }).dataUrl, 'Native map export did not return a zone image'); renders.push((rendered.result as { dataUrl: string }).dataUrl);
      const audit = (reply.result as { __audit: Record<string, unknown> }).__audit;
      const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_update_zone', kind: 'update', summary: 'zone intensity', ...audit } });
      assert(undone.ok && (await db.generatedWorlds.get(W))!.edits === initial, 'MCP Undo did not restore the exact legacy edit list');
    }
    assert(new Set(renders).size === 3, 'Zero/50/100 percent map exports ignored intensity');
    const baseBefore = (await db.generatedWorlds.get(W))!.edits;
    const ownEra = await runBridgeTool('wh_update_zone', { worldId: W, projectId: P, eraId: 'past', id: 'own', opacity: 0 }); assert(ownEra.ok, `Era intensity zero rejected: ${JSON.stringify(ownEra)}`);
    const variant = await readEraRow<{ edits: string }>(era, 'generatedWorlds', W);
    assert(variant && zonesFrom(deserializeEdits(variant.edits)).find(row => row.id === 'own')?.opacity === 0 && (await db.generatedWorlds.get(W))!.edits === baseBefore, 'Era intensity escaped its own world or changed Base');
    const added = await runBridgeTool('wh_add_zone', { worldId: W, name: 'Zero added zone', points: pts, opacity: 0 }); assert(added.ok && (added.result as { zone: WorldZone }).zone.opacity === 0, 'Registered add-zone schema rejected zero');
    for (const opacity of [-.01, 1.01]) assert(!(await runBridgeTool('wh_update_zone', { worldId: W, id: 'own', opacity })).ok, 'Out-of-range MCP intensity accepted');
    return ['Registered MCP update/list/Undo agree on zero/50/100 percent, exported map images differ, legacy edits and sibling are preserved, add accepts zero and era changes leave Base intact'];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(W)); await db.worldSnapshots.delete(worldRuntimeKey(W, 'past'));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
