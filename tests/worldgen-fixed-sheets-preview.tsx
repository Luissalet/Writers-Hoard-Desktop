import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import FixedSheetView from '@/engines/worldgen/sheets/FixedSheetView';
import { requestFixedSheet, type SheetRequest } from '@/engines/worldgen/sheets/client';
import { themeById } from '@/engines/worldgen/cartography/theme';
import { useLocaleStore } from '@/stores/localeStore';
import { fixedSheet, sheetGeography, sheetWorld, sheetWorkerFactory } from './worldgen-fixed-sheet-data';
import '@/index.css';
async function preview() {
  const P = 'fixed-sheet-preview', W = 'fixed-sheet-preview-world', initial = fixedSheet(); useLocaleStore.setState({ locale: 'es' });
  const record = { id: W, projectId: P, title: 'Las Tierras del Estuario', params: sheetWorld.params, regions: [initial], edits: '[{"kind":"placesEverywhere","enabled":true}]', createdAt: 1, updatedAt: 1 };
  await db.projects.put({ id: P, title: record.title, type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 }); await db.generatedWorlds.put(record);
  const factory = sheetWorkerFactory(), request: SheetRequest = (world, geography, frame, options) => requestFixedSheet(world, geography, frame, { ...options, workerFactory: factory });
  createRoot(document.getElementById('root')!).render(<div className="h-screen bg-deep p-8 text-text-primary"><h1 className="font-display text-2xl text-accent-gold">Las Tierras del Estuario · Worldgen</h1><FixedSheetView record={record} initial={initial} existing world={sheetWorld} canon={{ world: sheetWorld, edits: record.edits }} geography={sheetGeography} theme={themeById('parchment')} prepare={async () => true} onSaved={() => undefined} onClose={() => undefined} request={request} /></div>);
}
void preview().catch(error => { (window as unknown as { __sheetError: string }).__sheetError = String(error); });
