import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import CodexEngine from '@/engines/codex/CodexEngine';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry } from '@/types';
import '@/index.css';

async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  const projectId = 'world-graph-preview';
  const NativeWorker = window.Worker;
  class ObservedWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.addEventListener('message', event => { if (event.data?.graph) { (window as unknown as { __graphWorker: boolean }).__graphWorker = true; const edges = event.data.graph.edges as Array<{ source: string; target: string; kind: string; label: string }>; (window as unknown as { __graphPointerWorker: boolean }).__graphPointerWorker = edges.some(edge => edge.source === 'north' && edge.target === 'order' && edge.kind === 'reference' && edge.label === 'Enlace del texto') && edges.some(edge => edge.source === 'north' && edge.target === 'harbour' && edge.kind === 'reference' && edge.label === 'Bloque Codex vivo'); } }); }
  }
  window.Worker = ObservedWorker;
  const entry = (id: string, title: string, type: CodexEntry['type'], content: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, projectId, type, title, fields: {}, content, tags: [], relations: [], createdAt: 1, updatedAt: 1, ...extra });
  await db.projects.put({ id: projectId, title: 'Las Tierras del Estuario', mode: 'custom', type: 'standalone', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex', 'relationships'], engineOrder: ['codex', 'relationships'], codexTemplates: [{ id: 'person', name: 'Habitante del estuario', category: 'character', fields: {}, content: '', referenceFieldDefinitions: [{ key: 'residence', label: 'Residencia', targetType: 'location' }], revision: 1, createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 });
  await db.codexEntries.bulkPut([
    entry('nora', 'Nora Valdés', 'character', '<p>La Cartógrafa recorrió el Camino de la Sal y trazó la frontera de la Marca del Norte.</p><p>Eneas conserva sus cartas.</p>', { templateId: 'person', fields: { aliases: 'La Cartógrafa' }, referenceFields: { residence: ['harbour'] }, tags: ['Expedición'], relations: [{ targetId: 'order', targetTitle: 'Orden de la Sal', type: 'miembro' }] }),
    entry('harbour', 'Puerto del Viento', 'location', '<p>La Orden de la Sal controla el paso hacia la Marca del Norte.</p>', { tags: ['Estuario'] }),
    entry('north', 'Marca del Norte', 'location', `<p>Territorio de frontera que Nora Valdés dibujó en su atlas. <a href="/project/${projectId}/codex?entry=order">El consejo de aquella costa</a>.</p><aside data-wh-codex-block="true" data-project-id="${projectId}" data-entry-id="harbour" data-label="Nombre antiguo"><p>Codex: nombre antiguo</p></aside>`, { tags: ['Estuario'] }),
    entry('order', 'Orden de la Sal', 'faction', '<p>La Cartógrafa negoció con Eneas el paso de los convoyes.</p>', { relations: [{ targetId: 'harbour', targetTitle: 'Puerto del Viento', type: 'controla' }] }),
    entry('eneas', 'Eneas de Arce', 'character', '<p>Cronista del Puerto del Viento y aliado de Nora Valdés.</p>', { fields: { aliases: 'Eneas; El Cronista' }, tags: ['Expedición'] }),
    entry('road', 'Camino de la Sal', 'concept', '<p>Recorrido entre el Puerto del Viento y la Marca del Norte.</p>', { referenceFields: { inicio: ['harbour'], final: ['north'] } }),
  ]);
  await db.relationships.put({ id: 'nora-eneas', projectId, entityAId: 'nora', entityAName: 'Nora Valdés', entityAType: 'codex-entry', entityBId: 'eneas', entityBName: 'Eneas de Arce', entityBType: 'codex-entry', kind: 'colleague', intensity: 4, label: 'Compañeros de expedición', notes: 'Se conocieron durante el levantamiento del atlas.', state: 'current', directional: false, createdAt: 1, updatedAt: 1 });
  (window as unknown as { __readGraphLayout: () => Promise<unknown> }).__readGraphLayout = async () => (await db.projects.get(projectId))?.codexGraphLayout;
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/codex`]}><main className="min-h-screen bg-deep p-6 text-text-primary"><div className="mb-5 flex items-baseline gap-4"><h1 className="font-serif text-2xl text-accent-gold">Códex</h1><p className="text-sm text-text-muted">Las Tierras del Estuario</p></div><CodexEngine projectId={projectId} /></main></MemoryRouter>);
  let opened = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    const open = document.querySelector<HTMLButtonElement>('[data-testid="codex-show-graph"]'); if (open && !opened) { opened = true; open.click(); }
    if (document.querySelector('[data-testid="world-graph-node-nora"]') && (window as unknown as { __graphWorker: boolean }).__graphWorker) { (window as unknown as { __graphReady: boolean }).__graphReady = true; return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('World graph/real worker preview timeout');
}
preview().catch(error => { (window as unknown as { __graphError: string }).__graphError = String(error.stack || error); });
