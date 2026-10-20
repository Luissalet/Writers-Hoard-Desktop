import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { useLocaleStore } from '@/stores/localeStore';
import { flushPendingWrites } from '@/services/pendingWrites';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { regionClient } from '@/engines/worldgen/region/client';
import { canonWindowCover, composeCanonWindow } from '@/engines/worldgen/region/composeWindow';
import { tileGeometry } from '@/engines/worldgen/region/tiles';
import { quantizeCanonTile, encodeCanonTile, decodeCanonTile } from '@/engines/worldgen/region/canonStore';
import { stableStringify } from '@/engines/worldgen/region/workerProtocol';
import { adjustSheetEdges, applySheetFrame, savedSheetFrame, sheetSpec } from '@/engines/worldgen/sheets/frame';
import { requestFixedSheet, type SheetRequest } from '@/engines/worldgen/sheets/client';
import { renderFixedSheet } from '@/engines/worldgen/sheets/render';
import { saveWorldRegionChanges, WorldRegionConflict } from '@/engines/worldgen/sheets/store';
import FixedSheetView from '@/engines/worldgen/sheets/FixedSheetView';
import { themeById } from '@/engines/worldgen/cartography/theme';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { fixedSheet, sheetGeography, sheetTile, sheetWorkerFactory, sheetWorld } from './worldgen-fixed-sheet-data';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
export async function testWorldgenFixedSheets(): Promise<string[]> {
  const P = `fixed-sheets-${Date.now()}`, W = `${P}-world`, root = createRoot(document.getElementById('root')!), passed: string[] = [];
  const initial = fixedSheet(), frame = savedSheetFrame(initial), world: GeneratedWorld = { id: W, projectId: P, title: 'Islas', params: sheetWorld.params, regions: [initial], edits: '[{"kind":"placesEverywhere","enabled":true}]', thumbnail: 'unchanged', journeys: [], createdAt: 1, updatedAt: 1 };
  const wait = async (test: () => boolean, message: string) => { for (let i = 0; i < 150; i++) { if (test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = document.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (id: string) => act(async () => { node(id).click(); await pause(120); });
  const change = async (id: string, value: string) => act(async () => { const element = node<HTMLInputElement>(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
  try {
    const grown = adjustSheetEdges(sheetWorld, frame, { west: 10.25, east: 20.5, north: 1.125, south: 3.75 }), restored = adjustSheetEdges(sheetWorld, grown, { west: -10.25, east: -20.5, north: -1.125, south: -3.75 });
    assert(Math.abs(restored.x - frame.x) < 1e-9 && Math.abs(restored.y - frame.y) < 1e-9 && restored.widthKm === frame.widthKm && restored.heightKm === frame.heightKm, 'Asymmetric crop and grow are reversible in physical units');
    assert(sheetSpec(sheetWorld, { ...frame, x: 0 }).spec.gx0 < 0, 'Longitude seam frames remain contiguous unwrapped windows');
    for (const invalid of [{ ...frame, y: 0 }, { ...frame, widthKm: -1 }, { ...frame, heightKm: NaN }, { ...frame, widthKm: 800, heightKm: 800 }]) { let rejected = false; try { sheetSpec(sheetWorld, invalid); } catch { rejected = true; } assert(rejected, 'Invalid polar, empty, nonfinite and over-budget frames reject'); }
    passed.push('Fixed sheet geometry: precise dimensions, asymmetric reversible edges, seam wrapping, polar/invalid/raster budget guards');

    const broad = sheetSpec(sheetWorld, grown), narrow = sheetSpec(sheetWorld, frame), ids = canonWindowCover(sheetWorld, broad.spec);
    const tiles = ids.map(id => ({ id, data: quantizeCanonTile(sheetTile(tileGeometry(sheetWorld, id))) }));
    const broadData = composeCanonWindow(sheetWorld, tiles, broad.spec), narrowData = composeCanonWindow(sheetWorld, tiles, narrow.spec);
    for (const key of ['elevation', 'water', 'flow', 'slope', 'wet', 'biome', 'cover'] as const) for (let y = 0; y < narrow.spec.ch; y++) { const from = (y + narrowData.margin) * narrowData.width + narrowData.margin, bx = narrow.spec.gx0 - broad.spec.gx0 + broadData.margin, by = narrow.spec.gy0 - broad.spec.gy0 + y + broadData.margin; const a = narrowData[key].subarray(from, from + narrow.spec.cw), b = broadData[key].subarray(by * broadData.width + bx, by * broadData.width + bx + narrow.spec.cw); assert(new Uint8Array(a.buffer, a.byteOffset, a.byteLength).every((byte, index) => byte === new Uint8Array(b.buffer, b.byteOffset, b.byteLength)[index]), `Overlapping ${key} bytes stay identical`); }
    assert(narrowData.places.every(place => broadData.places.some(other => other.sourceKey === place.sourceKey && other.worldX === place.worldX && other.worldY === place.worldY)) && broadData.fields.length > 0 && broadData.hedges.length > 0 && broadData.dykes.length > 0, 'Shared canon preserves source keys/world anchors and all vector classes');
    const decoded = await decodeCanonTile(await encodeCanonTile(tiles[0].data)); assert(stableStringify(decoded.places) === stableStringify(tiles[0].data.places) && decoded.elevation.every((value, index) => value === tiles[0].data.elevation[index]), 'Persisted canon roundtrip retains overlapping authored data and entity identities');
    passed.push('Exact canonical composition: all seven raster overlaps byte-identical; places, streams, tracks, fields, hedges/dykes and cached source identities retained');

    regionClient.newEpoch(); const metrics = { generated: 0, active: 0, maxActive: 0, cancelled: 0 }, factory = sheetWorkerFactory(metrics);
    const result = await requestFixedSheet(sheetWorld, sheetGeography, frame, { workerFactory: factory, edits: world.edits }).promise, generated = metrics.generated;
    await requestFixedSheet(sheetWorld, sheetGeography, frame, { workerFactory: factory, edits: world.edits }).promise;
    assert(metrics.maxActive <= 2 && metrics.generated === generated, 'Fixed sheets share cached canonical tiles with at most two concurrent requests');
    const canvas = document.createElement('canvas'); renderFixedSheet(result, sheetWorld, themeById('parchment'), canvas, 900, initial.title);
    assert(canvas.width === 900 && canvas.height === Math.round(900 / initial.params.aspect), 'PNG canvas uses exact saved aspect independently of host viewport');
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); assert(blob && blob.type === 'image/png' && blob.size > 1000, 'Actual PNG encoding produces the same frame');
    const cancelled = requestFixedSheet(sheetWorld, sheetGeography, { ...frame, x: frame.x + 30 }, { workerFactory: factory }); cancelled.cancel(); let aborted = false; try { await cancelled.promise; } catch (error) { aborted = error instanceof Error && error.name === 'AbortError'; } assert(aborted, 'Cancelling fixed sheet composition stops queued work');
    passed.push('Production canon client: bounded concurrency, shared cache hit, cancellation; actual renderer/PNG aspect independent of viewport');

    await db.projects.put({ id: P, title: 'Sheets', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 }); await db.generatedWorlds.put(world);
    await db.worldWaypoints.put({ id: 'pin', worldId: W, projectId: P, name: 'Source pin', color: '#d5b575', u: .5, v: .5, createdAt: 1, updatedAt: 1 });
    await db.worldSnapshots.put({ worldId: W, key: 'untouched-cache', version: 1, bytes: new Uint8Array([1, 3, 5, 7]), width: 2048, height: 1024, savedAt: 1 });
    const before = stableStringify(await db.generatedWorlds.get(W)), pins = stableStringify(await db.worldWaypoints.toArray());
    const second = { ...initial, id: 'second', title: 'Another sheet' }; await saveWorldRegionChanges(P, W, [], [second], world.params);
    const changed = { ...applySheetFrame(initial, grown), updatedAt: 2 }; await saveWorldRegionChanges(P, W, [initial], [changed], world.params);
    let conflicted = false; try { await saveWorldRegionChanges(P, W, [initial], [{ ...initial, title: 'Stale' }], world.params); } catch (error) { conflicted = error instanceof WorldRegionConflict; } assert(conflicted, 'Concurrent same-region CAS rejects stale framing');
    let foreign = false; try { await saveWorldRegionChanges('foreign', W, [], [initial]); } catch { foreign = true; } assert(foreign, 'Foreign project cannot modify a sheet');
    const saved = (await db.generatedWorlds.get(W))!; assert(saved.regions?.length === 2 && stableStringify({ ...saved, regions: world.regions, updatedAt: world.updatedAt }) === before && stableStringify(await db.worldWaypoints.toArray()) === pins, 'Independent region additions merge and parameters, ordered edits, journeys, thumbnail and waypoint rows remain intact');
    assert([...(await db.worldSnapshots.get(W))!.bytes].join(',') === '1,3,5,7', 'Region framing does not invalidate or rewrite terrain snapshot bytes');
    let recipeConflict = false; try { await saveWorldRegionChanges(P, W, [changed], [{ ...changed, title: 'Old recipe' }], { ...world.params, seed: 'different' }); } catch (error) { recipeConflict = error instanceof WorldRegionConflict; } assert(recipeConflict, 'Stale world recipe cannot publish frame coordinates');
    const archive = await createProjectZipArchive(P); await db.generatedWorlds.delete(W); await db.worldWaypoints.where('worldId').equals(W).delete(); await db.projects.delete(P); await importProjectZip(new File([archive.blob], archive.fileName));
    assert(stableStringify((await db.generatedWorlds.get(W))!.regions) === stableStringify(saved.regions), 'Actual ZIP restore retains exact fixed framing and source IDs');
    passed.push('Scoped per-region CAS merges independent sheets and rejects stale/foreign writes; source recipe/edits/entities untouched; real ZIP preserves framing');

    useLocaleStore.setState({ locale: 'en' }); let blocked = true, closed = 0, saves = 0;
    const request: SheetRequest = (source, geography, nextFrame, options) => requestFixedSheet(source, geography, nextFrame, { ...options, workerFactory: factory });
    const render = async (key = 'ui') => act(async () => { root.render(<EnginePaneContext.Provider value={{ instanceId: 'sheet-test', visible: true }}><FixedSheetView key={key} record={saved} initial={changed} existing world={sheetWorld} canon={{ world: sheetWorld, edits: world.edits }} geography={sheetGeography} theme={themeById('parchment')} prepare={async () => !blocked} onSaved={() => { saves++; }} onClose={() => { closed++; }} request={request} /></EnginePaneContext.Provider>); await pause(350); });
    await render(); await wait(() => !node<HTMLCanvasElement>('sheet-canvas').hidden, 'Fixed sheet UI did not render canonical preview');
    const dimensions = node('sheet-dimensions').textContent, pixelAspect = node<HTMLCanvasElement>('sheet-canvas').width / node<HTMLCanvasElement>('sheet-canvas').height;
    window.dispatchEvent(new Event('resize')); assert(node('sheet-dimensions').textContent === dimensions && node<HTMLCanvasElement>('sheet-canvas').width / node<HTMLCanvasElement>('sheet-canvas').height === pixelAspect, 'Viewport resize cannot change saved sheet frame');
    await change('sheet-edge-west', '-5.125'); await click('sheet-apply-edges'); assert(node('sheet-dimensions').textContent !== dimensions, 'Edge form changes real frame'); await click('sheet-undo'); assert(node('sheet-dimensions').textContent === dimensions, 'Undo restores precise previous frame'); await click('sheet-redo');
    await change('sheet-name', 'Retained after failure'); assert(!(await flushPendingWrites()).ok, 'Unsaved framing guards global workspace close'); await click('sheet-save'); assert(document.querySelector('[role="alert"]') && node<HTMLInputElement>('sheet-name').value === 'Retained after failure' && saves === 0, 'Failed pending flush keeps entered title/frame mounted');
    blocked = false; await click('sheet-save'); assert(saves === 1 && node('fixed-sheet').textContent?.includes('Sheet saved'), 'Successful retry commits frame');
    await change('sheet-edge-west', '-9999'); await click('sheet-apply-edges'); assert(node<HTMLInputElement>('sheet-edge-west').value === '-9999' && document.querySelector('[role="alert"]'), 'Rejected crop retains edge input'); await click('sheet-close'); assert(closed === 0 && document.querySelectorAll('[role="dialog"]').length === 2, 'Closing unsaved frame requests explicit discard');
    await act(async () => { root.render(null); await pause(); }); await render('recovered');
    assert(node<HTMLInputElement>('sheet-edge-west').value === '-9999' && node<HTMLInputElement>('sheet-name').value === 'Retained after failure', 'Remount restores unpublished edge input and title with their saved CAS baseline');
    passed.push('Real fixed-sheet UI: stable aspect, crop/undo/redo, pending-close guard, failed save input retention/retry and explicit discard');
    return passed;
  } finally { await act(async () => root.unmount()); regionClient.newEpoch(); await db.generatedWorlds.delete(W); await db.worldSnapshots.delete(W); await db.worldWaypoints.where('worldId').equals(W).delete(); await db.projects.delete(P); }
}
