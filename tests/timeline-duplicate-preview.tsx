import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import type { Timeline, TimelineEvent } from '@/types';
import '@/index.css';

const P = 'timeline-duplicate-preview', T = 'timeline-duplicate-preview-t';
type Window = typeof window & { __tlError?: string; __tlReady?: boolean };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Crónica', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 });
  await db.timelines.put({ id: T, projectId: P, title: 'Crónica', description: '', color: '#aa5533', order: 0, createdAt: 1, updatedAt: 1 } as Timeline);
  for (const [i, title] of ['La partida', 'La batalla', 'El regreso'].entries()) await db.timelineEvents.put({ id: `ev${i}`, projectId: P, timelineId: T, title, description: '', date: `Año ${i + 1}`, dateMode: 'text', eventType: 'point', order: i, lane: '', color: '#aa5533', createdAt: 1, updatedAt: 1 } satisfies TimelineEvent);
  createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="h-screen overflow-auto bg-deep p-4 text-text-primary"><TimelineEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__tlReady = true;
}
void preview().catch(error => { host.__tlError = String(error?.stack ?? error); });
