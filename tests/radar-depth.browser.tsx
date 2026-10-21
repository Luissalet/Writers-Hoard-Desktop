import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project, CodexEntry } from '@/types';
import { importProjectData } from '@/db/operations';
import RadarEngine from '@/engines/radar/RadarEngine';
import { cloneRadarChart, createRadarChart, radarNotches, radarPoint, radarValueAtPoint, resolveRadarSeries, setRadarValue, snapRadarValue, validateRadarChart } from '@/engines/radar/model';
import { radarDraftStore, saveRadarChart } from '@/engines/radar/operations';
import { exportRadarCsv, exportRadarJson, exportRadarSvgComplete, parseRadarCsv, parseRadarJson } from '@/engines/radar/interchange';
import { RADAR_HANDLERS } from '@/engines/radar/bridge';
import { RADAR_TOOLS } from '@/engines/radar/bridgeManifest';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { setRadarAudioEnabled, radarAudioEnabled } from '@/engines/radar/audio';
import { radarFromSkeleton } from '@/engines/radar/presets';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 65) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-radar-depth';
const project: Project = { id: P, title: 'Synthetic radar QA', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: ['radar', 'codex'], engineOrder: ['radar', 'codex'], createdAt: 1, updatedAt: 1 };
const source: CodexEntry = { id: 'radar-codex-source', projectId: P, title: 'Synthetic source', type: 'custom', templateId: 'radar-source-type', fields: { base: '4' }, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
function fixture() {
  const chart = createRadarChart('Synthetic comparison'); chart.isPreset = true; chart.presetCategory = 'World profiles';
  chart.axes[0] = { ...chart.axes[0], label: 'Influence', min: -10, max: 30, step: 2, unit: 'pts', icon: 'Accessibility', color: '#81a8d3' };
  chart.series[0].name = 'Manual'; chart.series.push({ ...structuredClone(chart.series[0]), id: crypto.randomUUID(), name: 'Live source', linkedEntryId: source.id, bindings: { [chart.axes[0].id]: 'total' }, color: '#6ba88a' });
  return chart;
}
const rejects = async (action: () => unknown | Promise<unknown>) => { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, 'Invalid or stale operation accepted'); };
const set = (node: HTMLInputElement | HTMLSelectElement, value: string) => { assert(node, 'Missing input'); Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); };
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
async function seed() {
  useLocaleStore.setState({ locale: 'en', loaded: true }); setRadarAudioEnabled(false); radarDraftStore(P).clear();
  await db.projects.put({ ...project, codexTemplates: [{ id: 'radar-source-type', name: 'Source', category: 'custom', fields: { base: '4', total: '' }, content: '', propertyDefinitions: [{ id: 'base-id', key: 'base', label: 'Base', kind: 'number' }, { id: 'total-id', key: 'total', label: 'Total', kind: 'number', formula: '=@[Base] * 2', formulaBindings: { Base: 'base-id' } }], revision: 1, createdAt: 1, updatedAt: 1 }] });
  await db.codexEntries.put(source); return saveRadarChart(P, fixture(), null);
}
async function clean(cloneId?: string) { radarDraftStore(P).clear(); setRadarAudioEnabled(false); for (const id of [P, cloneId].filter((id): id is string => Boolean(id))) { await db.codexEntries.where('projectId').equals(id).delete(); await db.documentArchives.where('projectId').equals(id).delete(); await db.projects.delete(id); } }

