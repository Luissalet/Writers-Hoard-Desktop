import { useState } from 'react';
import { Music2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { LocalMediaPlayer } from '@/engines/media/LocalMediaPlayer';
import SoundLibraryPicker from '@/engines/media/SoundLibraryPicker';

/** A project-owned local alternative to streaming radio. It stays mounted
 * across tool/pane navigation, and never starts playback without user input. */
export default function ProjectSoundtrack({ projectId, locale }: { projectId: string; locale: 'es' | 'en' }) {
  const [selectedId, setSelectedId] = useState(''), [loop, setLoop] = useState(true), [speed, setSpeed] = useState(1);
  const rows = useLiveQuery(() => db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.kind === 'audio').toArray(), [projectId]);
  const assets = rows?.filter(asset => asset.projectId === projectId) ?? [], asset = assets.find(asset => asset.id === selectedId);
  const c = locale === 'es' ? { title: 'Ambiente', clip: 'Audio local', choose: 'Elegir una pista', loop: 'Repetir', speed: 'Velocidad', stop: 'Detener y liberar pista', empty: 'Importa pistas en Sonido y vídeo. Seguirán disponibles mientras cambias entre herramientas de este proyecto.', help: 'Se mantiene al cambiar de herramienta. Cerrar este desplegable conserva la reproducción; salir del proyecto la detiene.', error: 'Este formato no puede reproducirse en este dispositivo.' } : { title: 'Ambience', clip: 'Local audio', choose: 'Choose a track', loop: 'Loop', speed: 'Speed', stop: 'Stop and release track', empty: 'Import tracks in Sound and video. They stay available while you switch between this project’s tools.', help: 'Stays active between tools. Closing this disclosure keeps playback; leaving the project stops it.', error: 'This format cannot play on this device.' };
  return <details data-project-soundtrack className="min-w-0 open:w-full"><summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><Music2 size={15} aria-hidden="true" />{c.title}{asset && <span className="max-w-36 truncate text-xs text-text-muted">· {asset.title}</span>}</summary><div className="my-3 max-w-3xl space-y-3 rounded-lg border border-border bg-surface p-4">
    <p className="max-w-prose text-xs leading-relaxed text-text-muted">{assets.length ? c.help : c.empty}</p>
    {assets.length > 0 && <><div className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 space-y-1 text-xs text-text-muted">{c.clip}<select className="min-h-9 w-full rounded-lg border border-border bg-deep px-3 text-sm text-text-primary" value={asset?.id ?? ''} onChange={event => setSelectedId(event.target.value)}><option value="">{c.choose}</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></label><label className="flex min-h-9 items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />{c.loop}</label><label className="space-y-1 text-xs text-text-muted">{c.speed}<select className="block min-h-9 rounded-lg border border-border bg-deep px-3 text-sm text-text-primary" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label></div>
      {asset && <><LocalMediaPlayer key={`${projectId}:${asset.id}`} asset={asset} loop={loop} speed={speed} fallback={c.error} /><button type="button" className="min-h-9 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={() => setSelectedId('')}>{c.stop}</button></>}
    </>}
    <SoundLibraryPicker projectId={projectId} locale={locale} onAdded={added => setSelectedId(added.id)} />
  </div></details>;
}
