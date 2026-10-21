import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { defaultWorldCalendar } from '@/engines/timeline/worldCalendar';
import { saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';

async function prepare() {
  const projectId = 'eras-transport';
  await db.projects.put({ id: projectId, title: 'Synthetic map eras QA', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['maps', 'timeline'], engineOrder: ['maps', 'timeline'], createdAt: 1, updatedAt: 1 });
  await saveWorldCalendar(projectId, defaultWorldCalendar('Reckoning'));
  await db.timelines.put({ id: 'eras-transport-lane', projectId, title: 'History', color: '#777777', createdAt: 1, updatedAt: 1 } as never);
  const event = (id: string, title: string, order: number, year: number) => ({ id: `eras-transport-${id}`, projectId, timelineId: 'eras-transport-lane', title, description: '', date: '', order, lane: 'Main', color: '#777777', createdAt: 1, updatedAt: 1, worldDate: { year } });
  await db.timelineEvents.bulkPut([event('war', 'Border war', 0, 350), event('founding', 'Founding', 1, 100)] as never);
  await db.worldMaps.put({ id: 'eras-transport-map', projectId, title: 'Native eras map', features: [], createdAt: 1, updatedAt: 1 } as never);
  (window as unknown as { __erasRow: () => Promise<unknown> }).__erasRow = async () => ((await db.worldMaps.get('eras-transport-map'))?.versions ?? []).map(version => ({ id: version.id, name: version.name, event: version.timelineEventId ?? null, date: version.date }));
  (window as unknown as { __transportReady: boolean }).__transportReady = true;
}
void prepare();
