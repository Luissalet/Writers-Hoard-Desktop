import { useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, FolderInput, Palette, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { NOTE_COLORS, NOTE_KIND_META, type Note } from '../types';
import NoteRichEditor from './NoteRichEditor';
import { hasNoteContent, plainNoteHtml } from '../content';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';

interface NoteCardProps {
  note: Note;
  onUpdate: (id: string, changes: Partial<Note>) => Promise<void> | void;
  onDevelop?: (note: Note) => void;
  onDelete: (id: string) => void;
  /** Projects the note can be moved into. Empty → the action is hidden. */
  moveTargets?: { id: string; title: string }[];
  onMove?: (id: string, projectId: string) => void;
  onTagClick?: (tag: string) => void;
  deepLinkToken?: string | null;
}

export default function NoteCard({
  note,
  onUpdate,
  onDevelop,
  onDelete,
  moveTargets = [],
  onMove,
  onTagClick,
  deepLinkToken = null,
}: NoteCardProps) {
  const { t, locale } = useTranslation();
  const es = locale !== 'en';
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(note.title ?? ''), [draftCover, setDraftCover] = useState(note.cover), [coverError, setCoverError] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [draftRich,setDraftRich]=useState(note.richHtml);
  const [draftSource, setDraftSource] = useState(note.source ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveLock = useRef(false);

  const { icon: KindIcon, color: kindColor } = NOTE_KIND_META[note.kind];
  const accent = note.color ?? kindColor;

  if (deepLinkToken !== appliedDeepLink) {
    setAppliedDeepLink(deepLinkToken);
    if (deepLinkToken) {
      setDraft(note.text);
      setDraftRich(note.richHtml);
      setDraftSource(note.source ?? '');
      setDraftTitle(note.title ?? ''); setDraftCover(note.cover);
      setEditing(true);
    }
  }

  const startEdit = () => {
    setDraft(note.text);
    setDraftRich(note.richHtml);
    setDraftSource(note.source ?? '');
    setDraftTitle(note.title ?? ''); setDraftCover(note.cover); setCoverError(false);
    setEditing(true);
  };

  const update = async (changes: Partial<Note>): Promise<boolean> => {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onUpdate(note.id, changes);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const commit = async () => {
    const text = draft.trim();
    if (!hasNoteContent(text,draftRich)) {
      setEditing(false);
      return;
    }
    if (await update({ text, richHtml:draftRich, source: draftSource.trim() || undefined, title: draftTitle.trim().slice(0, 200) || undefined, cover: draftCover })) setEditing(false);
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
      data-note-id={note.id}
      className="break-inside-avoid mb-3 rounded-xl border bg-surface hover:border-accent-gold/40 transition group relative"
      style={{ borderColor: `${accent}40`, boxShadow: `inset 3px 0 0 0 ${accent}` }}
    >
      <div className="p-3.5" inert={saving}>
        {saveFailed && <p role="alert" className="mb-2 text-sm text-danger">{t('notes.saveFailed')}</p>}
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
              onClick={() => { void update({ pinned: !note.pinned }); }}
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
                  void update({ color: c });
                  setShowColors(false);
                }}
                className="w-4 h-4 rounded-full border border-black/30 hover:scale-110 transition"
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              onClick={() => {
                  void update({ color: undefined });
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
            {draftCover && <div className="relative"><img src={draftCover} alt="" className="max-h-40 w-full rounded-lg object-cover" /><button type="button" className="absolute right-1 top-1 rounded bg-deep/80 px-2 py-0.5 text-[11px] text-text-primary" data-testid="note-cover-remove" onClick={() => setDraftCover(undefined)}>{es ? 'Quitar portada' : 'Remove cover'}</button></div>}
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder={es ? 'Título (opcional)' : 'Title (optional)'} aria-label={es ? 'Título' : 'Title'} data-testid="note-title" maxLength={200} className="w-full px-2.5 py-1.5 bg-elevated border border-border rounded-lg text-sm font-semibold text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition" />
            <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-text-muted hover:text-text-primary">{draftCover ? (es ? 'Cambiar portada' : 'Change cover') : (es ? 'Añadir portada' : 'Add cover')}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/gif,image/webp" data-testid="note-cover" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 1_500_000) { setCoverError(true); return; } const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') { setDraftCover(reader.result); setCoverError(false); } }; reader.readAsDataURL(file); }} /></label>
            {coverError && <p role="alert" className="text-[11px] text-danger">{es ? 'La portada debe ser PNG, JPEG, GIF o WebP de hasta 1,5 MB.' : 'The cover must be a PNG, JPEG, GIF or WebP up to 1.5 MB.'}</p>}
            <label className="flex min-h-9 items-center gap-2 text-xs text-text-muted"><input type="checkbox" data-testid="note-rich-toggle" checked={draftRich!==undefined} onChange={event=>setDraftRich(event.target.checked?plainNoteHtml(draft):undefined)}/>{es?'Texto enriquecido':'Rich text'}</label>
            {draftRich!==undefined?<NoteRichEditor key={note.id} html={draftRich} onChange={(plain,html)=>{setDraft(plain);setDraftRich(html);}}/>:<textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              rows={4}
              className="w-full px-2.5 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />}
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
            {note.cover && <img src={note.cover} alt="" className="mb-2 max-h-40 w-full rounded-lg object-cover" data-testid="note-cover-image" />}
            {note.title && <p className="mb-1 text-base font-semibold text-text-primary" data-testid="note-title-shown">{note.title}</p>}
            {note.richHtml!==undefined?<div className="tiptap-editor prose prose-sm max-w-none break-words text-text-primary" data-note-rich-read dangerouslySetInnerHTML={sanitizedHtml(note.richHtml)}/>:<p
              className={`text-sm text-text-primary whitespace-pre-wrap leading-relaxed ${
                note.kind === 'quote' ? 'font-serif italic' : ''
              }`}
            >
              {note.text}
            </p>}
          </button>
        )}

        {note.source && !editing && (
          <p className="text-xs text-text-muted mt-2">— {note.source}</p>
        )}
        {!editing && (note.title || note.cover) && <p className="mt-1 text-[11px] text-text-dim" data-testid="note-word-count">{(() => { const words = note.text.trim().split(/\s+/).filter(Boolean).length; return es ? `${words} palabra${words === 1 ? '' : 's'}` : `${words} word${words === 1 ? '' : 's'}`; })()}</p>}

        {onDevelop && !editing && <button type="button" onClick={() => onDevelop(note)} className="mt-3 flex items-center gap-1.5 py-1 text-sm text-accent-gold hover:underline"><ArrowUpRight size={14} aria-hidden="true" />{t('notes.developIdea')}</button>}

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
