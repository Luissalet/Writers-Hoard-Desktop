import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import MapsEngine from '@/engines/maps/MapsEngine';
import '@/engines/maps';
import { useLocaleStore } from '@/stores/localeStore';
import { captureMapVersion } from '@/engines/maps/operations';
import { defaultWorldCalendar } from '@/engines/timeline/worldCalendar';
import { saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import '@/index.css';

/** A map whose borders change across three dated moments of the world's timeline. */
const projectId = 'map-eras-preview', mapId = 'map-eras-preview-atlas', lane = 'map-eras-preview-lane';
type Shape = { x: number; y: number }[];
const border = (spread: number): Shape => [{ x: 20, y: 22 }, { x: 30 + spread, y: 18 }, { x: 34 + spread, y: 50 }, { x: 22, y: 56 }];
const w = window as unknown as Record<string, unknown>;
let root: Root | null = null;

function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(<MemoryRouter initialEntries={[`/project/${projectId}/maps?map=${mapId}`]}><main className="bg-deep text-text-primary min-h-screen p-6"><MapsEngine projectId={projectId} /></main></MemoryRouter>);
}
w.__erasMount = mount;
w.__erasUnmount = () => { root?.unmount(); root = null; };

async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: projectId, title: 'Las Marcas', type: 'standalone', mode: 'custom', color: '#cab57d', description: '', status: 'draft', enabledEngines: ['maps', 'timeline'], engineOrder: ['maps', 'timeline'], createdAt: 1, updatedAt: 1 } as never);
  const calendar = defaultWorldCalendar('Cómputo de las Marcas');
  calendar.eras = [{ name: 'Era de la Sal', abbr: 'ES', startYear: 1 }];
  await saveWorldCalendar(projectId, calendar);
  await db.timelines.put({ id: lane, projectId, title: 'Historia', color: '#777777', createdAt: 1, updatedAt: 1 } as never);
  const event = (id: string, title: string, order: number, year: number) => ({ id: `${projectId}-${id}`, projectId, timelineId: lane, title, description: '', date: '', order, lane: 'Main', color: '#777777', createdAt: 1, updatedAt: 1, worldDate: { year } });
  // Timeline order disagrees with the calendar on purpose.
  await db.timelineEvents.bulkPut([event('founding', 'Fundación de la Marca', 2, 120), event('war', 'Guerra de los Vados', 0, 410), event('flood', 'La gran riada', 1, 260)] as never);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 700;
  const context = canvas.getContext('2d')!; context.fillStyle = '#334c51'; context.fillRect(0, 0, 1200, 700);
  context.fillStyle = '#869078'; context.beginPath(); context.ellipse(560, 350, 470, 270, 0, 0, Math.PI * 2); context.fill();
  const feature = (spread: number, name: string) => [{ id: 'march', kind: 'region', name, color: '#d5b575', opacity: .25, points: border(spread) }];
  await db.worldMaps.put({ id: mapId, projectId, title: 'Las Marcas del Norte', backgroundImage: canvas.toDataURL(), source: 'uploaded', createdAt: 1, updatedAt: 1, features: feature(0, 'Marca fundacional') } as never);
  // Saved out of order: the war first, then the founding.
  await db.worldMaps.update(mapId, { features: feature(30, 'Marca tras la guerra') } as never);
  await captureMapVersion(mapId, { name: 'Tras la guerra', date: '', eventId: `${projectId}-war` });
  await db.worldMaps.update(mapId, { features: feature(0, 'Marca fundacional') } as never);
  await captureMapVersion(mapId, { name: 'La fundación', date: '', eventId: `${projectId}-founding` });
  await db.worldMaps.update(mapId, { features: feature(15, 'Marca tras la riada') } as never);
  mount();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (document.querySelector('[data-testid="map-version-history"]')) { w.__erasReady = true; return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Map preview did not mount');
}
preview().catch(error => { w.__erasError = String(error.stack || error); });
