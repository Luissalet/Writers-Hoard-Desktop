// ============================================
// MarginPanel — Google-Docs-style note column
// ============================================
//
// Mounts in the right gutter of any annotatable view (writings editor,
// codex entry, seed detail, map pin, yarnboard card). Lists existing notes
// for the entity and hosts the "Add note" button.
//
// Callers own the host-side state (the selection range, if any). The panel
// exposes an imperative-ish `onAddNoteForSelection` prop if the host needs
// to seed a text-range anchor from the current selection; otherwise the
// panel creates entity-level anchors on its own "Add note" button.

import { useCallback, useState } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAnnotationsForEntity } from '../hooks';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import CommentThreadList from './CommentThreadList';
import NoteCreator from './NoteCreator';
import type { AnnotationAnchor, NoteType } from '../types';

export interface MarginPanelProps {
  projectId: string;
  engineId: string;
  entityId: string;
  /**
   * Optional: a selection-derived anchor the host has staged. When non-null,
   * a composer auto-opens with this anchor. Host should null this after the
   * note is created or cancelled.
   */
  pendingAnchor?: AnnotationAnchor | null;
  onPendingAnchorConsumed?: () => void;
  /** Optional title override for the panel header. */
  title?: string;
  /** Hide the "Add note" button — useful when host provides its own trigger. */
  hideAddButton?: boolean;
}

export default function MarginPanel({
  projectId,
  engineId,
  entityId,
  pendingAnchor,
  onPendingAnchorConsumed,
  title,
  hideAddButton,
}: MarginPanelProps) {
  const { t,locale } = useTranslation();
  const scope=useWorldEraScope(projectId);
  const { items, refresh } = useAnnotationsForEntity({ engineId, entityId,projectId });
  const [composing, setComposing] = useState<null | {
    anchor: AnnotationAnchor;
    defaultType: NoteType;
  }>(null);

  // If the host staged a selection-derived anchor, auto-open the composer.
  // Render-adjust pattern: setState during render runs exactly one extra
  // pass (composing becomes non-null, the condition goes false) — no loop,
  // and no cascading effect render.
  if (pendingAnchor && !composing) {
    setComposing({ anchor: pendingAnchor, defaultType: 'text' });
  } else if ((pendingAnchor?.type === 'map_point' || pendingAnchor?.type === 'board_point' || pendingAnchor?.elementId) && composing && composing.anchor !== pendingAnchor) {
    // A second spot picked on the map or board while the composer is open moves the note there.
    setComposing({ anchor: pendingAnchor, defaultType: composing.defaultType });
  }

  const handleAddEntityLevel = useCallback(() => {
    setComposing({
      anchor: { type: 'entity' },
      defaultType: 'text',
    });
  }, []);

  const handleCreated = useCallback(async () => {
    setComposing(null);
    onPendingAnchorConsumed?.();
    await refresh();
  }, [onPendingAnchorConsumed, refresh]);

  const handleCancel = useCallback(() => {
    setComposing(null);
    onPendingAnchorConsumed?.();
  }, [onPendingAnchorConsumed]);

  // One past the highest position, not the count: after a delete the count
  // can be lower than the last note's position, and the new note would sort
  // in among the existing ones instead of at the end.
  const nextPosition = items.reduce((max, ann) => Math.max(max, ann.position ?? -1), -1) + 1;

  return (
    <aside className="w-full space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
          <MessageSquare size={12} />
          {title ?? t('annotations.panel.title')}
          <span className="text-text-muted">· {items.length}</span>
        </h3>
        {!hideAddButton && !composing && (
          <button
            onClick={handleAddEntityLevel}
            className="flex min-h-9 items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-border text-text-secondary hover:text-accent-gold hover:border-accent-gold/60 transition"
          >
            <Plus size={11} />
            {t('annotations.panel.addNote')}
          </button>
        )}
      </header>

      <p className="text-xs text-text-muted">{scope.eraId?(locale==='es'?'Comentarios de esta era':'Comments in this era'):(locale==='es'?'Comentarios de Base compartida':'Shared base comments')}</p>
      {composing && (
        <NoteCreator
          key={JSON.stringify([scope.projectId,scope.eraId,engineId,entityId])}
          projectId={projectId} eraId={scope.eraId}
          sourceEngineId={engineId}
          sourceEntityId={entityId}
          anchor={composing.anchor}
          defaultType={composing.defaultType}
          position={nextPosition}
          onCreated={handleCreated}
          onCancel={handleCancel}
        />
      )}

      <CommentThreadList key={`threads:${JSON.stringify([scope.projectId,scope.eraId,engineId,entityId])}`} items={items} scope={scope}/>
    </aside>
  );
}
