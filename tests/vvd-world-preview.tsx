import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import TablesEngine from '@/engines/tables/TablesEngine';
import MediaEngine from '@/engines/media/MediaEngine';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import TiptapEditor from '@/components/editor/TiptapEditor';
import ReadingView from '@/engines/writings/components/ReadingView';
import ReaderPresentationModal from '@/engines/writings/components/ReaderPresentationModal';
import { defaultReaderPresentation, defaultChapterPresentation } from '@/engines/writings/readerPresentation';
import { readerParagraphs } from '@/engines/writings/readerSoundtrack';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocaleStore } from '@/stores/localeStore';
import { emptyWord } from '@/engines/dictionary/types';
import type { CodexEntry, Project, Writing } from '@/types';
import '@/index.css';

const P = 'synthetic-vvd-world-preview';
const entries: CodexEntry[] = [
  { id: 'synthetic-iria', projectId: P, title: 'Iria de la Sal', type: 'character', fields: { aliases: '["Iria"]', role: 'Cartógrafa', origin: 'Puerto del Viento' }, tags: ['litoral'], relations: [], content: '<p>Iria custodia las cartas del Estuario. Busca el Camino de la Sal antes de que llegue la niebla.</p>', createdAt: 1, updatedAt: 1 },
  { id: 'synthetic-port', projectId: P, title: 'Puerto del Viento', type: 'location', fields: { population: '1.400', region: 'Marca del Norte' }, tags: ['litoral'], relations: [], content: '<p>Un puerto entre el río y el mar, donde Iria aprendió a navegar.</p>', createdAt: 1, updatedAt: 1 },
];
type Surface = 'dictionary' | 'tables' | 'media' | 'wiki' | 'editor' | 'links' | 'reading' | 'presentation';
const writings: Writing[] = [{ id: 'synthetic-chapter', projectId: P, title: 'La lengua de la marea', status: 'draft', content: `<p>${'Iria apoyó la lámpara sobre la mesa. La primera luz del amanecer se dibujaba en el cristal, mientras Puerto del Viento despertaba. '.repeat(24)}</p>`, wordCount: 600, tags: [], createdAt: 1, updatedAt: 1 }];
function ReaderPreview({ studio }: { studio: boolean }) {
  const project = useLiveQuery(() => db.projects.get(P), []);
  if (!project) return null;
  return studio ? <ReaderPresentationModal project={project} writings={writings} onClose={() => undefined} /> : <ReadingView pieces={writings} onClose={() => undefined} onOpenInEditor={() => undefined} />;
}
declare global { interface Window { __worldPreviewReady?: boolean; __worldPreviewError?: string; __worldPreviewSelect?: (surface: Surface) => void } }
function Preview() {
  const [surface, setSurface] = useState<Surface>('dictionary');
  useEffect(() => { window.__worldPreviewSelect = setSurface; window.__worldPreviewReady = true; }, []);
  if (surface === 'reading' || surface === 'presentation') return <MemoryRouter><ReaderPreview studio={surface === 'presentation'} /></MemoryRouter>;
  return <MemoryRouter><main className="flex h-screen min-h-0 flex-col bg-deep text-text-primary"><header className="flex shrink-0 flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-4"><h1 className="font-display text-xl text-accent-gold">Las Tierras del Estuario</h1><p className="text-xs text-text-muted">Proyecto sintético · Revisión de interfaz</p></header><div key={surface} data-preview-surface={surface} className="min-h-0 flex-1">{surface === 'dictionary' ? <DictionaryEngine projectId={P} /> : surface === 'tables' ? <TablesEngine projectId={P} /> : surface === 'media' ? <MediaEngine projectId={P} /> : surface === 'wiki' ? <div className="h-full overflow-auto p-6"><h2 className="mb-5 font-display text-2xl">Publicar una wiki local</h2><WikiExportControl projectId={P} entries={entries} /></div> : <div className="h-full overflow-auto p-6"><h2 className="mb-6 font-display text-2xl">Capítulo 3 · La lengua de la marea</h2><TiptapEditor referenceContext={{ projectId: P, scopeId: 'synthetic-chapter' }} content="<h2>El mapa de la niebla</h2><p>Iria apoyó la lámpara sobre la mesa. La shara del amanecer se dibujaba en el cristal, mientras Puerto del Viento despertaba.</p><p>—No es una frontera —dijo—. Es el camino que aún no hemos recorrido.</p>" onChange={() => {}} /></div>}</div></main></MemoryRouter>;
}
async function start() {
  useLocaleStore.setState({ locale: 'es' });
  const project: Project = { id: P, title: 'Las Tierras del Estuario', description: 'Rutas, lenguas y memoria del litoral.', type: 'standalone', mode: 'custom', status: 'draft', color: '#d5b575', enabledEngines: ['codex', 'dictionary', 'tables', 'media'], engineOrder: ['codex', 'dictionary', 'tables', 'media'], createdAt: 1, updatedAt: 1,
    readerPresentation: { ...defaultReaderPresentation(), cover: { ...defaultReaderPresentation().cover, showAtStart: true, color: '#315f61', texture: 'linen' }, chapters: { 'synthetic-chapter': { ...defaultChapterPresentation(), background: '#f1e6ce', font: 'serif', mode: 'pages', audio: { assetId: 'synthetic-audio', volume: .4, loop: true }, paragraphAudio: [{ ...readerParagraphs(writings[0].content)[0], track: { assetId: 'synthetic-audio', volume: .6, loop: false } }] } } },
    dictionaries: [{ id: 'synthetic-lumic', name: 'Lúmico', description: 'La lengua de los navegantes del estuario.', scriptMapping: 'sh=ⵛ\na=ⴰ\nr=ⵔ', detectInManuscript: true, words: [
      { ...emptyWord(), word: 'shara', pronunciation: 'ˈʃa.ra', partOfSpeech: 'nombre', meaning: 'La primera luz que se refleja sobre el agua.', examples: 'La shara anuncia el regreso de las barcas.', phrases: 'shara lum · claridad del mar', derivatives: 'sharan · luminoso', origin: 'De la antigua voz de los fareros.' },
      { ...emptyWord(), word: 'lume', partOfSpeech: 'nombre', meaning: 'Fuego pequeño que guía durante la noche.', origin: 'Vocabulario de costa.' },
      { ...emptyWord(), word: 'nora', partOfSpeech: 'verbo', meaning: 'Escuchar el cambio de la marea.' },
    ] }, { id: 'synthetic-old', name: 'Habla de las montañas', description: 'Notas de campo', scriptMapping: '', detectInManuscript: false, words: [] }],
    dataTables: [{ id: 'synthetic-trade', title: 'Comercio del estuario', mode: 'table', columns: [{ id: 'name', name: 'Mercancía', kind: 'text', width: 220 }, { id: 'units', name: 'Unidades', kind: 'number', width: 160 }, { id: 'place', name: 'Destino', kind: 'reference', width: 240 }, { id: 'checked', name: 'Revisado', kind: 'checkbox', width: 130 }], rows: [
      { id: 'salt', cells: { name: 'Sal de las marismas', units: '120', place: 'synthetic-port', checked: 'true' } },
      { id: 'ink', cells: { name: 'Tinta de calamar', units: '24', place: 'synthetic-port', checked: 'false' } },
      { id: 'linen', cells: { name: 'Lino azul', units: '80', place: '', checked: 'true' } },
    ] }],
  };
  await db.projects.put(project); await db.codexEntries.bulkPut(entries); await db.writings.bulkPut(writings);
  const wav = new ArrayBuffer(1644); const view = new DataView(wav); const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 1636, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 1600, true);
  await db.localMediaAssets.put({ id: 'synthetic-audio', projectId: P, title: 'Notas de campo · Puerto del Viento.wav', kind: 'audio', mime: 'audio/wav', blob: new Blob([wav], { type: 'audio/wav' }), size: wav.byteLength, notes: 'Recuerdos para la escena del regreso. Archivo de audio sintético para verificar la reproducción local.', tags: ['ambiente', 'puerto'], linkedEntryIds: ['synthetic-port'], createdAt: 1, updatedAt: 1 });
  createRoot(document.getElementById('root')!).render(<Preview />);
}
start().catch(error => { window.__worldPreviewError = String(error.stack || error); });
