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

import { useCallback, useEffect, useState } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAnnotationsForEntity } from '../hooks';
import { deleteAnnotation, updateAnnotation } from '../operations';
import NoteCard from './NoteCard';
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
  const { t } = useTranslation();
  const { items, refresh } = useAnnotationsForEntity({ engineId, entityId });
  const [composing, setComposing] = useState<null | {
    anchor: AnnotationAnchor;
    defaultType: NoteType;
  }>(null);

  // If the host staged a selection-derived anchor, auto-open the composer.
  // Use an effect so we don't update state during render — running per-render
  // would loop until composing != null.
  useEffect(() => {
    if (pendingAnchor && !composing) {
      setComposing({ anchor: pendingAnchor, defaultType: 'text' });
    }
  }, [pendingAnchor, composing]);

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

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteAnnotation(id);
      await refresh();
    },
    [refresh],
  );

  const handleUpdateBody = useCallback(
    async (id: string, body: string) => {
      await updateAnnotation(id, { noteBody: body });
      await refresh();
    },
    [refresh],
  );

  const nextPosition = items.length;

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
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-border text-text-secondary hover:text-accent-gold hover:border-accent-gold/60 transition"
          >
            <Plus size={11} />
            {t('annotations.panel.addNote')}
          </button>
        )}
      </header>

      {composing && (
        <NoteCreator
          projectId={projectId}
          sourceEngineId={engineId}
          sourceEntityId={entityId}
          anchor={composing.anchor}
          defaultType={composing.defaultType}
          position={nextPosition}
          onCreated={handleCreated}
          onCancel={handleCancel}
        />
      )}

      {items.length === 0 && !composing ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-secondary">
          {t('annotations.panel.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((ann) => (
            <li key={ann.id}>
              <NoteCard
                annotation={ann}
                onUpdate={handleUpdateBody}
                onDelete={handleDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
