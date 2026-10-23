import { useRef, useState } from 'react';
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import { useAnnotationsForEntity } from '@/engines/annotations/hooks';
import { mutateAnnotationThread } from '@/engines/annotations/threads';
import { openCommentThread } from '@/engines/annotations/openThread';
import { isThreadUnread } from '@/engines/annotations/readState';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useTranslation } from '@/i18n/useTranslation';

interface Held { id: string; pointer: number; x: number; y: number; from: { x: number; y: number }; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean }

/**
 * Comments left at a point of the canvas. The pin is drawn in board
 * coordinates inside the viewport layer, so it stays on its spot through pan,
 * zoom and reload; its size is cancelled against the zoom so it stays a
 * readable bubble. Clicking opens its thread (and counts it as read); dragging
 * moves it, saved with the thread's revision so a thread changed meanwhile
 * elsewhere is not overwritten.
 */
export default function BoardCommentPins({ projectId, boardId }: { projectId: string; boardId: string }) {
  const { locale } = useTranslation();
  const es = locale === 'es';
  const scope = useWorldEraScope(projectId);
  const flow = useReactFlow();
  const zoom = useStore(state => state.transform[2]);
  const { items, refresh } = useAnnotationsForEntity({ engineId: 'board', entityId: boardId, projectId });
  const [drag, setDrag] = useState<Held | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const held = useRef<Held | null>(null);
  const dragged = useRef(false);
  const pins = items.filter(note => note.anchor.type === 'board_point' && Number.isFinite(note.anchor.x) && Number.isFinite(note.anchor.y));
  if (!pins.length) return null;
  const label = es ? 'Comentario en el tablero' : 'Board comment';
  const follow = (event: { pointerId: number; clientX: number; clientY: number }): Held | null => {
    const now = held.current;
    if (!now || now.pointer !== event.pointerId) return null;
    const moved = now.moved || Math.hypot(event.clientX - now.x, event.clientY - now.y) > 4;
    if (!moved) return { ...now, moved };
    const spot = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    return { ...now, moved, at: { x: now.start.x + spot.x - now.from.x, y: now.start.y + spot.y - now.from.y } };
  };
  return (
    <ViewportPortal>
      {pins.map((note, index) => {
        const at = drag?.id === note.id ? drag.at : { x: note.anchor.x!, y: note.anchor.y! };
        const unread = isThreadUnread(note);
        return (
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            data-testid={`board-comment-pin-${note.id}`}
            data-unread={unread ? 'true' : undefined}
            data-drag={drag?.id === note.id ? (drag.moved ? 'moving' : 'pressed') : undefined}
            title={note.noteBody || label}
            aria-label={`${label} ${index + 1}: ${note.noteBody ?? ''}`}
            className={`nopan nodrag flex cursor-grab items-center justify-center rounded-full rounded-bl-none border shadow ${failed === note.id ? 'border-danger' : 'border-white/40'} ${note.resolvedAt ? 'bg-elevated text-text-muted' : 'bg-accent-gold text-deep'} ${unread ? 'ring-2 ring-danger' : ''}`}
            style={{ position: 'absolute', width: 24, height: 24, left: at.x, top: at.y, zIndex: 1000, touchAction: 'none', pointerEvents: 'auto', transform: `translate(-50%, -100%) scale(${1 / Math.max(0.05, zoom)})`, transformOrigin: '50% 100%' }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCommentThread(scope, note.id); } }}
            onPointerDown={event => {
              event.stopPropagation();
              dragged.current = false;
              if (event.button !== 0) return;
              event.preventDefault();
              const from = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a pointer that is already gone: the drag still follows the events it receives */ }
              const start = { x: note.anchor.x!, y: note.anchor.y! };
              held.current = { id: note.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, from, start, at: start, moved: false };
              setDrag(held.current);
            }}
            onPointerMove={event => { const next = follow(event); if (next) { held.current = next; setDrag(next); } }}
            onPointerUp={async event => {
              const done = follow(event) ?? (held.current?.pointer === event.pointerId ? held.current : null);
              if (!done || done.id !== note.id) return;
              held.current = null;
              setDrag(null);
              // The captured pointer may suppress the follow-up click after the
              // drag preview is removed. Finish a tap here as well as a drag.
              dragged.current = true;
              if (!done.moved) { openCommentThread(scope, note.id); return; }
              try {
                await mutateAnnotationThread(scope, note.id, note.revision ?? 0, { kind: 'move', x: Math.round(done.at.x * 100) / 100, y: Math.round(done.at.y * 100) / 100 });
                setFailed(null);
                await refresh();
              } catch { setFailed(note.id); }
            }}
            onPointerCancel={() => { held.current = null; setDrag(null); }}
            onClick={event => { event.stopPropagation(); if (dragged.current) { dragged.current = false; return; } openCommentThread(scope, note.id); }}
            onContextMenu={event => event.stopPropagation()}
          >
            <MessageSquare size={12} />
          </div>
        );
      })}
    </ViewportPortal>
  );
}
