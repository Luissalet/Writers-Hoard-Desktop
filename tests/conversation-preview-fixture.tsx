import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import DialogSceneEngine from '@/engines/dialog-scene/components/DialogSceneEngine';
import type { DialogBlock } from '@/engines/dialog-scene/types';
import '@/engines/dialog-scene';
import '@/index.css';

async function preview() {
  useLocaleStore.setState({ locale: 'es' }); const projectId = 'conversation-preview-project', sceneId = 'conversation-preview-scene';
  await db.projects.put({ id: projectId, title: 'Las Tierras del Estuario', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['dialog-scene'], engineOrder: ['dialog-scene'], createdAt: 1, updatedAt: 1 });
  await db.scenes.put({ id: sceneId, projectId, title: 'La última carta', setting: 'Puerto del Viento · Amanecer', order: 0, sceneNumber: 1, tags: ['Estuario'], createdAt: 1, updatedAt: 1 });
  await db.sceneCasts.bulkPut([{ id: 'nora-cast', sceneId, characterId: 'nora', characterName: 'Nora', color: '#4a9e6d' }, { id: 'eneas-cast', sceneId, characterId: 'eneas', characterName: 'Eneas', color: '#628fd4' }]);
  const block = (id: string, order: number, type: DialogBlock['type'], content: string, characterName = '', extra: Partial<DialogBlock> = {}): DialogBlock => ({ id, projectId, sceneId, type, content, order, characterName, characterId: characterName ? characterName.toLowerCase() : undefined, characterColor: characterName === 'Nora' ? '#4a9e6d' : '#628fd4', createdAt: 1, updatedAt: 1, ...extra });
  await db.dialogBlocks.bulkPut([
    block('first-light', 0, 'action', 'La primera luz se refleja en las ventanas del puerto. Nora despliega un mapa sobre la mesa.'),
    block('border', 1, 'dialog', 'La frontera se ha movido durante la noche.', 'Nora', { parenthetical: 'en voz baja' }),
    block('impossible', 2, 'dialog', 'Eso no es posible. La dibujamos ayer.', 'Eneas'),
    block('look', 3, 'dialog', 'Mira el río. Ahora pasa al otro lado de la ciudad.', 'Nora'),
    block('promise-a', 4, 'dialog', 'Prometimos llegar antes de la tormenta.', 'Eneas', { dualGroupId: 'promise' }),
    block('promise-b', 5, 'dialog', 'Entonces tendremos que encontrar otro camino.', 'Nora', { dualGroupId: 'promise' }),
    block('silence', 6, 'stage-direction', 'Guardan silencio. Se escucha una campana a lo lejos.'),
    block('note', 7, 'note', 'Revisar la relación entre la carta y la promesa en el siguiente borrador.'),
  ]);
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/dialog-scene?entity=${sceneId}`]}><main className="h-screen bg-deep text-text-primary"><DialogSceneEngine projectId={projectId} /></main></MemoryRouter>);
}
void preview().catch(error => { (window as unknown as { __conversationError: string }).__conversationError = String(error); });
