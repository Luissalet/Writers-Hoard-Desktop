import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import type { Project, Writing } from '@/types';
import { installReaderSoundtrack, readerSoundChapter } from '../readerSoundtrack';

export default function ReaderSoundtrackControl({ project, writings, viewport, locale }: { project: Project; writings: Writing[]; viewport: RefObject<HTMLDivElement | null>; locale: 'es' | 'en' }) {
  const button = useRef<HTMLButtonElement>(null), status = useRef<HTMLSpanElement>(null);
  const chapters = useMemo(() => writings.filter(writing => writing.projectId === project.id).map(writing => readerSoundChapter(writing.id, project.readerPresentation?.chapters[writing.id])), [project, writings]);
  const ids = useMemo(() => [...new Set(chapters.flatMap(chapter => [chapter.audio?.assetId, ...chapter.cues.map(cue => cue.track.assetId)]).filter((id): id is string => Boolean(id)))], [chapters]);
  const assets = useLiveQuery(() => db.localMediaAssets.bulkGet(ids), [ids]);
  useEffect(() => {
    if (!viewport.current || !button.current || !status.current || !assets) return;
    const sources: Record<string, string> = {};
    for (const asset of assets) if (asset && asset.projectId === project.id && asset.kind === 'audio') sources[asset.id] = URL.createObjectURL(asset.blob);
    const dispose = installReaderSoundtrack(viewport.current, button.current, status.current, chapters, sources, locale === 'es' ? { enable: 'Activar ambientación', disable: 'Silenciar ambientación', blocked: 'No se pudo reproducir. Desactiva y vuelve a activar la ambientación.', unavailable: 'Una pista local no está disponible.' } : { enable: 'Enable ambience', disable: 'Mute ambience', blocked: 'Playback failed. Toggle ambience off and on to retry.', unavailable: 'A local track is unavailable.' });
    return () => { dispose(); Object.values(sources).forEach(url => URL.revokeObjectURL(url)); };
  }, [assets, chapters, locale, project.id, viewport]);
  if (!ids.length) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs text-text-muted"><button ref={button} type="button" aria-pressed="false" className="min-h-9 rounded-lg border border-border px-3 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold">{locale === 'es' ? 'Activar ambientación' : 'Enable ambience'}</button><span>{locale === 'es' ? 'Las pistas siguen el capítulo y el párrafo visible.' : 'Tracks follow the visible chapter and paragraph.'}</span><span ref={status} role="status" /></div>;
}
