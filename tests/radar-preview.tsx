import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import RadarEngine from '@/engines/radar/RadarEngine';
import { createRadarChart, RADAR_COLORS } from '@/engines/radar/model';
import { saveRadarChart } from '@/engines/radar/operations';
const P = 'visual-radar';
async function main() {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const project: Project = { id: P, title: 'Rutas', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['radar'], engineOrder: ['radar'], createdAt: 1, updatedAt: 1 };
  await db.projects.put(project); const chart = createRadarChart('Rutas del estuario');
  const labels = ['Seguridad', 'Coste', 'Duración', 'Carga', 'Acceso'], units = ['', 'créditos', 'días', 'kg', ''];
  chart.axes.forEach((axis, index) => { axis.label = labels[index]; axis.max = [10, 100, 20, 200, 10][index]; axis.unit = units[index]; });
  chart.series = ['Ruta norte', 'Canal interior', 'Ruta costera'].map((name, index) => ({ id: crypto.randomUUID(), name, color: RADAR_COLORS[index], values: Object.fromEntries(chart.axes.map((axis, axisIndex) => [axis.id, [[8, 70, 4, 120, 7], [5, 40, 9, 180, 5], [7, 90, 6, 90, 9]][index][axisIndex]])) }));
  chart.description = 'Medidas independientes para preparar la expedición. Cada eje tiene su propia escala.';
  await saveRadarChart(P, chart, null); createRoot(document.getElementById('root')!).render(<MemoryRouter><RadarEngine projectId={P} /></MemoryRouter>);
}
void main().then(() => { (window as unknown as { __previewReady: boolean }).__previewReady = true; }).catch(error => { (window as unknown as { __previewError: string }).__previewError = String(error); });
