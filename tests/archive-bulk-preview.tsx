import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import ArchiveEngine from '@/engines/archive/ArchiveEngine';
import { deleteWriting } from '@/engines/writings/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import type { Writing } from '@/types';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import archiveEs from '@/engines/archive/locales/es';
import archiveEn from '@/engines/archive/locales/en';
import '@/index.css';

// The engine registers its strings in its index; this preview mounts the view alone.
registerLocaleStrings({ es: archiveEs, en: archiveEn });

const P = 'archive-bulk-preview';
type Window = typeof window & { __arcError?: string; __arcReady?: boolean };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Archivo', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['writings', 'archive'], createdAt: 1, updatedAt: 1 });
  for (const [i, title] of ['Prólogo', 'La tormenta', 'Epílogo'].entries()) {
    await db.writings.put({ id: `arc${i}`, projectId: P, title, status: 'draft', content: `<p>${title}.</p>`, wordCount: 1, tags: [], chapter: i + 1, createdAt: 1, updatedAt: 1 } satisfies Writing);
    await deleteWriting(`arc${i}`);
  }
  createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="h-screen overflow-auto bg-deep p-4 text-text-primary"><ArchiveEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__arcReady = true;
}
void preview().catch(error => { host.__arcError = String(error?.stack ?? error); });
