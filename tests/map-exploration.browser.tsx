// Fog of exploration and the party marker of picture maps: the pure raster helpers, the bridge tools
// (wh_map_reveal, wh_map_party: stale refusal, undo, engine-off), the editor (brush, reveal/hide all, party,
// trail, player view), persistence (reload, JSON, ZIP, clone) and the exports (unchanged by default,
// fogged only when asked).
import '@/engines';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import MapsEngine from '@/engines/maps/MapsEngine';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { saveWorldEra } from '@/services/worldEras/store';
import { validateWikiOptions } from '@/services/wikiProfiles/validation';
import { exportMapSvg, DEFAULT_MAP_LAYERS } from '@/components/maps/mapGeometry';
import { useLocaleStore } from '@/stores/localeStore';
import {
  MAX_TRAIL_STEPS, applyRevealOps, cellRevealed, createExploration, decodeMask, encodeMask, explorationRows, exploredPercent, fogOf, fogPathData, movePartyRecord,
  paintCircle, readExploration, EXPLORATION_COLS,
} from '@/components/maps/mapExploration';
import type { MapExploration, MapFeature, MapPin, Project, WorldMap } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

type Audit = { entityId: string; projectId: string; before: unknown };
const audit = (reply: BridgeReply): Audit => (reply.result as { __audit: Audit }).__audit;
const undo = (tool: string, reply: BridgeReply) => { const a = audit(reply); return runBridgeTool('__undo', { entry: { tool, kind: 'update', entityId: a.entityId, projectId: a.projectId, before: a.before, summary: 'x' } }); };
const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: expected a refusal matching ${pattern}, got ${JSON.stringify(reply).slice(0, 300)}`);
const plain = (html: string) => html.replace(/nonce[-=]"?[0-9a-f]{36}/g, 'nonce-N').replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_all, open: string, body: string, close: string) => open + body.replace(/\b([A-Za-z_]+)\d+\b/g, '$1N') + close);

/** A real PNG of the given pixel size, as a data URL. */
function png(width: number, height: number): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = '#446655'; context.fillRect(0, 0, width, height);
  return canvas.toDataURL('image/png');
}

export async function testMapExploration(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host);
  const passed: string[] = [];
  const P = `map-exp-${Date.now()}`, Q = `${P}-off`, M = `${P}-map`, M2 = `${P}-plain`, MQ = `${P}-offmap`, HARBOUR = `${P}-harbour`, CITADEL = `${P}-citadel`;
  const cleanup: string[] = [];
  const style = document.createElement('style');
  style.textContent = '.relative.inline-block{position:relative;display:inline-block}.absolute.inset-0{position:absolute;inset:0;width:100%;height:100%}';
  document.head.append(style);
  useLocaleStore.setState({ locale: 'en' });
  const project = (id: string, engines: string[]): Project => ({ id, title: id, description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: engines, createdAt: 1, updatedAt: 1 });
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = host.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const has = (id: string) => !!host.querySelector(`[data-testid="${id}"]`);
  const click = async (id: string) => act(async () => { node<HTMLElement>(id).click(); await pause(120); });
  const until = async (message: string, test: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(50); }); }
    throw new Error(message);
  };
  const record = async (id = M): Promise<MapExploration | undefined> => readExploration((await db.worldMaps.get(id))?.exploration);
  const revealedAt = async (x: number, y: number, id = M) => { const r = (await record(id))!; return cellRevealed(decodeMask(r), r.cols, r.rows, x, y); };
  const render = async (key: string, mapId = M) => {
    await act(async () => { root.render(<StrictMode><MemoryRouter key={key} initialEntries={[`/project/${P}/maps?map=${mapId}`]}><MapsEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(250); });
    await until('Map did not mount', () => has('map-fog-toggle') && !!host.querySelector('img'));
    await act(async () => { await pause(150); });
  };
  /** Pointer events on a layer at positions given in percent of the picture. */
  const gesture = async (id: string, steps: [number, number][]) => {
    const layer = node(id), rect = layer.getBoundingClientRect();
    assert(rect.width > 50 && rect.height > 20, `Layer ${id} has no size`);
    const at = ([x, y]: [number, number]) => ({ clientX: rect.left + rect.width * x / 100, clientY: rect.top + rect.height * y / 100, pointerId: 11, pointerType: 'mouse', bubbles: true, button: 0, buttons: 1 });
    await act(async () => { layer.dispatchEvent(new PointerEvent('pointerdown', at(steps[0]))); await pause(30); });
    for (const step of steps.slice(1)) await act(async () => { layer.dispatchEvent(new PointerEvent('pointermove', at(step))); await pause(30); });
    await act(async () => { layer.dispatchEvent(new PointerEvent('pointerup', { ...at(steps[steps.length - 1]), buttons: 0 })); await pause(250); });
  };

  try {
    // ---------------------------------------------------------------- 1. Raster helpers
    assert(explorationRows(0.5) === 128 && explorationRows(undefined) === 160 && explorationRows(0) === 160 && explorationRows(1000) === 1024 && explorationRows(0.001) === 8, 'rows follow the picture proportions and stay in range');
    const cols = EXPLORATION_COLS, rows = explorationRows(0.5);
    const grid = new Uint8Array(cols * rows);
    assert(paintCircle(grid, cols, rows, 50, 50, 10, 1) > 0 && near(exploredPercent(grid), 6.28, 0.5), `A radius-10 circle on a 2:1 picture is about 6.3% of it (got ${exploredPercent(grid)})`);
    assert(cellRevealed(grid, cols, rows, 50, 50) && !cellRevealed(grid, cols, rows, 80, 50) && !cellRevealed(grid, cols, rows, 50, 90), 'The circle is explored in the middle and fogged outside');
    const roundTrip = decodeMask({ cols, rows, mask: encodeMask(grid) });
    assert(roundTrip.every((cell, index) => cell === grid[index]), 'The run-length code round-trips every cell');
    assert(encodeMask(grid).length < 600, `A mask with a circle is compact (${encodeMask(grid).length} characters for ${cols * rows} cells)`);
    assert(encodeMask(new Uint8Array(cols * rows)).length < 12 && decodeMask({ cols, rows, mask: encodeMask(new Uint8Array(cols * rows).fill(1)) }).every(Boolean), 'Empty and full masks are tiny and exact');
    const damaged = decodeMask({ cols, rows, mask: '!!!not base64!!!' });
    assert(damaged.length === cols * rows && damaged.every(cell => cell === 0), 'A damaged mask reads as fully fogged instead of throwing');
    assert(readExploration(null) === undefined && readExploration({ cols: 3, rows: 3, mask: '', enabled: true }) === undefined && readExploration({ cols, rows, mask: 'AA==', enabled: 'yes' }) === undefined && readExploration('x') === undefined, 'Records that cannot be used are ignored');
    const fresh = createExploration(0.5);
    assert(fresh.revision === 0 && fresh.enabled && fresh.cols === cols && fresh.rows === rows && exploredPercent(decodeMask(fresh)) === 0, 'A new record is fully fogged, fog on, revision 0');
    const brushed = applyRevealOps(fresh, [{ op: 'reveal', x: 30, y: 50, radius: 10 }, { op: 'reveal', x: 70, y: 50, radius: 10 }, { op: 'hide', x: 70, y: 50, radius: 4 }]);
    const brushedCells = decodeMask(brushed);
    assert(brushed.revision === 1 && cellRevealed(brushedCells, cols, rows, 30, 50) && !cellRevealed(brushedCells, cols, rows, 70, 50) && cellRevealed(brushedCells, cols, rows, 70, 58), 'Brush operations apply in order: reveal twice, hide the middle of one');
    assert(exploredPercent(decodeMask(applyRevealOps(brushed, [{ op: 'all' }]))) === 100 && exploredPercent(decodeMask(applyRevealOps(brushed, [{ op: 'none' }]))) === 0, 'all explores everything, none fogs everything');
    let walking = fresh;
    for (let i = 0; i < MAX_TRAIL_STEPS + 20; i++) walking = movePartyRecord(walking, { x: 10 + (i % 80), y: 50, sightRadius: 2, trail: true, session: 'S1' }, 1000 + i);
    assert(walking.trail!.length === MAX_TRAIL_STEPS && walking.trail![0].at === 1020 && walking.party!.sightRadius === 2, 'The trail keeps the last 500 steps');
    const stepped = movePartyRecord(fresh, { x: 40, y: 40 }, 5);
    assert(stepped.party!.sightRadius === 8 && !stepped.trail && cellRevealed(decodeMask(stepped), cols, rows, 40, 40), 'Moving without trail leaves none and uses the default sight radius');
    passed.push('Raster helpers: aspect-following grid, compact run-length mask, circle brush, reveal/hide/all/none, party sight and a trail capped at 500; damaged data reads as fogged');

    // ---------------------------------------------------------------- 2. SVG export
    const pinsFor = (): MapPin[] => [{ id: 'a', projectId: P, mapId: M, name: 'HarbourPin', icon: 'port', position: { x: 30, y: 50 } }, { id: 'b', projectId: P, mapId: M, name: 'CitadelPin', icon: 'castle', position: { x: 80, y: 50 } }];
    const shapes: MapFeature[] = [{ id: 'f1', kind: 'label', name: 'PeakLabel', points: [{ x: 85, y: 20 }], color: '#ffffff' }, { id: 'f2', kind: 'label', name: 'BayLabel', points: [{ x: 30, y: 40 }], color: '#ffffff' }];
    const image = png(400, 200);
    const plainSvg = exportMapSvg(image, 800, 400, shapes, pinsFor(), DEFAULT_MAP_LAYERS);
    assert(plainSvg === exportMapSvg(image, 800, 400, shapes, pinsFor(), DEFAULT_MAP_LAYERS, [], undefined, {}, undefined) && plainSvg === exportMapSvg(image, 800, 400, shapes, pinsFor(), DEFAULT_MAP_LAYERS, [], undefined, {}, null), 'The SVG export without fog is the same string as before');
    assert(!plainSvg.includes('data-map-fog') && plainSvg.includes('CitadelPin') && plainSvg.includes('PeakLabel'), 'And it shows everything');
    const sample = movePartyRecord(applyRevealOps(fresh, [{ op: 'reveal', x: 30, y: 50, radius: 12 }]), { x: 30, y: 50, trail: true, session: 'Session 4' }, Date.UTC(2026, 9, 1));
    const foggy = exportMapSvg(image, 800, 400, shapes, pinsFor(), DEFAULT_MAP_LAYERS, [], undefined, {}, fogOf(sample));
    assert(foggy.includes('data-map-fog') && foggy.includes('HarbourPin') && foggy.includes('BayLabel') && !foggy.includes('CitadelPin') && !foggy.includes('PeakLabel'), 'With fog: the pin and the label on explored ground stay, those under fog leave the file');
    assert(foggy.includes('data-map-party') && foggy.includes('Session 4 · 2026-10-01') && !new DOMParser().parseFromString(foggy, 'image/svg+xml').querySelector('parsererror'), 'With fog: the party marker and the trail step (session and date) are drawn, and the SVG is well-formed');
    assert(exportMapSvg(image, 800, 400, shapes, pinsFor(), DEFAULT_MAP_LAYERS, [], undefined, {}, fogOf({ ...sample, enabled: false })) === plainSvg, 'A fog switched off draws nothing');
    assert(fogPathData({ cols, rows, cells: decodeMask(fresh) }, 100, 50) === 'M0 0h100v50h-100z', 'A fully fogged map is one rectangle');
    passed.push('SVG export: unchanged without fog; with fog the unexplored pins and shapes leave the file, party and trail with session and date are drawn');

    // ---------------------------------------------------------------- Fixtures
    await db.projects.bulkPut([project(P, ['maps', 'codex']), project(Q, [])]);
    await db.worldMaps.bulkPut([
      { id: M, projectId: P, title: 'Costa', backgroundImage: image, createdAt: 1, updatedAt: 1 },
      { id: M2, projectId: P, title: 'Sin niebla', backgroundImage: image, createdAt: 1, updatedAt: 1 },
      { id: MQ, projectId: Q, title: 'Apagado', backgroundImage: image, createdAt: 1, updatedAt: 1 },
    ]);
    await db.mapPins.bulkPut([
      { id: HARBOUR, projectId: P, mapId: M, name: 'Harbour', icon: 'port', position: { x: 20, y: 50 } },
      { id: CITADEL, projectId: P, mapId: M, name: 'Citadel', icon: 'castle', position: { x: 80, y: 50 } },
    ]);

    // ---------------------------------------------------------------- 3. Bridge
    const listed = async () => ((await runBridgeTool('wh_list_maps', { projectId: P })).result as { maps: { id: string; exploration?: { revision: number; enabled: boolean; exploredPercent: number; party?: { x: number; y: number; sightRadius: number }; trailSteps: number } }[] }).maps;
    assert((await listed()).every(map => !('exploration' in map)), 'wh_list_maps gives no exploration field to maps without one');
    assert(BRIDGE_TOOLS.some(tool => tool.name === 'wh_map_reveal' && tool.writes) && BRIDGE_TOOLS.some(tool => tool.name === 'wh_map_party' && tool.writes), 'Both tools are in the manifest as writes');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M }), /Nothing to do/, 'no ops');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [] }), /1 to 200/, 'empty ops');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'paint', x: 1, y: 1, radius: 5 }] }), /reveal, hide, all or none/, 'unknown op');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'reveal', x: 120, y: 1, radius: 5 }] }), /0 to 100/, 'x outside');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'reveal', x: 10, y: 10, radius: 0 }] }), /radius must be/, 'radius too small');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'all', radius: 5 }] }), /takes no other field/, 'all with extras');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'all' }], expectedRevision: -1 }), /expectedRevision/, 'negative revision');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, enabled: 'yes' }), /enabled must be/, 'enabled not boolean');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: 'nowhere', ops: [{ op: 'all' }] }), /No map/, 'unknown map');
    bad(await runBridgeTool('wh_map_reveal', { projectId: Q, mapId: M, ops: [{ op: 'all' }] }), /switched off/, 'engine off (the guard answers first)');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: MQ, ops: [{ op: 'all' }] }), /No map/, 'a map of another project');
    bad(await runBridgeTool('wh_map_party', { projectId: P, mapId: M }), /x and y are required/, 'party without place');
    bad(await runBridgeTool('wh_map_party', { projectId: P, mapId: M, x: 50, y: 50, sightRadius: 500 }), /sightRadius must be/, 'sight too large');
    bad(await runBridgeTool('wh_map_party', { projectId: P, mapId: M, x: 50, y: 50, trail: 'yes' }), /trail must be/, 'trail not boolean');
    bad(await runBridgeTool('wh_map_party', { projectId: Q, mapId: MQ, x: 50, y: 50 }), /switched off/, 'party with maps switched off');
    assert(!(await db.worldMaps.get(M))!.exploration && !(await db.worldMaps.get(MQ))!.exploration, 'Every refusal changed nothing');

    const first = await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'reveal', x: 20, y: 50, radius: 12 }], expectedRevision: 0 });
    assert(first.ok, `reveal: ${JSON.stringify(first)}`);
    const firstResult = first.result as { revision: number; enabled: boolean; exploredPercent: number };
    assert(firstResult.revision === 1 && firstResult.enabled && near(firstResult.exploredPercent, 9, 1.5), `The first call creates the record (fog on): ${JSON.stringify(firstResult)}`);
    assert(await revealedAt(20, 50) && !(await revealedAt(80, 50)), 'The saved mask has the circle');
    const read = (await listed()).find(map => map.id === M)!.exploration!;
    assert(read.revision === 1 && read.enabled && read.trailSteps === 0 && !read.party && (await listed()).find(map => map.id === M2)!.exploration === undefined, 'wh_list_maps gives revision, enabled, explored percent and party only on the map that has them');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'all' }], expectedRevision: 0 }), /revision 1/, 'stale revision');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'reveal', x: 20, y: 50, radius: 3 }] }), /Nothing to change/, 'revealing what is already explored');
    assert((await record())!.revision === 1, 'The stale call and the no-op changed nothing');
    const second = await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'reveal', x: 80, y: 50, radius: 8 }, { op: 'hide', x: 20, y: 50, radius: 4 }], expectedRevision: 1 });
    assert(second.ok && (second.result as { revision: number }).revision === 2 && await revealedAt(80, 50) && !(await revealedAt(20, 50)) && await revealedAt(20, 60), 'A second call with the right revision reveals and hides');
    const staleUndo = await undo('wh_map_reveal', first);
    assert(!staleUndo.ok && /changed after/.test(staleUndo.error ?? ''), `Undo of the first call is refused while a later one stands: ${JSON.stringify(staleUndo)}`);
    assert((await undo('wh_map_reveal', second)).ok && await revealedAt(20, 50) && !(await revealedAt(80, 50)) && (await record())!.revision === 3, 'Undo of the latest call puts the fog back (the revision keeps growing)');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'all' }], expectedRevision: 2 }), /revision 3/, 'a revision from before the undo is still stale');
    assert((await undo('wh_map_reveal', first)).ok && !(await db.worldMaps.get(M))!.exploration, 'Then the first can be undone too: the map has no exploration again');
    passed.push('wh_map_reveal: first call creates the record, brush ops apply in order, revision guard and no-op refusals, undo in order and refused when a later change stands, engine-off and wrong-project refusals');

    const toggled = await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'all' }] });
    assert(toggled.ok && (toggled.result as { exploredPercent: number }).exploredPercent === 100, 'reveal all');
    const off = await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, enabled: false });
    assert(off.ok && (await record())!.enabled === false && (await revealedAt(5, 5)), 'enabled:false switches the fog off and keeps the explored area');
    bad(await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, enabled: false }), /Nothing to change/, 'already off');
    assert((await undo('wh_map_reveal', off)).ok && (await record())!.enabled, 'Undo switches it back on');
    assert((await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, ops: [{ op: 'none' }] })).ok && exploredPercent(decodeMask((await record())!)) === 0, 'hide all');

    const move1 = await runBridgeTool('wh_map_party', { projectId: P, mapId: M, x: 30, y: 40, sightRadius: 6, trail: true, session: 'Session 1', expectedRevision: (await record())!.revision });
    assert(move1.ok, `party: ${JSON.stringify(move1)}`);
    let state = (await record())!;
    assert(state.party!.x === 30 && state.party!.sightRadius === 6 && state.trail!.length === 1 && state.trail![0].session === 'Session 1' && await revealedAt(30, 40) && !(await revealedAt(60, 40)), 'The party reveals its sight circle and leaves a trail step with its session');
    const move2 = await runBridgeTool('wh_map_party', { projectId: P, mapId: M, x: 60, y: 40 });
    state = (await record())!;
    assert(move2.ok && state.party!.x === 60 && state.party!.sightRadius === 6 && state.trail!.length === 1 && await revealedAt(60, 40) && await revealedAt(30, 40), 'Moving without trail keeps the sight radius and the trail as it was');
    const move3 = await runBridgeTool('wh_map_party', { projectId: P, mapId: M, x: 61, y: 40, trail: true, session: 'Session 2' });
    assert(move3.ok && (await record())!.trail!.length === 2, 'Trail steps accumulate');
    const partyRead = (await listed()).find(map => map.id === M)!.exploration!;
    assert(partyRead.party!.x === 61 && partyRead.trailSteps === 2 && partyRead.exploredPercent > 0, 'wh_list_maps reports the party and the trail length');
    assert(!(await undo('wh_map_party', move2)).ok, 'Undo of a move is refused once a later move stands');
    assert((await undo('wh_map_party', move3)).ok && (await undo('wh_map_party', move2)).ok && (await record())!.party!.x === 30 && (await record())!.trail!.length === 1, 'Undone in order, the party is back where it was with its trail');
    assert((await undo('wh_map_party', move1)).ok && !(await record())!.party && (await record())!.trail === undefined, 'And before its first move');
    passed.push('wh_map_party: moves reveal a sight circle, trail steps carry the session, sight radius is remembered, undo in order and refused out of order; wh_map_reveal enabled/all/none; wh_list_maps reports party and trail');

    // Eras: a named era keeps its own fog; the base map is not touched.
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 } as never, null);
    const baseFog = JSON.stringify((await db.worldMaps.get(M))!.exploration), eraFog = async () => ((await runBridgeTool('wh_list_maps', { projectId: P, eraId: 'past' })).result as { maps: { id: string; exploration?: { exploredPercent: number } }[] }).maps.find(map => map.id === M)!.exploration;
    const eraReveal = await runBridgeTool('wh_map_reveal', { projectId: P, mapId: M, eraId: 'past', ops: [{ op: 'reveal', x: 50, y: 50, radius: 10 }] });
    assert(eraReveal.ok, `era reveal: ${JSON.stringify(eraReveal)}`);
    assert(JSON.stringify((await db.worldMaps.get(M))!.exploration) === baseFog && (await eraFog())!.exploredPercent > 5, 'In an era the fog is the era\'s own; the shared base is untouched');
    const eraAudit = audit(eraReveal);
    const eraUndo = await runBridgeTool('__undo', { entry: { tool: 'wh_map_reveal', kind: 'update', entityId: eraAudit.entityId, projectId: P, eraId: 'past', before: eraAudit.before, summary: 'era fog' } });
    assert(eraUndo.ok && (await eraFog())!.exploredPercent === 0 && JSON.stringify((await db.worldMaps.get(M))!.exploration) === baseFog, 'Undo in the era takes it back there');
    passed.push('Eras: wh_map_reveal with eraId writes the era\'s own fog (base untouched) and its undo works there');

    // ---------------------------------------------------------------- 4. Editor
    await db.worldMaps.update(M, { exploration: undefined });
    await render('first');
    assert(!has('map-fog-canvas') && !has('map-party-marker'), 'A map without exploration shows no fog and no party');
    await click('map-fog-toggle');
    assert(!node<HTMLInputElement>('map-fog-enabled').checked, 'The fog is off by default');
    await click('map-fog-enabled');
    await until('record created', async () => !!(await record())?.enabled);
    assert(exploredPercent(decodeMask((await record())!)) === 0 && has('map-fog-canvas') && node('map-fog-canvas').getAttribute('data-view') === 'author', 'Switching the fog on fogs the whole map (author view)');
    await click('map-fog-reveal');
    await gesture('map-fog-brush-layer', [[20, 50], [25, 50], [30, 50]]);
    await until('brush saved', async () => await revealedAt(25, 50));
    assert(await revealedAt(20, 50) && await revealedAt(30, 50) && !(await revealedAt(80, 50)), 'The reveal brush stroke saved as one change');
    const revisionAfterStroke = (await record())!.revision;
    assert(revisionAfterStroke === 2, `One stroke is one revision (got ${revisionAfterStroke})`);
    await click('map-fog-hide');
    await gesture('map-fog-brush-layer', [[25, 50]]);
    await until('hide saved', async () => !(await revealedAt(25, 50)));
    assert(await revealedAt(16, 50) && !(await revealedAt(22, 50)), 'The hide brush fogs the spot again');
    await click('map-fog-reveal-all');
    await until('all', async () => exploredPercent(decodeMask((await record())!)) === 100);
    assert(node('map-fog-percent').textContent!.includes('100'), 'Reveal all explores everything and says so');
    await click('map-fog-hide-all');
    await until('none', async () => exploredPercent(decodeMask((await record())!)) === 0);
    await click('map-fog-hide');
    assert(!has('map-fog-brush-layer'), 'Leaving the brush removes its layer');

    await click('map-party-place');
    assert(has('map-party-place-layer'), 'Placing the party opens a click layer');
    await act(async () => { const layer = node('map-party-place-layer'), rect = layer.getBoundingClientRect(); layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.3, clientY: rect.top + rect.height * 0.4 })); await pause(250); });
    await until('party placed', async () => !!(await record())?.party);
    assert(near((await record())!.party!.x, 30, 1.5) && near((await record())!.party!.y, 40, 1.5) && await revealedAt(30, 40) && !(await record())!.trail, 'Clicking places the party, reveals its sight and leaves no trail by default');
    assert(has('map-party-marker') && near(Number(node('map-party-marker').getAttribute('data-x')), 30, 1.5), 'The party marker is drawn there');
    await click('map-party-trail');
    await act(async () => { const input = node<HTMLInputElement>('map-party-session'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Session 2'); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(60); });
    const marker = node('map-party-marker'), rectOf = () => node('map-fog-canvas').getBoundingClientRect();
    const rect = rectOf(), pointer = (type: string, x: number, y: number, buttons = 1) => new PointerEvent(type, { bubbles: true, pointerId: 12, pointerType: 'mouse', button: 0, buttons, clientX: rect.left + rect.width * x / 100, clientY: rect.top + rect.height * y / 100 });
    await act(async () => { marker.dispatchEvent(pointer('pointerdown', 30, 40)); await pause(30); });
    await act(async () => { node('map-party-marker').dispatchEvent(pointer('pointermove', 45, 40)); await pause(30); });
    await act(async () => { node('map-party-marker').dispatchEvent(pointer('pointerup', 60, 40, 0)); await pause(300); });
    await until('party moved', async () => near((await record())!.party?.x ?? 0, 60, 1.5));
    state = (await record())!;
    assert(near(state.party!.y, 40, 1.5) && await revealedAt(60, 40) && state.trail!.length === 1 && state.trail![0].session === 'Session 2', 'Dragging the marker moves the party, reveals around it and adds a trail step with the session');
    assert(has('map-trail') && node('map-trail').getAttribute('data-steps') === '1' && has('map-trail-step-0'), 'The trail is drawn');
    await act(async () => { node('map-party-marker').dispatchEvent(pointer('pointerdown', 60, 40)); await pause(30); });
    await act(async () => { node('map-party-marker').dispatchEvent(pointer('pointerup', 60, 40, 0)); await pause(200); });
    assert((await record())!.trail!.length === 1, 'A click on the marker that does not move it is not a move');

    // Players' view: pins under fog leave the screen, the trail stays.
    await click('map-fog-players');
    assert(node('map-fog-canvas').getAttribute('data-view') === 'players', 'The player view draws the opaque fog');
    assert(!host.querySelector(`[data-map-pin-id="${CITADEL}"]`) && !host.querySelector(`[data-map-pin-id="${HARBOUR}"]`), 'Pins on fogged ground are not drawn for players');
    await click('map-fog-players');
    assert(!!host.querySelector(`[data-map-pin-id="${CITADEL}"]`) && !!host.querySelector(`[data-map-pin-id="${HARBOUR}"]`), 'The author view shows every pin');
    await db.mapPins.update(HARBOUR, { position: { x: 60, y: 42 } });
    await render('players-pins');
    await click('map-fog-players');
    await until('pins redrawn', () => !!host.querySelector(`[data-map-pin-id="${HARBOUR}"]`));
    assert(!!host.querySelector(`[data-map-pin-id="${HARBOUR}"]`) && !host.querySelector(`[data-map-pin-id="${CITADEL}"]`) && has('map-trail') && has('map-party-marker'), 'For players: the pin on explored ground shows, the one under fog does not, the trail and the party stay');
    assert(!has('map-fog-enabled'), 'The player view offers no editing controls');
    await click('map-fog-players');
    await db.mapPins.update(HARBOUR, { position: { x: 20, y: 50 } });

    const before = await record();
    await render('reload');
    await click('map-fog-toggle');
    assert(has('map-fog-canvas') && has('map-party-marker') && JSON.stringify(await record()) === JSON.stringify(before) && node('map-fog-percent').textContent!.includes(String(exploredPercent(decodeMask(before!)))), 'After reopening the map the fog, the party and the trail are as they were');
    await click('map-fog-enabled');
    await until('fog off', async () => (await record())!.enabled === false);
    assert((await record())!.party && exploredPercent(decodeMask((await record())!)) > 0, 'Switching the fog off keeps the explored area and the party');
    await click('map-fog-enabled');
    await until('fog on', async () => (await record())!.enabled === true);
    passed.push('Editor: Fog on, reveal and hide brushes (one stroke = one revision), reveal/hide all, place and drag the party (reveals, trail with session, a plain click is not a move), player view hides pins under fog and keeps trail and party, reload keeps everything');

    // ---------------------------------------------------------------- 5. Persistence
    const expectedExploration = JSON.stringify((await db.worldMaps.get(M))!.exploration);
    const json = await exportProjectData(P);
    assert(JSON.stringify(json).includes('"exploration"'), 'The JSON backup carries the record');
    const importedId = await importProjectData(json); cleanup.push(importedId);
    const importedMap = (await db.worldMaps.where('projectId').equals(importedId).toArray()).find(map => map.title === 'Costa')!;
    assert(JSON.stringify(importedMap.exploration) === expectedExploration, 'JSON import keeps the exploration record exactly');
    const zip = await createProjectZipArchive(P);
    await db.worldMaps.update(M, { exploration: undefined });
    assert(!(await db.worldMaps.get(M))!.exploration, 'Record wiped before the ZIP restore');
    await importProjectZip(new File([zip.blob], 'fog.zip', { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert(JSON.stringify((await db.worldMaps.get(M))!.exploration) === expectedExploration, 'The ZIP restore brings the fog, the party and the trail back');
    const preview = await previewProjectDuplicate({ projectId: P });
    const copy = await duplicateProject({ projectId: P, title: 'Fog copy', operationId: crypto.randomUUID(), expectedSourceVersion: preview.sourceVersion }); cleanup.push(copy.projectId);
    const cloned = (await db.worldMaps.where('projectId').equals(copy.projectId).toArray()).find(map => map.title === 'Costa')!;
    assert(JSON.stringify(cloned.exploration) === expectedExploration && cloned.id !== M, 'The project clone carries the record into the copy map');
    passed.push('Persistence: JSON backup/import, ZIP backup/restore and project clone keep the mask, party and trail exactly');

    // ---------------------------------------------------------------- 6. Wiki / Reader export
    const options = { locale: 'en' as const };
    const buildWith = async (extra: Record<string, unknown> = {}) => { const o = { ...options, ...extra }; return buildWorldWiki(await loadWorldWikiData(P, o), o).html; };
    const exp0 = (await db.worldMaps.get(M))!.exploration!;
    await db.worldMaps.update(M, { exploration: { ...exp0, enabled: true } });
    const withRecord = plain(await buildWith());
    await db.worldMaps.update(M, { exploration: undefined });
    const withoutRecord = plain(await buildWith());
    assert(withRecord === withoutRecord && !withRecord.includes('data-map-fog'), 'Default wiki export: a map with exploration exports the same bytes as one without');
    assert(plain(await buildWith({ exploredFog: false })) === withoutRecord, 'exploredFog:false is the default too');
    await db.worldMaps.update(M, { exploration: { ...exp0, enabled: true } });
    assert(plain(await buildWith({ exploredFog: true })) !== withoutRecord, 'exploredFog:true changes the map article');
    const fogged = await buildWith({ exploredFog: true });
    assert(fogged.includes('data-map-fog') && fogged.includes('data-map-party') && fogged.includes('data-map-trail'), 'With the option: fog layer, party marker and trail are in the page');
    const hiddenPin = (await db.mapPins.get(CITADEL))!.name, shownPin = 'Harbour';
    await db.mapPins.update(HARBOUR, { position: { x: 60, y: 42 } });
    const foggedAgain = await buildWith({ exploredFog: true });
    assert(foggedAgain.includes(`<strong>${shownPin}</strong>`) && !foggedAgain.includes(`<strong>${hiddenPin}</strong>`), 'With the option: the pin on explored ground is listed, the one under fog is not (list and marker)');
    assert((await buildWith()).includes(`<strong>${hiddenPin}</strong>`), 'Without the option every pin is listed');
    await db.mapPins.update(HARBOUR, { position: { x: 20, y: 50 } });
    await db.worldMaps.update(M, { exploration: { ...exp0, enabled: false } });
    assert(plain(await buildWith({ exploredFog: true })) === withoutRecord, 'A map whose fog is switched off exports whole even with the option');
    await db.worldMaps.update(M, { exploration: { ...exp0, enabled: true } });
    const bridgeExport = await runBridgeTool('wh_wiki_export', { projectId: P, exploredFog: true, locale: 'en' });
    assert(bridgeExport.ok && String((bridgeExport.result as { html: string }).html).includes('data-map-fog'), `wh_wiki_export honours exploredFog: ${JSON.stringify(bridgeExport).slice(0, 200)}`);
    let refused = false; try { validateWikiOptions({ exploredFog: 'yes' }); } catch { refused = true; }
    validateWikiOptions({ exploredFog: true });
    assert(refused, 'exploredFog must be a boolean');
    assert(JSON.stringify(BRIDGE_TOOLS.find(tool => tool.name === 'wh_wiki_profile_save')!.schema).includes('exploredFog'), 'Wiki profiles can save the option through the bridge');
    await act(async () => { root.render(<MemoryRouter><WikiExportControl projectId={P} entries={[]} /></MemoryRouter>); await pause(400); });
    await until('export panel', () => has('wiki-explored-fog'));
    assert(!node<HTMLInputElement>('wiki-explored-fog').checked, 'The export panel offers "With exploration fog", off by default');
    await act(async () => { root.render(<></>); await pause(60); });
    passed.push('Wiki/Reader export: byte-identical by default and with exploredFog:false; with the option fog, party and trail are drawn and unexplored pins leave the page; fog off exports whole; option validated, in profiles, bridge export and the export panel');
    return passed;
  } finally {
    await act(async () => { root.render(<></>); await pause(60); });
    style.remove();
    for (const id of [P, Q, ...cleanup]) { try { await deleteProject(id); } catch { /* already gone */ } }
    await db.worldMaps.where('projectId').anyOf([P, Q, ...cleanup]).delete().catch(() => undefined);
  }
}
