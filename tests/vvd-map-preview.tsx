import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import MapsEngine from '@/engines/maps/MapsEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { captureMapVersion } from '@/engines/maps/operations';
import '@/index.css';

async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  const projectId = 'vvd-map-preview', mapId = 'vvd-map-preview-atlas';
  const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 800;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#334c51'; context.fillRect(0, 0, 1400, 800);
  const land = new Path2D('M130 200 C190 80 390 40 550 160 C700 110 830 170 860 300 L1130 350 C1300 410 1280 620 1080 650 L820 620 C690 760 420 690 380 570 C200 600 70 430 130 200 Z');
  context.fillStyle = '#869078'; context.fill(land); context.lineWidth = 5; context.strokeStyle = '#b6b49a'; context.stroke(land);
  context.strokeStyle = '#405e62'; context.lineWidth = 15; context.beginPath(); context.moveTo(700, 250); context.bezierCurveTo(780, 320, 650, 400, 790, 620); context.stroke();
  context.font = 'italic 30px Georgia'; context.fillStyle = '#c7cbbd'; context.fillText('Mar de Poniente', 80, 710);
  context.fillStyle = '#d6d0b7'; context.font = '24px Georgia';
  for (const [x, y] of [[340, 290], [390, 250], [440, 310], [485, 265], [535, 320]]) context.fillText('▲', x, y);
  await db.worldMaps.put({ id: mapId, projectId, title: 'Las Tierras del Estuario', backgroundImage: canvas.toDataURL(), source: 'uploaded', createdAt: 1, updatedAt: 1, features: [
    { id: 'north', kind: 'region', name: 'Marca del Norte', description: 'Frontera entre las montañas y el río del estuario.', color: '#d5b575', opacity: .18, points: [{ x: 20, y: 23 }, { x: 45, y: 20 }, { x: 49, y: 47 }, { x: 24, y: 55 }] },
    { id: 'road', kind: 'path', name: 'Camino de la Sal', color: '#e4a853', points: [{ x: 29, y: 46 }, { x: 43, y: 52 }, { x: 59, y: 49 }, { x: 74, y: 65 }] },
    { id: 'sea', kind: 'label', name: 'Estuario de las Brumas', color: '#e2e7df', points: [{ x: 76, y: 25 }] },
  ] });
  await db.mapPins.bulkPut([
    { id: 'harbour', projectId, mapId, name: 'Puerto del Viento', icon: 'port', position: { x: 73, y: 66 }, description: 'El puerto de entrada al estuario.' },
    { id: 'fortress', projectId, mapId, name: 'Torre de Sal', icon: 'castle', position: { x: 30, y: 45 } },
  ]);
  await db.worldMaps.update(mapId, { layers: [{ id: 'political', name: 'Fronteras y asentamientos', visible: true }, { id: 'journeys', name: 'Viajes y caminos', visible: true }], features: (await db.worldMaps.get(mapId))!.features!.map(feature => ({ ...feature, layerId: feature.kind === 'path' ? 'journeys' : 'political' })) });
  await db.mapPins.where('mapId').equals(mapId).modify({ layerId: 'political' });
  await captureMapVersion(mapId, { name: 'El primer asentamiento', date: 'Año 431', description: 'La marca antes de la apertura del Camino de la Sal.' });
  await db.worldMaps.update(mapId, { features: (await db.worldMaps.get(mapId))!.features!.map(feature => feature.id === 'north' ? { ...feature, points: [{ x: 20, y: 23 }, { x: 45, y: 20 }, { x: 49, y: 47 }, { x: 24, y: 55 }] } : feature) });
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/maps?map=${mapId}`]}><main className="bg-deep text-text-primary min-h-screen p-6"><div className="mb-5 flex items-baseline gap-4"><h1 className="font-serif text-2xl text-accent-gold">Cartografía</h1><p className="text-sm text-text-muted">Las Tierras del Estuario</p></div><MapsEngine projectId={projectId} /></main></MemoryRouter>);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (document.querySelector('[data-feature-id="north"]')) { (window as unknown as { __mapReady: boolean }).__mapReady = true; return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Map preview did not mount');
}
preview().catch(error => { (window as unknown as { __mapError: string }).__mapError = String(error.stack || error); });