export async function testRadarDepth(): Promise<string[]> {
  const passed: string[] = [], host = document.getElementById('root')!, root = createRoot(host); let cloneId: string | undefined;
  const render = async (visible = true) => { await act(async () => { root.render(<StrictMode><MemoryRouter>{visible && <RadarEngine projectId={P} />}</MemoryRouter></StrictMode>); await pause(150); }); await act(async () => { await pause(150); }); };
  const click = async (node: HTMLElement | undefined | null, label: string) => { assert(node, `Missing ${label}`); await act(async () => { node.click(); await pause(120); }); };
  try {
    let chart = await seed(); const axis = chart.axes[0], manual = chart.series[0], live = chart.series[1];
    assert(snapRadarValue(axis, -100) === -10 && snapRadarValue(axis, 99) === 30 && snapRadarValue(axis, 7.2) === 8, 'Scale snapping');
    const point = radarPoint(0, chart.axes.length, .8); assert(radarValueAtPoint(axis, 0, chart.axes.length, point.x + 80, point.y) === 22, 'Drag projection must follow only its own axis');
    assert(radarNotches({ ...axis, step: .00000001 }).length < 14, 'Dense scales need readable drawing density');
    const modified = setRadarValue(chart, manual.id, axis.id, 22); assert(modified.series[0].values[axis.id] === 22 && modified.series[1].values[axis.id] === 5 && chart.series[0].values[axis.id] === 5, 'Manual drag changed another series or source chart');
    await rejects(() => setRadarValue(chart, live.id, axis.id, 1));
    for (const extra of [{ step: 0 }, { icon: '" onload="alert(1)' }, { color: 'red' }]) await rejects(() => validateRadarChart({ ...chart, axes: [{ ...axis, ...extra }, ...chart.axes.slice(1)] }));
    passed.push('Pure per-axis snapping/projection, per-series isolation, read-only bindings, readable notches and legacy-safe metadata validation');
    const copy = cloneRadarChart(chart); assert(copy.id !== chart.id && copy.axes[0].id !== axis.id && copy.series[1].bindings?.[copy.axes[0].id] === 'total', 'Nested identity clone broke a binding');
    const json = parseRadarJson(exportRadarJson(chart)); assert(json.axes[0].icon === 'Accessibility' && json.isPreset && json.presetCategory === chart.presetCategory, 'JSON lost schema/style/preset metadata');
    const csv = parseRadarCsv(exportRadarCsv(chart)); assert(csv.axes[0].step === 2 && csv.axes[0].icon === axis.icon && csv.axes[0].color === axis.color, 'Styled CSV did not round-trip');
    assert(parseRadarCsv('axis,min,max,unit,series:Legacy\nA,0,10,,2\nB,0,10,,3\nC,0,10,,4').series[0].name === 'Legacy', 'Legacy CSV rejected');
    const svg = await exportRadarSvgComplete(chart); assert(svg.includes('data-axis-icon="Accessibility"') && svg.includes('lucide-accessibility') && svg.includes('#81a8d3') && !svg.includes('foreignObject'), 'SVG omitted complete local icon/style');
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml'); assert(!parsed.querySelector('parsererror'), 'SVG is malformed XML');
    passed.push('JSON/preset/nested clone and styled CSV remain portable; legacy CSV imports and standalone SVG contains actual full-catalogue Lucide paths');
    assert(RADAR_TOOLS.every(tool => getBridgeTool(tool.name)?.engineId === 'radar' && typeof RADAR_HANDLERS[tool.name as keyof typeof RADAR_HANDLERS] === 'function'), 'Native radar schema/handler registration missing');
    const list = await runBridgeTool('wh_radar_list', { projectId: P }); assert(list.ok, list.error ?? 'Native list');
    const read = await runBridgeTool('wh_radar_get', { projectId: P, chartId: chart.id }); assert(read.ok && (read.result as { resolved: { values: Record<string, number> }[] }).resolved[1].values[axis.id] === 8, 'Native get ignored derived Codex property');
    const edit = await runBridgeTool('wh_radar_set_value', { projectId: P, chartId: chart.id, seriesId: manual.id, axisId: axis.id, value: 18.7, expectedRevision: chart.revision }); assert(edit.ok, edit.error ?? 'Native value');
    chart = (edit.result as { chart: typeof chart }).chart;
    const readonly = await runBridgeTool('wh_radar_set_value', { projectId: P, chartId: chart.id, seriesId: live.id, axisId: axis.id, value: 0, expectedRevision: chart.revision }); assert(!readonly.ok && readonly.code === 'bad-args', 'Native setter wrote a Codex-bound vertex');
    const stale = await runBridgeTool('wh_radar_save', { projectId: P, chart: { ...chart, title: 'Stale overwrite' }, expectedRevision: chart.revision - 1 }); assert(!stale.ok && (await db.projects.get(P))!.radarCharts![0].title !== 'Stale overwrite', 'Stale native save overwrote chart');
    const preset = await runBridgeTool('wh_radar_from_preset', { projectId: P, sourceChartId: chart.id, title: 'Independent preset copy' }); assert(preset.ok, preset.error ?? 'Native preset');
    const presetChart = (preset.result as { chart: typeof chart }).chart; assert(presetChart.axes[0].id !== axis.id && !presetChart.series[1].linkedEntryId && !presetChart.series[1].bindings && presetChart.axes[0].color === axis.color && !presetChart.isPreset, 'Preset copy retained references or lost style');
    for (const format of ['json', 'csv', 'svg']) { const exported = await runBridgeTool('wh_radar_export', { projectId: P, chartId: chart.id, format }); assert(exported.ok && (exported.result as { content: string }).content.length > 100, `Native ${format} export`); }
    const imported = await runBridgeTool('wh_radar_import', { projectId: P, content: exportRadarJson(chart), title: 'Native imported' }); assert(imported.ok, imported.error ?? 'Native import');
    const importedChart = (imported.result as { chart: typeof chart }).chart;
    assert((await runBridgeTool('wh_radar_archive', { projectId: P, chartId: importedChart.id, expectedRevision: importedChart.revision })).ok, 'Native archive');
    assert((await db.documentArchives.where('projectId').equals(P).toArray()).some(item => item.sourceId === importedChart.id), 'Native deletion was not recoverable');
    assert((await runBridgeTool('wh_radar_settings', { projectId: P, soundEnabled: true })).ok && radarAudioEnabled() && localStorage.getItem('wh.radar.notch-audio') === 'on', 'Native local audio preference'); setRadarAudioEnabled(false);
    passed.push('Nine native tools are registered and execute reads/live calculated Codex values, edits/CAS, presets, portable exports/import, archive and local sound settings');
    cloneId = await importProjectData({ project: (await db.projects.get(P))!, codexEntries: [source] });
    const cloned = (await db.projects.get(cloneId))!, cloneChart = cloned.radarCharts![0]; assert(cloneChart.id !== chart.id && cloneChart.axes[0].icon === axis.icon && cloneChart.isPreset && cloneChart.series[1].linkedEntryId !== source.id, 'Native project clone lost metadata or retained foreign source ID');
    passed.push('Native project clone retains preset/axis settings and remaps linked Codex IDs');
    await render();
    const handle = () => host.querySelector<SVGCircleElement>(`[data-radar-handle="${manual.id}:${axis.id}"]`)!;
    const saved = chart.series[0].values[axis.id]; assert(handle() && host.querySelector('[role="slider"][aria-disabled="true"]'), 'Accessible editable/bound vertices missing');
    await act(async () => { handle().focus(); handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await pause(); });
    assert(radarDraftStore(P).get(chart.id)!.chart.series[0].values[axis.id] === snapRadarValue(axis, saved + 2), 'Keyboard did not update target series');
    const bound = host.querySelector<SVGCircleElement>(`[data-radar-handle="${live.id}:${axis.id}"]`)!; const beforeBound = JSON.stringify(radarDraftStore(P).get(chart.id)!.chart);
    await act(async () => { bound.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await pause(); });
    assert(JSON.stringify(radarDraftStore(P).get(chart.id)!.chart) === beforeBound && (await db.codexEntries.get(source.id))!.fields.base === '4', 'Keyboard wrote bound value or Codex source');
    await render(false); await render(); assert(Number(handle().getAttribute('aria-valuenow')) === snapRadarValue(axis, saved + 2), 'Keyboard draft did not recover');
    await act(async () => { set(host.querySelector<HTMLInputElement>('[aria-label="Manual value · 1 · Influence"]')!, '50'); await pause(); });
    // Real pointer capture is covered by the CSS runner. This focused event checks
    // cancellation restores the raw outlier rather than its clipped drawing value.
    Object.defineProperty(handle(), 'setPointerCapture', { configurable: true, value() {} });
    await act(async () => { handle().dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true })); handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await pause(); });
    await act(async () => { handle().dispatchEvent(new PointerEvent('pointercancel', { pointerId: 77, bubbles: true })); await pause(); });
    assert(radarDraftStore(P).get(chart.id)!.chart.series[0].values[axis.id] === 50, 'Cancel clipped an authored outlier');
    await click(button('Axes & scales'), 'axis settings');
    await act(async () => { set(host.querySelector<HTMLInputElement>('[aria-label="Step · 1"]')!, '0'); await pause(); });
    assert(button('Save chart')!.disabled && host.textContent?.includes('step must be greater than zero'), 'Invalid interaction step can save or has no visible explanation');
    await render(false); await render(); await click(button('Axes & scales'), 'recovered axis settings');
    assert(host.querySelector<HTMLInputElement>('[aria-label="Step · 1"]')!.value === '0', 'Intermediate invalid step draft did not recover');
    await act(async () => { set(host.querySelector<HTMLInputElement>('[aria-label="Step · 1"]')!, '1'); set(host.querySelector<HTMLInputElement>('[aria-label="Axis color · 1"]')!, '#b596ca'); await pause(); });
    await click(host.querySelector('[data-radar-axis-icon] button'), 'axis icon picker'); await click(document.querySelector<HTMLButtonElement>('button[title="Shield"]'), 'Lucide Shield');
    await click(button('Save chart'), 'save styles'); assert((await db.projects.get(P))!.radarCharts![0].axes[0].icon === 'Shield', 'UI icon did not save');
    await act(async () => { set(host.querySelector<HTMLSelectElement>('[aria-label="Radar presets"]')!, `saved:${chart.id}`); await pause(); }); await click(button('Create from preset'), 'world preset');
    const staged = [...radarDraftStore(P).values()].find(item => item.base === null)!; assert(staged && staged.chart.axes[0].icon === 'Shield' && !staged.chart.series[1].linkedEntryId, 'World preset GUI did not make an independent reusable chart');
    passed.push('Real GUI exposes read-only bound vertices, keyboard editing, draft recovery, saved Lucide/color/step settings and independent world preset creation');
    return passed;
  } finally { await act(async () => root.unmount()); await clean(cloneId); }
}

