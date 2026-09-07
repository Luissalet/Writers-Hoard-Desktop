import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';

// Same chrome as the diary editor's inputs, so the atlas does not look like a
// different app from the tab next to it.
export const inputClass =
  'w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition';
export const textareaClass = `${inputClass} resize-y leading-relaxed`;
export const selectClass = `${inputClass} cursor-pointer`;
export const labelClass = 'block mb-1 text-[11px] uppercase tracking-wide text-text-dim';

/** A labelled form row. Wrapping in <label> gives click-to-focus without ids. */
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

interface EditorHeaderProps {
  title: string;
  saveLabel: string;
  /** False while there is nothing new to write, or the draft is invalid. */
  canSave: boolean;
  onSave: () => Promise<void>;
  deleteLabel: string;
  deleteConfirm: string;
  onDelete: () => Promise<void>;
}

/**
 * Title row shared by both editors: the name as it will be saved, the delete
 * icon behind a ConfirmDialog (never window.confirm — tasks/lessons.md #12),
 * and Save. `saving` lives here so a slow write cannot be double-submitted.
 */
export function EditorHeader({ title, saveLabel, canSave, onSave, deleteLabel, deleteConfirm, onDelete }: EditorHeaderProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="min-w-0 truncate font-serif text-xl font-semibold text-text-primary">{title}</h2>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setPendingDelete(true)}
          title={deleteLabel}
          className="p-2 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition"
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !canSave}
          className="px-4 py-1.5 text-sm font-semibold bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? t('common.saving') : saveLabel}
        </button>
      </div>
      {canSave && <p className="w-full text-xs text-text-muted">{t('realAtlas.draftKept')}</p>}
      {saveFailed && <p role="alert" className="w-full text-sm text-danger">{t('common.saveFailed')}</p>}
      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={deleteConfirm}
        onConfirm={async () => {
          setPendingDelete(false);
          await onDelete();
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
