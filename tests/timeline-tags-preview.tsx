import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import type { Timeline, TimelineEvent } from '@/types';
import '@/index.css';

const P = 'timeline-tags-preview', T = 'timeline-tags-preview-t';
type Window = typeof window & { __ttError?: string; __ttReady?: boolean };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  if (!(await db.projects.get(P))) {
    await db.projects.put({ id: P, title: 'Crónica del norte', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['timeline', 'codex'], engineOrder: ['timeline'], createdAt: 1, updatedAt: 1 });
    await db.timelines.put({ id: T, projectId: P, title: 'Las guerras del norte', description: '', color: '#aa5533', createdAt: 1, updatedAt: 1 } as Timeline);
    const rows: Array<[string, string, string[], TimelineEvent['eventType']]> = [['La partida', 'Año 1', [], 'point'], ['La batalla del vado', 'Año 2', ['batalla', 'guerra'], 'milestone'], ['La profecía', 'Año 3', ['profecía'], 'point'], ['El asedio', 'Año 4', ['Guerra'], 'range'], ['El regreso', 'Año 5', [], 'point']];
    for (const [i, [title, date, tags, eventType]] of rows.entries()) await db.timelineEvents.put({ id: `ev${i}`, projectId: P, timelineId: T, title, description: '', date, dateMode: 'text', eventType, order: i, lane: '', color: '#aa5533', ...(tags.length ? { tags } : {}), createdAt: 1, updatedAt: 1 } satisfies TimelineEvent);
  }
  createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="h-screen overflow-auto bg-deep p-4 text-text-primary"><TimelineEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__ttReady = true;
}
void preview().catch(error => { host.__ttError = String(error?.stack ?? error); });
