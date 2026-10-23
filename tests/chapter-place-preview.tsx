import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import type { Writing } from '@/types';
import '@/index.css';

const P = 'chapter-place-preview';
type Window = typeof window & { __chapError?: string; __chapReady?: boolean };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'La travesía', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 });
  const titles = ['El puerto', 'La tormenta', 'La isla', 'El regreso'];
  for (const [i, title] of titles.entries()) await db.writings.put({ id: `ch${i + 1}`, projectId: P, title, status: 'draft', content: `<p>${title}.</p>`, wordCount: 2, tags: [], chapter: i + 1, createdAt: 1, updatedAt: 1 } satisfies Writing);
  createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="h-screen overflow-auto bg-deep p-4 text-text-primary"><WritingsEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__chapReady = true;
}
void preview().catch(error => { host.__chapError = String(error?.stack ?? error); });
