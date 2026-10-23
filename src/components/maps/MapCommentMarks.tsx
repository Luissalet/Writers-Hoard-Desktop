import { useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { MapPoint } from '@/types';
import { useAnnotationsForEntity } from '@/engines/annotations/hooks';
import { mutateAnnotationThread } from '@/engines/annotations/threads';
import { openCommentThread } from '@/engines/annotations/openThread';
import { isThreadUnread } from '@/engines/annotations/readState';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';

interface Props {
  projectId: string;
  mapId: string;
  /** Picture percent under a screen point; with it a comment can be dragged to another spot. */
  toPicture?: (clientX: number, clientY: number) => MapPoint | null;
  /** Told while a comment is being dragged, so the map does not pan under it. */
  onDragging?: (dragging: boolean) => void;
}

/**
 * Comments left at a spot on the map. Clicking one brings its thread into view
 * in the notes below; dragging it moves it (saved with the thread's revision,
 * so a comment changed meanwhile elsewhere is not overwritten).
 */
export default function MapCommentMarks({ projectId, mapId, toPicture, onDragging }: Props) {
  const { locale } = useTranslation();
  const copy = mapFeatureCopy[locale === 'en' ? 'en' : 'es'];
  const scope = useWorldEraScope(projectId);
  const { items, refresh } = useAnnotationsForEntity({ engineId: 'maps', entityId: mapId, projectId });
  const [drag, setDrag] = useState<{ id: string; at: MapPoint; moved: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A drag ends with a click on the same marker; that click must not open the thread.
  const dragged = useRef(false);
  type Held = { id: string; pointer: number; x: number; y: number; from: MapPoint; start: MapPoint; at: MapPoint; moved: boolean };
  const held = useRef<Held | null>(null);
  /** The gesture after a pointer event: moved once it travels more than 4 px, the spot keeps the grab offset. */
  const follow = (event: { pointerId: number; clientX: number; clientY: number }): Held | null => {
    const now = held.current;
    if (!now || now.pointer !== event.pointerId || !toPicture) return null;
    const moved = now.moved || Math.hypot(event.clientX - now.x, event.clientY - now.y) > 4;
    const spot = toPicture(event.clientX, event.clientY);
    if (!moved || !spot) return { ...now, moved };
    return { ...now, moved, at: { x: Math.max(0, Math.min(100, now.start.x + spot.x - now.from.x)), y: Math.max(0, Math.min(100, now.start.y + spot.y - now.from.y)) } };
  };
  const marks = items.filter(note => note.anchor.type === 'map_point' && Number.isFinite(note.anchor.x) && Number.isFinite(note.anchor.y));
  const show = (id: string) => openCommentThread(scope, id);
  return <>{marks.map((note, index) => {
    const at = drag?.id === note.id ? drag.at : { x: note.anchor.x!, y: note.anchor.y! };
    return <div key={note.id} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(note.id); } }} className={`absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border shadow ${failed === note.id ? 'border-danger' : 'border-white/40'} ${note.resolvedAt ? 'bg-elevated text-text-muted' : 'bg-accent-gold text-deep'} ${isThreadUnread(note) ? 'ring-2 ring-danger' : ''} ${toPicture ? 'cursor-grab' : ''}`}
      style={{ left: `${at.x}%`, top: `${at.y}%`, touchAction: 'none' }} title={note.noteBody || copy.commentHere} aria-label={`${copy.commentHere} ${index + 1}: ${note.noteBody ?? ''}`}
      onPointerDown={event => {
        event.stopPropagation(); dragged.current = false;
        if (!toPicture || event.button !== 0) return;
        event.preventDefault(); // no mouse events follow, so the map does not start panning under the marker
        const from = toPicture(event.clientX, event.clientY); if (!from) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = { x: note.anchor.x!, y: note.anchor.y! };
        held.current = { id: note.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, from, start, at: start, moved: false };
        setDrag(held.current); onDragging?.(true);
      }}
      onPointerMove={event => { const next = follow(event); if (next) { held.current = next; setDrag(next); } }}
      onPointerUp={async event => {
        // Read the gesture from the ref and this event: moves arrive coalesced, so the last
        // render may not have seen them yet.
        const done = follow(event) ?? (held.current?.pointer === event.pointerId ? held.current : null);
        if (!done || done.id !== note.id) return;
        held.current = null; setDrag(null); onDragging?.(false);
        dragged.current = true;
        if (!done.moved) { show(note.id); return; }
        try { await mutateAnnotationThread(scope, note.id, note.revision ?? 0, { kind: 'move', x: done.at.x, y: done.at.y }); setFailed(null); await refresh(); }
        catch { setFailed(note.id); }
      }}
      onPointerCancel={() => { held.current = null; setDrag(null); onDragging?.(false); }}
      onClick={event => { event.stopPropagation(); if (dragged.current) { dragged.current = false; return; } show(note.id); }} data-testid={`map-comment-${note.id}`} data-unread={isThreadUnread(note) ? 'true' : undefined} data-drag={drag?.id === note.id ? (drag.moved ? 'moving' : 'pressed') : undefined}><MessageSquare size={12} /></div>;
  })}</>;
}
