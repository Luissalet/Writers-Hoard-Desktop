import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import { emptyWord } from '@/engines/dictionary/types';
import { useLocaleStore } from '@/stores/localeStore';
import '@/index.css';

async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  const projectId = 'dictionary-script-preview';
  await db.projects.put({ id: projectId, title: 'Las Tierras del Estuario', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['dictionary'], engineOrder: ['dictionary'], createdAt: 1, updatedAt: 1, dictionaries: [{ id: 'estuario', name: 'Lengua del estuario', description: 'El idioma de los navegantes y los pueblos de la costa.', scriptMapping: '', detectInManuscript: true, words: [{ ...emptyWord(), word: 'Shara', meaning: 'La primera luz que aparece sobre el agua antes del amanecer.' }] }] });
  createRoot(document.getElementById('root')!).render(<MemoryRouter><main className="h-screen bg-deep text-text-primary"><DictionaryEngine projectId={projectId} /></main></MemoryRouter>);
  for (let i = 0; i < 100; i++) {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Configurar idioma"]');
    if (button) { button.click(); return; } await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Language settings did not mount');
}
void preview().catch(error => { (window as unknown as { __scriptError: string }).__scriptError = String(error); });
