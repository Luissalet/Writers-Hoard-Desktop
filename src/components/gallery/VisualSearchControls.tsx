import { useEffect, useRef, useState } from 'react';
import { Search, Download, X } from 'lucide-react';
import type { InspirationImage } from '@/types';
import type { VisualSearchStatus } from '@/services/visualSearch/types';
import { searchVisualImages, visualSearchApi, type VisualMatch } from '@/services/visualSearch/search';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40';
export default function VisualSearchControls({ projectId, images, query, locale, onResults }: { projectId: string; images: readonly InspirationImage[]; query: string; locale: 'es' | 'en'; onResults(matches: VisualMatch[] | undefined, source: readonly InspirationImage[], query: string): void }) {
  const es = locale === 'es', [status, setStatus] = useState<VisualSearchStatus>(), [busy, setBusy] = useState<'prepare' | 'search'>(), [progress, setProgress] = useState({ done: 0, total: 0 }), [error, setError] = useState(''), [failed, setFailed] = useState(0);
  const active = useRef<AbortController | undefined>(undefined), mounted = useRef(true), generation = useRef(0);
  useEffect(() => { mounted.current = true; void Promise.resolve().then(() => visualSearchApi().status()).then(value => { if (mounted.current) setStatus(value); }).catch(() => { if (mounted.current) setError(es ? 'La búsqueda visual necesita la aplicación de escritorio.' : 'Visual search requires the desktop application.'); }); return () => { mounted.current = false; active.current?.abort(); }; }, [es]);
  useEffect(() => { if (busy !== 'prepare') return; const timer = setInterval(() => { void Promise.resolve().then(() => visualSearchApi().status()).then(value => { if (mounted.current) setStatus(value); }).catch(() => {}); }, 700); return () => clearInterval(timer); }, [busy]);
  const prepare = async () => {
    if (busy) return; setBusy('prepare'); setError('');
    try { const value = await visualSearchApi().prepare(); if (mounted.current) setStatus(value); }
    catch { if (mounted.current) { setStatus(undefined); setError(es ? 'No se pudo preparar el modelo. Comprueba la conexión y vuelve a intentarlo.' : 'Model preparation failed. Check your connection and try again.'); } }
    finally { if (mounted.current) setBusy(undefined); }
  };
  const search = async () => {
    if (busy || !query.trim()) return;
    const controller = new AbortController(), token = ++generation.current; active.current = controller;
    setBusy('search'); setError(''); setFailed(0); setProgress({ done: 0, total: images.length }); onResults(undefined, images, query);
    try { const result = await searchVisualImages(projectId, query, images, { signal: controller.signal, progress: (done, total) => { if (mounted.current && token === generation.current) setProgress({ done, total }); } }); if (mounted.current && token === generation.current) { onResults(result.matches, images, query); setFailed(result.failed.length); } }
    catch { if (mounted.current && token === generation.current && !controller.signal.aborted) setError(es ? 'No se pudo completar la búsqueda. Puedes preparar de nuevo el modelo y volver a buscar.' : 'Search failed. Prepare the model again and retry your search.'); }
    finally { if (mounted.current && token === generation.current) { active.current = undefined; setBusy(undefined); } }
  };
  return <div className="space-y-2" data-visual-search-controls="true">
    <div className="flex flex-wrap items-center gap-2">
      {status?.state === 'ready' ? <button type="button" className={button} disabled={!!busy || !query.trim() || !images.length} onClick={() => { void search(); }}><Search size={15} />{es ? 'Buscar por contenido' : 'Search image content'}</button> : <button type="button" className={button} disabled={!!busy} onClick={() => { void prepare(); }}><Download size={15} />{es ? 'Preparar búsqueda visual' : 'Prepare visual search'}</button>}
      {busy === 'search' && <button type="button" className={button} onClick={() => { active.current?.abort(); generation.current++; setBusy(undefined); }}><X size={15} />{es ? 'Cancelar búsqueda' : 'Cancel search'}</button>}
      {!!error && status?.state === 'ready' && <button type="button" className={button} disabled={!!busy} onClick={() => { void prepare(); }}>{es ? 'Preparar de nuevo' : 'Prepare again'}</button>}
      <p role="status" className="text-sm text-text-muted">{busy === 'prepare' ? (es ? 'Preparando el modelo local…' : 'Preparing the local model…') + (status?.progress === undefined ? '' : ` ${Math.round(status.progress)}%`) : busy === 'search' ? `${es ? 'Analizando' : 'Analysing'} ${progress.done} / ${progress.total}` : es ? 'Ordena por parecido visual. Las imágenes se procesan en este equipo.' : 'Ranks by visual similarity. Images are processed on this computer.'}</p>
    </div>
    {status?.state !== 'ready' && <p className="max-w-prose text-sm text-text-muted">{es ? 'La primera preparación descarga los modelos de imagen e idiomas (unos 230 MB). Después puedes buscar sin conexión.' : 'First preparation downloads the image and language models (about 230 MB). Search then works offline.'}</p>}
    {!!failed && <p role="status" className="text-sm text-text-muted">{es ? `${failed} imágenes no se pudieron analizar. Vuelve a buscar para intentarlo de nuevo.` : `${failed} images could not be analysed. Search again to retry them.`}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
