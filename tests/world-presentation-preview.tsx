import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import WorldgenEngine from '@/engines/worldgen/components/WorldgenEngine';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { saveWorldPresentation } from '@/engines/worldgen/presentation';
import { useLocaleStore } from '@/stores/localeStore';
import '@/index.css';

const P = 'world-presentation-preview', W = 'world-presentation-preview-world';
type Window = typeof window & { __lookError?: string; __lookReady?: boolean; __lookMount?: () => void; __lookUnmount?: () => void; __lookRow?: () => Promise<unknown>; __lookExternal?: (patch: unknown) => Promise<unknown> };
const host = window as Window;
let root: Root | null = null;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Las Tierras del Estuario', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  await db.generatedWorlds.put({ id: W, projectId: P, title: 'Las Tierras del Estuario', params: { ...DEFAULT_PARAMS, seed: 'estuario-look', width: 256 }, edits: '[]', createdAt: 1, updatedAt: 1 });
  host.__lookMount = () => {
    root = createRoot(document.getElementById('root')!);
    root.render(<MemoryRouter><div className="h-screen bg-deep text-text-primary"><WorldgenEngine projectId={P} /></div></MemoryRouter>);
  };
  host.__lookUnmount = () => { root?.unmount(); root = null; };
  host.__lookRow = async () => { const row = await db.generatedWorlds.get(W); return { presentation: row?.presentation ?? null, revision: row?.presentationRevision ?? 0, seed: row?.params.seed, edits: row?.edits }; };
  host.__lookExternal = (patch) => saveWorldPresentation({ projectId: P }, W, patch);
  host.__lookMount();
  host.__lookReady = true;
}
void preview().catch(error => { host.__lookError = String(error?.stack ?? error); });
