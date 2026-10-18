import { lazy, Suspense, useEffect, useState } from 'react';
import { Dices, Power } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

const NativeSurface = lazy(() => import('./NativeSurface'));
type Status = Awaited<ReturnType<NonNullable<Window['electronAPI']>['fiction']['status']>>;
const copy = {
  es: {
    title: 'Ficción interactiva', intro: 'Mundos, continuidad, sesiones, dados, hilos y relojes.',
    fiction: 'Mundos y juego', narration: 'Narración con el modelo global', voice: 'Lectura en voz alta', illustrations: 'Ilustraciones',
    off: 'Desactivado', on: 'Activado', data: 'Carpeta de datos de ficción', save: 'Usar esta carpeta',
    hint: 'Puedes elegir la carpeta anterior de Scheherazade para conservar los mundos en su ubicación. Desactiva Mundos y juego antes de cambiarla.',
    empty: 'Activa Mundos y juego para abrir tu biblioteca. Las funciones de narración, voz e imágenes se activan por separado.',
    desktop: 'La ficción interactiva está disponible en Writer Desktop.',
  },
  en: {
    title: 'Interactive fiction', intro: 'Worlds, continuity, sessions, dice, threads and clocks.',
    fiction: 'Worlds and play', narration: 'Global model narration', voice: 'Read aloud', illustrations: 'Illustrations',
    off: 'Off', on: 'On', data: 'Fiction data directory', save: 'Use this directory',
    hint: 'Choose the former Scheherazade data directory to keep worlds in place. Switch Worlds and play off before changing it.',
    empty: 'Enable Worlds and play to open your library. Narration, voice and pictures have separate switches.',
    desktop: 'Interactive fiction is available in Writer Desktop.',
  },
};

export default function FictionEngine() {
  const { locale } = useTranslation();
  const text = copy[locale];
  const [status, setStatus] = useState<Status | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bridge = window.electronAPI?.fiction;
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const refresh = () => bridge.status().then(value => {
      if (active) { setStatus(value); setDataDir(value.dataDir); }
    }).catch(error => { if (active) setError(String(error)); });
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [bridge]);

  async function setModule(module: string, enabled: boolean, directory?: string) {
    if (!bridge) return;
    setBusy(true);
    setError('');
    try {
      setStatus(await bridge.setModule(module, enabled, directory));
      window.dispatchEvent(new CustomEvent('writer:fiction-module', { detail: { module, enabled } }));
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <section className="flex h-full min-h-0 flex-col bg-bg-deep text-text-primary" aria-label={text.title}>
    <div className="border-b border-border px-6 py-5">
      <div className="flex items-center gap-3"><Dices size={22} className="text-accent-gold" /><h1 className="font-serif text-xl">{text.title}</h1></div>
      <p className="mt-2 text-sm text-text-muted">{text.intro}</p>
      {!bridge && <p className="mt-4 text-text-muted">{text.desktop}</p>}
      {status && <>
        <div className="mt-4 flex flex-wrap gap-3">
          {status.modules.map(module => <button key={module.id} type="button" role="switch" aria-checked={module.enabled}
            aria-label={text[module.id as 'fiction']} disabled={busy}
            onClick={() => void setModule(module.id, !module.enabled)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${module.enabled ? 'border-accent-gold bg-accent-gold/10 text-accent-gold' : 'border-border text-text-muted'}`}>
            <Power size={14} /><span>{text[module.id as 'fiction']}</span><span className="text-xs">{module.enabled ? text.on : text.off}</span>
          </button>)}
        </div>
        <details className="mt-4 text-sm text-text-muted"><summary className="cursor-pointer">{text.data}</summary>
          <p className="my-2 max-w-3xl text-xs">{text.hint}</p>
          <label className="flex flex-wrap items-center gap-2"><span className="sr-only">{text.data}</span>
            <input aria-label={text.data} value={dataDir} onChange={event => setDataDir(event.target.value)}
              disabled={busy || status.enabled.includes('fiction')} className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-3 py-2 text-text-primary" />
            <button disabled={busy || status.enabled.includes('fiction') || dataDir === status.dataDir} onClick={() => void setModule('fiction', false, dataDir)}
              className="rounded border border-border px-3 py-2 disabled:opacity-50">{text.save}</button>
          </label>
        </details>
      </>}
      {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
    </div>
    {status?.enabled.includes('fiction')
      ? <Suspense fallback={<p className="p-6 text-text-muted" aria-busy="true">…</p>}><NativeSurface /></Suspense>
      : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-text-muted">{status ? text.empty : bridge ? '…' : ''}</div>}
  </section>;
}
