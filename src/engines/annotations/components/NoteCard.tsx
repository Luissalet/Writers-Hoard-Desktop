// ============================================
// NoteCard — one annotation in the margin panel
// ============================================
//
// Three flavors:
//   - text       — markdown body, inline-edit on click
//   - image      — preview thumbnail
//   - reference  — engine chip with jump-to button
//
// Header carries: anchor snippet (truncated), orphan flag, delete menu.

import { useState } from 'react';
import { Trash2, AlertTriangle, FileText, Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ReferenceChip from './ReferenceChip';
import type { AnnotationWithReference } from '../types';

export interface NoteCardProps {
  annotation: AnnotationWithReference;
  onUpdate: (id: string, body: string) => void;
  onDelete: (id: string) => void;
}

export default function NoteCard({ annotation, onUpdate, onDelete }: NoteCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(annotation.noteBody ?? '');

  const snippet = annotation.anchor.selectedText;

  return (
    <article className="rounded-lg border border-border bg-bg-elevated/60 p-3 space-y-2 shadow-sm">
      {/* Header */}
      <header className="flex items-start gap-2">
        <NoteTypeIcon type={annotation.noteType} />
        <div className="flex-1 min-w-0">
          {snippet && (
            <div
              className="text-[11px] text-text-secondary border-l-2 border-accent-gold/60 pl-2 italic truncate"
              title={snippet}
            >
              "{snippet}"
            </div>
          )}
        </div>
        {annotation.isOrphaned && (
          <span
            className="text-[10px] uppercase tracking-wide text-amber-400 flex items-center gap-1 flex-shrink-0"
            title={t('annotations.card.orphanHint')}
          >
            <AlertTriangle size={10} />
            {t('annotations.card.orphan')}
          </span>
        )}
        <button
          onClick={() => onDelete(annotation.id)}
          className="p-1 text-text-muted hover:text-red-400 transition flex-shrink-0"
          aria-label={t('common.delete')}
        >
          <Trash2 size={12} />
        </button>
      </header>

      {/* Body */}
      {annotation.noteType === 'text' && (
        editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full min-h-[60px] rounded-md border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-gold"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => {
                  setDraft(annotation.noteBody ?? '');
                  setEditing(false);
                }}
                className="text-[11px] text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  onUpdate(annotation.id, draft);
                  setEditing(false);
                }}
                className="text-[11px] text-accent-gold hover:underline"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            className="text-sm text-text-primary whitespace-pre-wrap cursor-text min-h-[20px]"
          >
            {annotation.noteBody || (
              <span className="text-text-muted italic">{t('annotations.card.emptyText')}</span>
            )}
          </p>
        )
      )}

      {annotation.noteType === 'image' && annotation.noteImageUrl && (
        <img
          src={annotation.noteImageUrl}
          alt=""
          className="max-h-48 w-full object-contain rounded-md border border-border"
        />
      )}

      {annotation.noteType === 'reference' && annotation.reference && (
        <ReferenceChip
          targetEngineId={annotation.reference.targetEngineId}
          targetEntityId={annotation.reference.targetEntityId}
        />
      )}

      {annotation.noteType === 'reference' && !annotation.reference && (
        <div className="text-xs text-text-muted italic">
          {t('annotations.card.referenceMissing')}
        </div>
      )}
    </article>
  );
}

function NoteTypeIcon({ type }: { type: AnnotationWithReference['noteType'] }) {
  if (type === 'image') return <ImageIcon size={13} className="text-text-secondary mt-0.5" />;
  if (type === 'reference') return <LinkIcon size={13} className="text-accent-gold mt-0.5" />;
  return <FileText size={13} className="text-text-secondary mt-0.5" />;
}
