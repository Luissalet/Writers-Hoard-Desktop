import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';

async function prepare() {
  await db.projects.put({ id: 'look-transport', title: 'Synthetic look QA', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  await db.generatedWorlds.put({ id: 'look-transport-world', projectId: 'look-transport', title: 'Native look planet', params: { ...DEFAULT_PARAMS, width: 128, seed: 'native-look' }, edits: '[]', createdAt: 1, updatedAt: 1 });
  const params = { ...DEFAULT_PARAMS, width: 128, seed: 'native-look' };
  await saveSnapshot('look-transport-world', paramsKey(params), generateWorld(params));
  (window as unknown as { __lookRow: () => Promise<unknown> }).__lookRow = async () => { const row = await db.generatedWorlds.get('look-transport-world'); return { presentation: row?.presentation ?? null, revision: row?.presentationRevision ?? 0 }; };
  (window as unknown as { __lookTouch: () => Promise<unknown> }).__lookTouch = async () => { const { saveWorldPresentation } = await import('@/engines/worldgen/presentation'); return saveWorldPresentation({ projectId: 'look-transport' }, 'look-transport-world', { skin3D: 'arcilla' }); };
  (window as unknown as { __transportReady: boolean }).__transportReady = true;
}
void prepare();
