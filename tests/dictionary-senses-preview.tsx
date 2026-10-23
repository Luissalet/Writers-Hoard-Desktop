import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import '@/index.css';

const P = 'dictionary-senses-preview';
type Window = typeof window & { __dictError?: string; __dictReady?: boolean; __dictId?: string };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Las Tierras del Estuario', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['dictionary', 'codex'], createdAt: 1, updatedAt: 1 });
  const created = await runBridgeTool('wh_dictionary_create', { projectId: P, name: 'Lúmico', description: 'Lengua del litoral' });
  if (!created.ok) throw Error(created.error);
  const { dictionary, version } = created.result as { dictionary: { id: string }; version: string };
  const saved = await runBridgeTool('wh_dictionary_save_word', { projectId: P, dictionaryId: dictionary.id, expectedVersion: version, word: { word: 'mor', meaning: 'mar' } });
  if (!saved.ok) throw Error(saved.error);
  host.__dictId = dictionary.id;
  createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="h-screen bg-deep text-text-primary"><DictionaryEngine projectId={P} /><ToastHost /></div></MemoryRouter>);
  host.__dictReady = true;
}
void preview().catch(error => { host.__dictError = String(error?.stack ?? error); });
