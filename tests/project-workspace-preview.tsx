import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProjectDetail from '@/pages/ProjectDetail';
import Sidebar from '@/components/layout/Sidebar';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import { emptyWord } from '@/engines/dictionary/types';
import { presetMapping } from '@/engines/dictionary/scripts';
import '@/index.css';

async function preview() {
  const projectId = 'project-workspace-preview'; useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: projectId, title: 'Las Tierras del Estuario', description: 'Una novela de fronteras, cartas y mareas.', color: '#d5b575', type: 'standalone', mode: 'custom', status: 'in-progress', enabledEngines: ['writings', 'codex', 'maps', 'dictionary'], engineOrder: ['writings', 'codex', 'maps', 'dictionary'], createdAt: 1, updatedAt: 1, dictionaries: [{ id: 'estuary-language', name: 'Lengua del estuario', description: 'El idioma de los navegantes y los pueblos de la costa.', scriptMapping: presetMapping('tifinagh')!, detectInManuscript: true, words: [
    { ...emptyWord(), word: 'shara', meaning: 'La primera luz que aparece sobre el agua antes del amanecer.', pronunciation: 'ˈʃa.ɾa', partOfSpeech: 'sustantivo', examples: 'La shara vuelve doradas las velas del puerto.' },
    { ...emptyWord(), word: 'lum', meaning: 'Una promesa que debe cumplirse antes de zarpar.', partOfSpeech: 'sustantivo', derivatives: 'luma: prometer; lumara: quien cumple su promesa' },
  ] }] });
  await db.codexEntries.put({ id: 'nora', projectId, type: 'character', title: 'Nora Valdés', fields: { occupation: 'Cartógrafa' }, content: '<p>Dibuja las fronteras que otros prefieren olvidar.</p>', tags: ['Expedición'], relations: [], createdAt: 1, updatedAt: 1 });
  await db.writings.put({ id: 'chapter-estuary', projectId, title: 'La última carta', content: '<p>El puerto guardaba silencio cuando Nora Valdés desplegó la última carta sobre la mesa. La shara encendía los bordes del pergamino y hacía brillar la tinta azul de los ríos.</p><p>Al otro lado del estuario, las montañas parecían más cercanas que la noche anterior. Nora no recordaba haber dibujado aquella línea. Alguien había desplazado la frontera mientras todos dormían.</p><p>—Una lum no se rompe por una tormenta —dijo Eneas desde la puerta.</p><p>Ella guardó la carta en el abrigo. Si el camino había cambiado, tendrían que encontrar otro.</p>', status: 'draft', chapter: 1, synopsis: 'Nora descubre que la frontera de su mapa se ha movido durante la noche.', tags: ['Estuario'], wordCount: 108, createdAt: 1, updatedAt: 1 });
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/writings?writing=chapter-estuary`]}><Routes><Route path="/project/:id/:tab" element={<div className="flex h-screen min-w-0 bg-deep text-text-primary"><Sidebar /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><ProjectDetail /></main></div>} /></Routes></MemoryRouter>);
}
void preview().catch(error => { (window as unknown as { __workspaceError: string }).__workspaceError = String(error); });
