import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { publishingFetch } from './transport';

// Links Hoard and Kafka's Hoard are their own apps: Writer reads and saves through them.
export const EXTERNAL_MODULES = ['links', 'paperwork'] as const;
export interface ExternalState {
  module: string; app: string; name: string; url: string; running: boolean; version: string;
  hub_url: string; hub_reachable: boolean; hub_state: string; can_start: boolean; error: string; message?: string;
}
const copy = {
  es: { checking: 'Comprobando', running: 'en marcha', stopped: 'no está en marcha', open: 'Abrir', start: 'Arrancar con Hoard Hub',
    starting: 'Arrancando…', retry: 'Comprobar', noHub: 'Hoard Hub no responde en', noHubTail: 'ábrelo para poder arrancar la app desde aquí.',
    note: 'Writer guarda y lee estos datos en {name}; sus automatismos ({jobs}) se gestionan en esa app.',
    jobs: { links: 'vigías, descargas, digestos de vídeo', paperwork: 'correo, carpetas vigiladas, recordatorios' } },
  en: { checking: 'Checking', running: 'running', stopped: 'is not running', open: 'Open', start: 'Start with Hoard Hub',
    starting: 'Starting…', retry: 'Check', noHub: 'Hoard Hub does not answer at', noHubTail: 'open it to start the app from here.',
    note: 'Writer saves and reads this data in {name}; its background jobs ({jobs}) are managed in that app.',
    jobs: { links: 'watches, downloads, video digests', paperwork: 'mail, watched folders, reminders' } },
};

async function readJson(path: string, method = 'GET'): Promise<ExternalState> {
  const reply = await publishingFetch(path, { method });
  const value = await reply.json();
  if (!reply.ok) throw new Error(value?.detail || value?.error || `Error ${reply.status}`);
  return value as ExternalState;
}

export default function ExternalHoardBar({ module, locale, onBack }: { module: string; locale: 'es' | 'en'; onBack?: () => void }) {
  const text = copy[locale] || copy.es;
  const [state, setState] = useState<ExternalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const wasDown = useRef(false);
  const back = useRef(onBack);
  back.current = onBack;
  const show = useCallback((value: ExternalState) => {
    setState(value);
    // The Hoard came back: reload Writer's view so it reads the data again.
    if (value.running && wasDown.current) back.current?.();
    wasDown.current = !value.running;
  }, []);
  const check = useCallback(async () => {
    setMessage('');
    try { show(await readJson(`/api/external/${module}`)); }
    catch (error) { setMessage(String(error)); }
  }, [module, show]);
  useEffect(() => {
    setState(null); void check();
    const again = () => void check();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [check]);
  async function start() {
    setBusy(true); setMessage('');
    try { const value = await readJson(`/api/external/${module}/start`, 'POST'); show(value); setMessage(value.message || ''); }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  const name = state?.name || (module === 'links' ? 'Links Hoard' : "Kafka's Hoard");
  const host = state?.url.replace(/^https?:\/\//, '') || '';
  return <div role="status" aria-live="polite" data-external-hoard={module} data-state={!state ? 'checking' : state.running ? 'running' : 'stopped'}
    className={`mt-3 rounded border px-3 py-2 text-sm ${state && !state.running ? 'border-amber-500/60 bg-amber-500/10' : 'border-border bg-bg-surface'}`}>
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${!state ? 'bg-text-muted' : state.running ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      <span className="font-medium">{!state ? `${text.checking} ${name}…` : `${name} ${state.running ? text.running : text.stopped}`}</span>
      {state && <span className="text-text-muted">{host}{state.running && state.version ? ` · v${state.version}` : ''}</span>}
      <span className="flex-1" />
      {state && !state.running && state.can_start && <button type="button" disabled={busy} onClick={() => void start()} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 disabled:opacity-50"><Play size={14} />{busy ? text.starting : text.start}</button>}
      <button type="button" disabled={busy} onClick={() => void check()} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 disabled:opacity-50"><RefreshCw size={14} />{text.retry}</button>
      {state?.running && <a href={state.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-border px-3 py-1"><ExternalLink size={14} />{text.open} {name}</a>}
    </div>
    {state && !state.running && !state.hub_reachable && <p className="mt-1 text-text-muted">{text.noHub} {state.hub_url}: {text.noHubTail}</p>}
    {state?.running && <p className="mt-1 text-text-muted">{text.note.replace('{name}', name).replace('{jobs}', module === 'links' ? text.jobs.links : text.jobs.paperwork)}</p>}
    {message && <p className="mt-1">{message}</p>}
  </div>;
}
