import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import MapsEngine from '@/engines/maps/MapsEngine';
import '@/engines/maps';
import { getAllBackupStrategies, preloadArchive } from '@/engines/_shared/backupRegistry';
import { exportMapSvg, mapPoint } from '@/components/maps/mapGeometry';
import { useLocaleStore } from '@/stores/localeStore';
import type { MapFeature } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function Location() { const location = useLocation(); return <output data-testid="map-location">{location.pathname}{location.search}</output>; }
function typeInto(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export async function testVvdMaps(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host);
  const P = `vvd-map-${Date.now()}`, M = `${P}-map`, E = `${P}-entry`;
  const passed: string[] = [];
  const style = document.createElement('style');
  style.textContent = '.relative.inline-block{position:relative;display:inline-block}.absolute.inset-0{position:absolute;inset:0;width:100%;height:100%}';
  document.head.append(style);
  useLocaleStore.setState({ locale: 'en' });
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = host.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (id: string) => act(async () => { node<HTMLElement>(id).click(); await pause(100); });
  const waitFor = async (message: string, test: () => boolean) => {
    for (let i = 0; i < 100; i++) { if (test()) return; await act(async () => { await pause(); }); }
    throw new Error(message);
  };
  const draw = async (kind: MapFeature['kind'], points: [number, number][]) => {
    await click(`map-tool-${kind}`);
    for (const [x, y] of points) await act(async () => {
      const svg = node<SVGSVGElement>('map-feature-canvas'), rect = svg.getBoundingClientRect();
      assert(rect.width && rect.height, 'Map is visible');
      svg.dispatchEvent(new MouseEvent('click', { clientX: rect.left + rect.width * x / 100, clientY: rect.top + rect.height * y / 100, bubbles: true }));
      await pause(60);
    });
    if (kind !== 'label') await click('map-feature-finish');
  };
  const saved = async () => (await db.worldMaps.get(M))!;
  const rename = async (name: string) => { await act(async () => { typeInto(node<HTMLInputElement>('map-feature-name'), name); }); await click('map-feature-save'); };
  const render = async (key = 'first', query = `map=${M}`) => {
    await act(async () => { root.render(<StrictMode><MemoryRouter key={key} initialEntries={[`/project/${P}/maps?${query}`]}><MapsEngine projectId={P} /><Location /></MemoryRouter></StrictMode>); await pause(120); });
    await waitFor('Map did not mount', () => !!host.querySelector('[data-testid="map-feature-canvas"]'));
  };
  try {
    await db.projects.bulkAdd([P, `${P}-foreign`].map(id => ({ id, title: 'Map fixture', type: 'standalone' as const, mode: 'custom' as const, color: '#cab57d', description: '', status: 'draft' as const, enabledEngines: ['maps'], engineOrder: ['maps'], createdAt: 1, updatedAt: 1 })));
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
    const context = canvas.getContext('2d')!; context.fillStyle = '#3b5557'; context.fillRect(0, 0, 800, 480); context.fillStyle = '#8d956b'; context.beginPath(); context.ellipse(400, 240, 320, 180, -.1, 0, 2 * Math.PI); context.fill();
    await db.worldMaps.put({ id: M, projectId: P, title: 'Local atlas', backgroundImage: canvas.toDataURL(), createdAt: 1, updatedAt: 1 });
    await db.mapPins.put({ id: `${P}-pin`, projectId: P, mapId: M, name: 'Old harbour', icon: 'port', position: { x: 60, y: 55 } });
    await db.codexEntries.put({ id: E, projectId: P, type: 'location', title: 'Northern province', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await render();
    assert(!(await saved()).features, 'Legacy map starts without a feature migration');
    await click('map-tool-region');
    assert(node<HTMLButtonElement>('map-feature-finish').disabled, 'Incomplete polygon cannot save');
    await draw('region', [[15, 20], [55, 15], [50, 65], [20, 70]]);
    let region = (await saved()).features![0];
    assert(region.kind === 'region' && region.points.length === 4 && Math.abs(region.points[0].x - 15) < .2, 'Polygon persists in image percentages');
    await act(async () => { typeInto(node<HTMLInputElement>('map-feature-name'), 'Northern <province>'); typeInto(node<HTMLSelectElement>('map-feature-link'), E); });
    await click('map-feature-save');
    region = (await saved()).features![0];
    assert(region.name === 'Northern <province>' && region.linkedEntryId === E, 'Metadata and Codex link persisted');
    await act(async () => {
      const coordinate = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')][0];
      typeInto(coordinate, '120');
    });
    await click('map-feature-save');
    assert((await saved()).features![0].points[0].x === 100, 'Vertex edits clamp to image bounds');
    passed.push('Regions: draw/finish, metadata, Codex links and bounded vertex editing save to IndexedDB');

    await draw('path', [[30, 55], [45, 35], [70, 40]]); await rename('Coastal road');
    await draw('label', [[70, 25]]); await rename('Eastern sea');
    assert((await saved()).features!.map(feature => feature.kind).join() === 'region,path,label', 'All three feature types are saved');
    await click('map-layer-region');
    assert((await saved()).layerVisibility?.region === false && !host.querySelector(`[data-feature-id="${region.id}"]`), 'Hidden regions leave the canvas but remain saved');
    await click('map-layer-pins');
    assert((await saved()).layerVisibility?.pins === false && await db.mapPins.count() === 1, 'Hiding pins does not delete legacy pins');
    await render('reopen');
    assert((await saved()).features!.length === 3 && !node<HTMLInputElement>('map-layer-region').checked && !node<HTMLInputElement>('map-layer-pins').checked, 'Reopening retains geometry and visibility');
    await click('map-layer-region');
    passed.push('Routes, labels and all visibility layers survive engine reopening; existing pins remain intact');

    const label = (await saved()).features!.find(feature => feature.kind === 'label')!;
    await click(`map-feature-select-${label.id}`);
    const reject = () => { throw new Error('Expected map write rejection'); };
    db.worldMaps.hook('updating', reject);
    await act(async () => { typeInto(node<HTMLInputElement>('map-feature-name'), 'Recovered label'); });
    await click('map-feature-save');
    db.worldMaps.hook('updating').unsubscribe(reject);
    assert(node<HTMLInputElement>('map-feature-name').value === 'Recovered label' && host.querySelector('[role="alert"]'), 'Failed write keeps the edit and explains retry');
    assert((await saved()).features!.find(feature => feature.id === label.id)?.name === 'Eastern sea', 'Failure did not claim a successful save');
    await click('map-feature-save');
    assert((await saved()).features!.find(feature => feature.id === label.id)?.name === 'Recovered label', 'Explicit retry saves retained draft');
    await click('map-feature-undo');
    assert((await saved()).features!.find(feature => feature.id === label.id)?.name === 'Eastern sea', 'Undo persists previous geometry state');
    await click('map-feature-redo');
    assert((await saved()).features!.find(feature => feature.id === label.id)?.name === 'Recovered label', 'Redo persists next geometry state');
    passed.push('Failed writes preserve editable drafts; retry, undo and redo persist the intended vector state');

    await click(`map-feature-select-${region.id}`);
    const open = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('Open entry:'));
    assert(open, 'Linked region has a real Codex navigation button');
    await act(async () => { open.click(); });
    assert(node('map-location').textContent?.includes(`/codex?entry=${E}`), 'Region opens its linked Codex entry');
    const current = await saved();
    const svg = exportMapSvg(current.backgroundImage!, 800, 480, current.features!, await db.mapPins.toArray(), current.layerVisibility!);
    assert(svg.includes('Northern &lt;province&gt;') && svg.includes('<polygon') && svg.includes('<polyline') && svg.includes('data:image/png'), 'SVG contains escaped text, all visible vector geometry and embedded background');
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml'); assert(!xml.querySelector('parsererror'), 'SVG is well-formed XML');
    assert(mapPoint(-5, Infinity).x === 0 && mapPoint(-5, Infinity).y === 0, 'Invalid coordinates cannot escape the map');
    passed.push('Linked entry navigation works; standalone SVG embeds the background and safely exports visible vectors');

    await click(`map-feature-select-${region.id}`);
    await act(async () => { const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Delete shape'); assert(remove, 'Delete shape button'); remove.click(); await pause(); });
    await act(async () => { const dialog = document.querySelector('[role="dialog"]'); assert(dialog, 'Deletion requires confirmation'); const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]; buttons[buttons.length - 1].click(); await pause(120); });
    assert(!(await saved()).features!.some(feature => feature.id === region.id) && await db.mapPins.get(`${P}-pin`), 'Deleting a shape removes only that vector');
    await click('map-feature-undo');
    assert((await saved()).features!.some(feature => feature.id === region.id), 'Undo restores deleted vector with metadata');
    passed.push('Shape deletion requires confirmation, preserves pins and can be undone');

    const strategy = getAllBackupStrategies().find(strategy => strategy.engineId === 'maps')!;
    const zip = new JSZip(); const projectDir = `projects/${P}`;
    await strategy.exportProject({ zip, projectId: P, projectDir });
    await preloadArchive(zip);
    await act(async () => { root.render(null); });
    await db.worldMaps.delete(M); await db.mapPins.where('projectId').equals(P).delete();
    await strategy.importProject({ zip, projectId: P, projectDir });
    assert(JSON.stringify((await saved()).features) === JSON.stringify(current.features) && JSON.stringify((await saved()).layerVisibility) === JSON.stringify(current.layerVisibility), 'Archive roundtrip preserves feature metadata and layers');
    assert(await db.mapPins.get(`${P}-pin`), 'Archive roundtrip preserves legacy pin');
    passed.push('Existing map ZIP backup/restore roundtrip retains polygons, routes, labels, layers, links and legacy pins');
    await db.worldMaps.put({ id: `${M}-foreign`, projectId: `${P}-foreign`, title: 'Foreign map', backgroundImage: current.backgroundImage, createdAt: 1, updatedAt: 1 });
    await db.mapPins.put({ id: `${P}-foreign-pin`, projectId: `${P}-foreign`, mapId: `${M}-foreign`, name: 'Foreign marker', icon: 'city', position: { x: 1, y: 1 } });
    await render('foreign-pin-deep-link', `pin=${P}-foreign-pin`);
    assert(!host.querySelector(`[data-map-pin-id="${P}-foreign-pin"]`) && !host.textContent?.includes('Foreign marker'), 'A pin deep link cannot select another project’s map');
    await render('foreign-map-deep-link', `map=${M}-foreign`);
    assert(!host.querySelector(`[data-map-pin-id="${P}-foreign-pin"]`) && !host.textContent?.includes('Foreign marker'), 'A map deep link cannot select another project’s map');
    passed.push('Map and marker deep links enforce the active project scope');
    return passed;
  } finally {
    await act(async () => { root.unmount(); });
    await deleteProject(P);
    await deleteProject(`${P}-foreign`);
    style.remove();
  }
}
