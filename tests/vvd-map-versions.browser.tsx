import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import MapsEngine from '@/engines/maps/MapsEngine';
import '@/engines/maps';
import { getAllBackupStrategies, preloadArchive } from '@/engines/_shared/backupRegistry';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { captureMapVersion, updateMapVersion, restoreMapVersion } from '@/engines/maps/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { flushPendingWrites } from '@/services/pendingWrites';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
function typeInto(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export async function testVvdMapVersions(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host), P = `vvd-versions-${Date.now()}`, M = `${P}-map`, F = `${P}-region`, PIN = `${P}-pin`;
  const passed: string[] = []; useLocaleStore.setState({ locale: 'en' });
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = host.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (id: string) => act(async () => { node<HTMLElement>(id).click(); await pause(160); });
  const waitFor = async (message: string, test: () => boolean) => { for (let i = 0; i < 100; i++) { if (test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const confirm = async () => act(async () => { const dialog = document.querySelector('[role="dialog"]'); assert(dialog, 'Missing confirmation'); const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]; buttons[buttons.length - 1].click(); await pause(180); });
  const saved = async () => (await db.worldMaps.get(M))!;
  const mapPins = async () => db.mapPins.where('mapId').equals(M).toArray();
  const render = async (key = 'first') => {
    await act(async () => { root.render(<StrictMode><MemoryRouter key={key} initialEntries={[`/project/${P}/maps?map=${M}`]}><MapsEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(150); });
    await waitFor('Map did not mount', () => !!host.querySelector('[data-testid="map-tool-region"]'));
  };
  try {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#375559'; ctx.fillRect(0, 0, 600, 400); const oldBackground = canvas.toDataURL(); ctx.fillStyle = '#685547'; ctx.fillRect(0, 0, 600, 400); const newBackground = canvas.toDataURL();
    await db.worldMaps.put({ id: M, projectId: P, title: 'Changing borders', backgroundImage: oldBackground, features: [{ id: F, kind: 'region', name: 'Old border', color: '#d5b575', points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 70 }] }], createdAt: 1, updatedAt: 1 });
    await db.mapPins.put({ id: PIN, projectId: P, mapId: M, name: 'Old city', icon: 'city', position: { x: 20, y: 30 } });
    await render();
    await act(async () => { node('map-named-layers').querySelector('summary')!.click(); typeInto(node<HTMLInputElement>('map-new-layer-name'), 'Political borders'); });
    await click('map-new-layer-create');
    let layer = (await saved()).layers![0]; assert(layer.name === 'Political borders', 'Custom layer created');
    await click(`map-feature-select-${F}`);
    await act(async () => { typeInto(node<HTMLSelectElement>('map-feature-layer'), layer.id); }); await click('map-feature-save');
    const pinButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Old city'); assert(pinButton, 'Pin selection');
    await act(async () => { pinButton.click(); await pause(); });
    await act(async () => { typeInto(node<HTMLSelectElement>('map-pin-layer'), layer.id); });
    await click('map-pin-save');
    assert((await mapPins())[0].layerId === layer.id && (await saved()).features![0].layerId === layer.id, 'Both pin and polygon assigned to named layer');
    await click(`map-named-layer-${layer.id}`);
    assert(!host.querySelector(`[data-feature-id="${F}"]`) && !host.querySelector(`[data-map-pin-id="${PIN}"]`), 'Custom hidden layer hides both kinds without deletion');
    await click(`map-named-layer-${layer.id}`);
    await render('reopened');
    assert((await saved()).layers![0].visible && (await mapPins())[0].layerId === layer.id, 'Named layers and membership survive reopening');
    passed.push('Named layers: create, assign polygons and legacy pins, combine visibility and reopen without loss');

    await click('map-version-new');
    await act(async () => { typeInto(node<HTMLInputElement>('map-version-name'), 'Before the flood'); typeInto(node<HTMLInputElement>('map-version-date'), 'Year 90'); });
    await click('map-version-capture');
    let version = (await saved()).versions![0];
    assert(version.name === 'Before the flood' && version.date === 'Year 90' && version.backgroundImage === oldBackground && version.pins[0].layerId === layer.id && version.features[0].layerId === layer.id && version.layers![0].name === layer.name, 'UI captures complete saved world state');
    await act(async () => {
      await db.worldMaps.update(M, { backgroundImage: newBackground, features: [{ ...(await saved()).features![0], name: 'New border', points: [{ x: 15, y: 15 }, { x: 60, y: 15 }, { x: 60, y: 80 }] }] });
      await db.mapPins.update(PIN, { name: 'New city', position: { x: 60, y: 60 } });
      await db.mapPins.add({ id: `${P}-extra`, mapId: M, projectId: P, name: 'New settlement', icon: 'village', position: { x: 75, y: 80 } });
      notifyDataChanged({ source: 'other', projectId: P }); await pause(160);
    });
    const current = await saved(), currentPins = await mapPins();
    await act(async () => { typeInto(node<HTMLSelectElement>('map-version-select'), version.id); await pause(100); });
    assert(!host.querySelector('[data-testid="map-tool-region"]') && !host.querySelector('[data-testid="map-feature-save"]') && !host.querySelector('[data-testid="map-pin-layer"]'), 'History exposes no map mutation controls');
    assert(host.querySelector('img')?.getAttribute('src') === oldBackground && host.textContent?.includes('Old border') && !host.textContent?.includes('New border'), 'History previews old background and shapes');
    assert(host.querySelectorAll('[data-map-pin-id]').length === 1 && host.querySelector(`[data-map-pin-id="${PIN}"]`)?.getAttribute('style')?.includes('20%'), 'History previews old city positions');
    await click(`map-feature-select-${F}`);
    assert(!host.querySelector('[data-testid="map-vertex-0"]') && !host.querySelector('[data-testid="map-feature-name"]'), 'Historical selection remains read-only');
    assert(JSON.stringify((await saved()).features) === JSON.stringify(current.features) && JSON.stringify(await mapPins()) === JSON.stringify(currentPins), 'Preview and selection do not write live map or markers');
    await click('map-version-current');
    await waitFor('Current editing controls did not return', () => !!host.querySelector('[data-testid="map-tool-region"]'));
    passed.push('Eras: full background/vector/layer/marker snapshots preview read-only without polluting the current map');

    // A dirty geometry draft must survive preview navigation, reopening and a rejected save.
    await click(`map-feature-select-${F}`);
    await act(async () => { typeInto(node<HTMLInputElement>('map-feature-name'), 'Recovered draft'); });
    await flushPendingWrites();
    await render('draft-reopen'); await click(`map-feature-select-${F}`);
    assert(node<HTMLInputElement>('map-feature-name').value === 'Recovered draft', 'Feature recovery survives engine unmount/remount');
    await act(async () => { typeInto(node<HTMLSelectElement>('map-version-select'), version.id); await pause(); });
    await click(`map-feature-select-${F}`);
    assert(host.textContent?.includes('Old border') && !host.textContent?.includes('Recovered draft'), 'A live draft cannot contaminate historical preview');
    await click('map-version-current'); await click(`map-feature-select-${F}`);
    assert(node<HTMLInputElement>('map-feature-name').value === 'Recovered draft', 'Returning from history retains live draft');
    passed.push('Durable vector drafts survive navigation and remain isolated from historical read-only states');

    await act(async () => { typeInto(node<HTMLSelectElement>('map-version-select'), version.id); await pause(); });
    await click('map-version-restore');
    const reject = () => { throw new Error('Expected restore failure'); };
    db.worldMaps.hook('updating', reject);
    await confirm();
    db.worldMaps.hook('updating').unsubscribe(reject);
    assert((await saved()).backgroundImage === newBackground && JSON.stringify(await mapPins()) === JSON.stringify(currentPins), 'Failed restore rolls back marker deletion/insertion and background');
    assert(document.querySelector('[role="dialog"]'), 'Failed restore stays available to retry explicitly');
    await confirm();
    await waitFor('Restore did not return to current map', () => !!host.querySelector('[data-testid="map-tool-region"]'));
    assert((await saved()).backgroundImage === oldBackground && (await saved()).features![0].name === 'Old border' && (await mapPins()).length === 1 && (await mapPins())[0].position.x === 20, 'Full restore replaces live background, shape geometry and all markers');
    const recovery = (await saved()).versions!.find(item => item.id !== version.id)!;
    assert(recovery.backgroundImage === newBackground && recovery.features[0].name === 'New border' && recovery.pins.length === 2, 'Restore preserves displaced present as automatic safety snapshot');
    await act(async () => { await restoreMapVersion(M, recovery.id, 'Safety before recovering'); await pause(160); });
    assert((await saved()).backgroundImage === newBackground && (await mapPins()).length === 2, 'Safety snapshot restores displaced present');
    passed.push('Restore: explicit confirmation, atomic rollback on failure, full restore and recoverable displaced present');

    await act(async () => { await updateMapVersion(M, version.id, { name: 'Ancient border', date: 'Age 1', description: 'Before the river changed.' }); await pause(100); });
    version = (await saved()).versions!.find(item => item.id === version.id)!;
    assert(version.name === 'Ancient border' && version.date === 'Age 1' && version.features[0].name === 'Old border', 'Era metadata edits preserve captured geometry');
    await act(async () => { typeInto(node<HTMLInputElement>('map-version-scrubber'), '0'); await pause(100); });
    assert(!host.querySelector('[data-testid="map-tool-region"]') && host.textContent?.includes('Age 1'), 'Scrubber reaches dated read-only era');
    await click('map-version-delete'); await confirm();
    assert(!(await saved()).versions!.some(item => item.id === version.id) && (await saved()).features![0].name === 'New border', 'Deleting era never mutates live content');
    passed.push('Era metadata, timeline scrubber and deletion preserve independent current and historical states');

    const strategy = getAllBackupStrategies().find(item => item.engineId === 'maps')!, zip = new JSZip(), projectDir = `projects/${P}`;
    const beforeArchive = await saved(); await strategy.exportProject({ zip, projectId: P, projectDir }); await preloadArchive(zip);
    await act(async () => { root.render(null); });
    await db.worldMaps.delete(M); await db.mapPins.where('projectId').equals(P).delete(); await strategy.importProject({ zip, projectId: P, projectDir });
    assert(JSON.stringify((await saved()).versions) === JSON.stringify(beforeArchive.versions) && JSON.stringify((await saved()).layers) === JSON.stringify(beforeArchive.layers), 'ZIP roundtrip retains full snapshot backgrounds/geometry/pins/groups');
    passed.push('ZIP map archives roundtrip named layers and full historical snapshots without schema migration');

    const conflictVersionId = await captureMapVersion(M, { name: 'Conflict fixture', date: '' });
    await db.mapPins.delete(PIN);
    await db.mapPins.put({ id: PIN, projectId: `${P}-foreign`, mapId: `${M}-foreign`, name: 'Foreign owner', icon: 'city', position: { x: 1, y: 1 } });
    await restoreMapVersion(M, conflictVersionId, 'Before conflict restore');
    assert((await db.mapPins.get(PIN))?.name === 'Foreign owner' && (await mapPins()).some(pin => pin.name === 'New city' && pin.id !== PIN && pin.projectId === P && pin.mapId === M), 'Restore remaps colliding pin IDs and never overwrites another map');
    passed.push('Restore ownership: colliding archived marker IDs are regenerated without altering other maps');
    return passed;
  } finally {
    await act(async () => { root.unmount(); });
    await db.worldMaps.where('projectId').equals(P).delete(); await db.mapPins.where('projectId').equals(P).delete(); await db.mapPins.where('projectId').equals(`${P}-foreign`).delete();
    localStorage.removeItem(`wh.map-features-drafts.v1.${P}`); localStorage.removeItem(`wh.maps-drafts.v1.${P}`);
  }
}
