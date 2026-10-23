import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import type { Timeline, TimelineEvent } from '@/types';
import '@/index.css';

const P = 'timeline-calendar-preview', T = 'timeline-calendar-preview-t';
type Window = typeof window & { __tcError?: string; __tcReady?: boolean };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  if (!(await db.projects.get(P))) {
    await db.projects.put({ id: P, title: 'Diario del puerto', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['timeline'], engineOrder: ['timeline'], createdAt: 1, updatedAt: 1 });
    await db.timelines.put({ id: T, projectId: P, title: 'Otoño', description: '', color: '#3d85c6', createdAt: 1, updatedAt: 1 } as Timeline);
    const rows: Array<[string, string, string | undefined, string]> = [['Llega el barco', '2026-10-03', undefined, '#3d85c6'], ['La tormenta', '2026-10-21', '2026-10-23', '#c0504d'], ['El juicio', '2026-11-12', undefined, '#6aa84f']];
    for (const [i, [title, realDate, realDateEnd, color]] of rows.entries()) await db.timelineEvents.put({ id: `tc${i}`, projectId: P, timelineId: T, title, description: '', date: realDate, dateMode: 'calendar', realDate, ...(realDateEnd ? { realDateEnd } : {}), eventType: realDateEnd ? 'range' : 'point', order: i, lane: '', color, createdAt: 1, updatedAt: 1 } satisfies TimelineEvent);
  }
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/x?view=calendar']}><div className="h-screen overflow-auto bg-deep p-4 text-text-primary"><TimelineEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__tcReady = true;
}
void preview().catch(error => { host.__tcError = String(error?.stack ?? error); });