interface LayoutState { __want: { w: number; h: number; n: number } | null; __sizeAck: number; __shot: { name: string } | null; __shotDone: string; __nativeDrag: { from: { x: number; y: number }; to: { x: number; y: number }; n: number; cancel?: boolean } | null; __dragDone: number }
export async function testRadarDepthLayout(): Promise<string[]> {
  const host = document.getElementById('root')!, root = createRoot(host), state = window as unknown as LayoutState, passed: string[] = [];
  const NativeAudioContext = window.AudioContext; let audioTicks = 0;
  window.AudioContext = class extends NativeAudioContext { override createOscillator() { audioTicks++; return super.createOscillator(); } };
  const render = async (visible = true) => { await act(async () => { root.render(<MemoryRouter>{visible && <RadarEngine projectId={P} />}</MemoryRouter>); await pause(180); }); await act(async () => { await pause(180); }); };
  const wait = async (predicate: () => boolean, message: string) => { const end = Date.now() + 8000; await act(async () => { while (!predicate() && Date.now() < end) await pause(25); }); assert(predicate(), message); };
  try {
    const chart = await seed(), axis = chart.axes[0], manual = chart.series[0]; await render();
    for (const [w, h] of [[1440, 1000], [640, 860]]) {
      state.__want = { w, h, n: w }; await wait(() => state.__sizeAck === w, 'Viewport did not resize');
      if (w === 640) await act(async () => { button('Sound muted')!.click(); await pause(); });
      host.querySelector('svg[role="group"]')!.scrollIntoView({ block: 'center' }); await pause(100);
      const handle = host.querySelector<SVGCircleElement>(`[data-radar-handle="${manual.id}:${axis.id}"]`)!;
      const svg = handle.ownerSVGElement!, matrix = svg.getScreenCTM()!, from = new DOMPoint(Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))).matrixTransform(matrix), target = radarPoint(0, chart.axes.length, .8), to = new DOMPoint(target.x + 60, target.y).matrixTransform(matrix);
      state.__nativeDrag = { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, n: w }; await wait(() => state.__dragDone === w, 'Native pointer drag did not finish');
      assert(radarDraftStore(P).get(chart.id)!.chart.series[0].values[axis.id] === 22, 'Actual pointer capture did not project the dragged axis');
      const after = host.querySelector<SVGCircleElement>(`[data-radar-handle="${manual.id}:${axis.id}"]`)!, afterPoint = new DOMPoint(Number(after.getAttribute('cx')), Number(after.getAttribute('cy'))).matrixTransform(svg.getScreenCTM()!), end = radarPoint(0, chart.axes.length, .3), cancelTo = new DOMPoint(end.x + 40, end.y).matrixTransform(svg.getScreenCTM()!);
      state.__nativeDrag = { from: { x: afterPoint.x, y: afterPoint.y }, to: { x: cancelTo.x, y: cancelTo.y }, n: w + 1, cancel: true }; await wait(() => state.__dragDone === w + 1, 'Native cancel did not finish');
      assert(radarDraftStore(P).get(chart.id)!.chart.series[0].values[axis.id] === 22, 'Escape failed to restore the original drag value');
      await act(async () => { set(host.querySelector<HTMLSelectElement>('[aria-label="Series to drag"]')!, chart.series[1].id); await pause(); });
      const secondAxis = chart.axes[1], secondHandle = host.querySelector<SVGCircleElement>(`[data-radar-handle="${chart.series[1].id}:${secondAxis.id}"]`)!, secondMatrix = secondHandle.ownerSVGElement!.getScreenCTM()!, secondFrom = new DOMPoint(Number(secondHandle.getAttribute('cx')), Number(secondHandle.getAttribute('cy'))).matrixTransform(secondMatrix), secondValue = w === 1440 ? 8 : 6, secondTarget = radarPoint(1, chart.axes.length, secondValue / 10), secondTo = new DOMPoint(secondTarget.x, secondTarget.y).matrixTransform(secondMatrix);
      state.__nativeDrag = { from: { x: secondFrom.x, y: secondFrom.y }, to: { x: secondTo.x, y: secondTo.y }, n: w + 2 }; await wait(() => state.__dragDone === w + 2, 'Second series native drag');
      const currentDraft = radarDraftStore(P).get(chart.id)!.chart;
      assert(currentDraft.series[1].values[secondAxis.id] === secondValue && currentDraft.series[0].values[secondAxis.id] === 5 && (await db.codexEntries.get(source.id))!.fields.base === '4', 'Selected-series drag changed another series or source');
      await act(async () => { set(host.querySelector<HTMLSelectElement>('[aria-label="Series to drag"]')!, manual.id); await pause(); });
      if (w === 1440) assert(audioTicks === 0, 'Muted interaction created audio'); else assert(audioTicks > 0, 'Opt-in interaction did not synthesize local notch audio');
      assert(host.scrollWidth <= innerWidth + 1, 'Radar UI overflowed the window');
      const graphic = host.querySelector<SVGSVGElement>('svg[role="group"]')!, bounds = graphic.getBoundingClientRect(); assert(bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.height > 200, 'Real radar plot bounds invalid');
      state.__shot = { name: `radar-depth-${w}` }; await wait(() => state.__shotDone === `radar-depth-${w}`, 'Screenshot did not finish');
      passed.push(`Actual CSS ${w}×${h}: native pointer capture edits either selected series, preserves Codex, Escape restores values, plot fits the window`);
      if (w === 1440) { await act(async () => { button('Axes & scales')!.click(); await pause(); }); host.querySelector('article')!.scrollIntoView({ block: 'center' }); state.__shot = { name: 'radar-axis-style-1440' }; await wait(() => state.__shotDone === 'radar-axis-style-1440', 'Axis screenshot'); await act(async () => { button('Series & values')!.click(); await pause(); }); }
    }
    assert(radarAudioEnabled() && audioTicks > 0, 'Opt-in local audio did not run');
    await render(false); await render(); assert(button('Sound on') && Number(host.querySelector(`[data-radar-handle="${manual.id}:${axis.id}"]`)!.getAttribute('aria-valuenow')) === 22, 'Local sound preference/drag draft did not survive remount');
    passed.push('Muted mode creates no audio; opt-in runs real local WebAudio; preference and unsaved drag draft survive closing/reopening');
    return passed;
  } finally { await act(async () => root.unmount()); window.AudioContext = NativeAudioContext; await clean(); }
}
