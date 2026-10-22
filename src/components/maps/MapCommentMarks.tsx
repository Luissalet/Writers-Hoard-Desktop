import { MessageSquare } from 'lucide-react';
import { useAnnotationsForEntity } from '@/engines/annotations/hooks';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';

/** Comments left at a spot on the map. Clicking one brings its thread into view in the notes below. */
export default function MapCommentMarks({ projectId, mapId }: { projectId: string; mapId: string }) {
  const { locale } = useTranslation();
  const copy = mapFeatureCopy[locale === 'en' ? 'en' : 'es'];
  const { items } = useAnnotationsForEntity({ engineId: 'maps', entityId: mapId, projectId });
  const marks = items.filter(note => note.anchor.type === 'map_point' && Number.isFinite(note.anchor.x) && Number.isFinite(note.anchor.y));
  const show = (id: string) => {
    const thread = document.querySelector<HTMLElement>(`[data-comment-thread="${CSS.escape(id)}"]`);
    if (!thread) return;
    thread.scrollIntoView({ block: 'center', behavior: 'smooth' });
    thread.classList.add('ring-2', 'ring-accent-gold');
    window.setTimeout(() => thread.classList.remove('ring-2', 'ring-accent-gold'), 1600);
  };
  return <>{marks.map((note, index) => <button key={note.id} type="button" className={`absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border border-white/40 shadow ${note.resolvedAt ? 'bg-elevated text-text-muted' : 'bg-accent-gold text-deep'}`}
    style={{ left: `${note.anchor.x}%`, top: `${note.anchor.y}%` }} title={note.noteBody || copy.commentHere} aria-label={`${copy.commentHere} ${index + 1}: ${note.noteBody ?? ''}`}
    onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); show(note.id); }} data-testid={`map-comment-${note.id}`}><MessageSquare size={12} /></button>)}</>;
}
