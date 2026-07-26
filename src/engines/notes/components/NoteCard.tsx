import { useRef, useState } from 'react';
import { Check, Copy, FolderInput, Palette, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { NOTE_COLORS, NOTE_KIND_META, type Note } from '../types';

interface NoteCardProps {
  note: Note;
  onUpdate: (id: string, changes: Partial<Note>) => void;
  onDelete: (id: string) => void;
  /** Projects the note can be moved into. Empty → the action is hidden. */
  moveTargets?: { id: string; title: string }[];
  onMove?: (id: string, projectId: string) => void;
  onTagClick?: (tag: string) => void;
}

export default function NoteCard({
  note,
  onUpdate,
  onDelete,
  moveTargets = [],
  onMove,
  onTagClick,
}: NoteCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [draftSource, setDraftSource] = useState(note.source ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const { icon: KindIcon, color: kindColor } = NOTE_KIND_META[note.kind];
  const accent = note.color ?? kindColor;

  const startEdit = () => {
    setDraft(note.text);
    setDraftSource(note.source ?? '');
    setEditing(true);
  };

  const commit = () => {
    const text = draft.trim();
    if (!text) {
      setEditing(false);
      return;
    }
    onUpdate(note.id, { text, source: draftSource.trim() || undefined });
    setEditing(false);
  };

  const copy = () => {
    const payload = note.source ? `${note.text}\n— ${note.source}` : note.text;
    void navigator.clipboard.writeText(payload).then(() => {
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="break-inside-avoid mb-3 rounded-xl border bg-surface hover:border-accent-gold/40 transition group relative"
      style={{ borderColor: `${accent}40`, boxShadow: `inset 3px 0 0 0 ${accent}` }}
    >
      <div className="p-3.5">
        {/* Header: kind + actions */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold"
            style={{ color: accent }}
          >
            <KindIcon size={13} />
            {t(`notes.kind.${note.kind}`)}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
            <button
              onClick={() => onUpdate(note.id, { pinned: !note.pinned })}
              className="p-1.5 hover:bg-elevated rounded transition"
              title={note.pinned ? t('notes.unpin') : t('notes.pin')}
            >
              {note.pinned ? (
                <PinOff size={13} className="text-text-muted" />
              ) : (
                <Pin size={13} className="text-text-muted" />
              )}
            </button>
            <button
              onClick={copy}
              className="p-1.5 hover:bg-elevated rounded transition"
              title={t('notes.copy')}
            >
              {copied ? (
                <Check size={13} className="text-success" />
              ) : (
                <Copy size={13} className="text-text-muted" />
              )}
            </button>
            <button
              onClick={() => {
                setShowColors((v) => !v);
                setShowMove(false);
              }}
              className="p-1.5 hover:bg-elevated rounded transition"
              title={t('notes.color')}
            >
              <Palette size={13} className="text-text-muted" />
            </button>
            {moveTargets.length > 0 && onMove && (
              <button
                onClick={() => {
                  setShowMove((v) => !v);
                  setShowColors(false);
                }}
                className="p-1.5 hover:bg-elevated rounded transition"
                title={t('notes.moveTo')}
              >
                <FolderInput size={13} className="text-text-muted" />
              </button>
            )}
            <button
              onClick={startEdit}
              className="p-1.5 hover:bg-elevated rounded transition"
              title={t('common.edit')}
            >
              <Pencil size={13} className="text-text-muted" />
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              className="p-1.5 hover:bg-danger/20 rounded transition"
              title={t('common.delete')}
            >
              <Trash2 size={13} className="text-danger" />
            </button>
          </div>
        </div>

        {/* Pinned marker stays visible without hover */}
        {note.pinned && !editing && (
          <Pin size={12} className="absolute top-3.5 right-3.5 text-accent-gold group-hover:opacity-0 transition" />
        )}

        {showColors && (
          <div className="flex items-center gap-1.5 mb-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onUpdate(note.id, { color: c });
                  setShowColors(false);
                }}
                className="w-4 h-4 rounded-full border border-black/30 hover:scale-110 transition"
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              onClick={() => {
                onUpdate(note.id, { color: undefined });
                setShowColors(false);
              }}
              className="text-[11px] text-text-dim hover:text-text-primary transition ml-1"
            >
              {t('common.resetDefault')}
            </button>
          </div>
        )}

        {showMove && onMove && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-elevated">
            {moveTargets.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onMove(note.id, p.id);
                  setShowMove(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface transition truncate"
              >
                {p.title}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              rows={4}
              className="w-full px-2.5 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
            <input
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              placeholder={t('notes.sourcePlaceholder')}
              className="w-full px-2.5 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={commit}
                className="px-3 py-1 bg-accent-gold text-deep text-xs font-semibold rounded-lg hover:bg-accent-amber transition"
              >
                {t('common.save')}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="p-1 text-text-muted hover:text-text-primary transition"
                title={t('common.cancel')}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="w-full text-left"
          >
            <p
              className={`text-sm text-text-primary whitespace-pre-wrap leading-relaxed ${
                note.kind === 'quote' ? 'font-serif italic' : ''
              }`}
            >
              {note.text}
            </p>
          </button>
        )}

        {note.source && !editing && (
          <p className="text-xs text-text-muted mt-2">— {note.source}</p>
        )}

        {note.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-2.5">
            {note.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick?.(tag)}
                className="px-2 py-0.5 rounded-full bg-accent-plum-light/12 text-accent-plum-light text-[11px] hover:bg-accent-plum-light/25 transition"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        destructive
        message={t('notes.deleteConfirm')}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete(note.id);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
