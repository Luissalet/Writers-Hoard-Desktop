import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Plus, Trash2, LocateFixed, Superscript } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { shortcutCaps } from '@/components/common/shortcuts';
import { useFootnotes } from './useFootnotes';
import type { FootnoteMarkerStyle, FootnotePlacement } from '@/types';
import {
  FOOTNOTE_MARKER_STYLES,
  FOOTNOTE_PLACEMENTS,
  findFootnote,
  formatFootnoteMarker,
  type FootnoteRef,
} from './footnoteModel';

/**
 * Every footnote of the open document, in the margin.
 *
 * Reads the live editor through `useFootnotes`, so the list follows the
 * prose: a note dragged past another renumbers here as it does in the text.
 * Edits go back through the same commands the popover uses — there is one
 * way to change a note, and both surfaces are views of it.
 *
 * "Go to" resolves the note's position at click time rather than trusting
 * the one collected: the list is deliberately not refreshed for edits that
 * only move notes, and a position from before those edits would land the
 * selection in the wrong place.
 */

interface FootnotesPanelProps {
  editor: Editor | null;
  /** The manuscript's marker style; the rows print their marker in it. */
  style?: FootnoteMarkerStyle;
  /** When given, the header offers the style choice (numbers, symbols, roman, letters). */
  onStyleChange?: (style: FootnoteMarkerStyle) => void;
  /** Where the exports put the notes: after each chapter, or at the end of the book. */
  placement?: FootnotePlacement;
  /** When given, the header offers the placement choice. */
  onPlacementChange?: (placement: FootnotePlacement) => void;
}

/**
 * The chord as the keyboard prints it: Ctrl+Alt+F, or ⌘⌥⇧F on a Mac — read
 * from the shortcut table by id, so the panel and the shortcuts sheet can
 * never disagree about which keys make a note.
 */
function shortcutLabel(t: (key: string) => string): string {
  const caps = shortcutCaps('editor.footnote')[0] ?? [];
  const words = caps.map((cap) => (cap.localeKey ? t(cap.localeKey) : cap.text));
  return words.some((word) => word.length > 1) ? words.join('+') : words.join('');
}

// Module scope, like `ToolButton` in TiptapEditor: a component created inside
// another remounts its field on every render and drops the caret.
function FootnoteRow({ editor, note, style }: { editor: Editor; note: FootnoteRef; style: FootnoteMarkerStyle }) {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
  }, [note.text]);

  const goTo = () => {
    const found = findFootnote(editor.state.doc, note.id);
    if (!found) return;
    editor.chain().focus().setNodeSelection(found.pos).scrollIntoView().run();
  };

  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-elevated/60 p-2">
      <span className="mt-1.5 w-5 flex-shrink-0 text-right text-[11px] font-semibold tabular-nums text-accent-gold">
        {formatFootnoteMarker(note.index, style)}
      </span>
      <textarea
        ref={fieldRef}
        value={note.text}
        rows={1}
        placeholder={t('writings.footnotes.placeholder')}
        aria-label={`${t('writings.footnotes.note')} ${note.index}`}
        onChange={(event) => editor.commands.setFootnoteText(note.id, event.target.value)}
        className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-snug text-text-primary outline-none rounded focus:bg-deep/60 transition"
      />
      <div className="flex flex-shrink-0 flex-col gap-0.5">
        <button
          type="button"
          onClick={goTo}
          title={t('writings.footnotes.goTo')}
          aria-label={t('writings.footnotes.goTo')}
          className="p-1 rounded text-text-muted hover:text-accent-gold hover:bg-elevated transition"
        >
          <LocateFixed size={13} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().removeFootnote(note.id).run()}
          title={t('common.delete')}
          aria-label={t('common.delete')}
          className="p-1 rounded text-text-muted hover:text-danger hover:bg-elevated transition"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

export default function FootnotesPanel({
  editor,
  style = 'numbers',
  onStyleChange,
  placement = 'chapter',
  onPlacementChange,
}: FootnotesPanelProps) {
  const { t } = useTranslation();
  const notes = useFootnotes(editor);
  if (!editor) return null;

  const add = () => editor.chain().focus().insertFootnote().run();
  const shortcut = shortcutLabel(t);
  const emptyHint = t('writings.footnotes.empty').replace('{shortcut}', shortcut);

  return (
    <aside className="w-full space-y-2" aria-label={t('writings.footnotes.panelTitle')}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-text-muted">
          <Superscript size={12} className="flex-shrink-0" />
          <span className="truncate">{t('writings.footnotes.panelTitle')}</span>
          {notes.length > 0 ? (
            <span className="text-text-dim">· {notes.length}</span>
          ) : (
            // Folded to this one line while there is nothing to list: how to
            // make the first note, and the key that does it.
            <span className="truncate shrink-[3] normal-case tracking-normal text-text-dim" title={emptyHint}>
              — {emptyHint}
            </span>
          )}
        </h3>
        {/* Icon-only while empty, so the hint beside it keeps its line. */}
        <button
          type="button"
          onClick={add}
          title={`${t('writings.footnotes.add')} (${shortcut})`}
          aria-label={t('writings.footnotes.add')}
          className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:border-accent-gold/60 hover:text-accent-gold"
        >
          <Plus size={11} />
          {notes.length > 0 && t('writings.footnotes.add')}
        </button>
      </header>

      {/* Marker style is a property of the manuscript, chosen where the notes
          are: the writer thinking about footnotes is the one who cares whether
          they read 1 2 3 or * † ‡. */}
      {onStyleChange && notes.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-text-dim">
          <span className="flex-shrink-0">{t('writings.footnotes.style')}</span>
          <select
            value={style}
            onChange={(e) => onStyleChange(e.target.value as FootnoteMarkerStyle)}
            className="min-w-0 flex-1 rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] text-text-primary outline-none focus:border-accent-gold"
          >
            {FOOTNOTE_MARKER_STYLES.map((option) => (
              <option key={option} value={option}>
                {t(`writings.footnotes.style.${option}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Where the notes go is the exports' business — the editor and page
          mode always show them where the writer is — but it is decided here
          too, beside the style, for the same reason. */}
      {onPlacementChange && notes.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-text-dim">
          <span className="flex-shrink-0">{t('writings.footnotes.placement')}</span>
          <select
            value={placement}
            onChange={(e) => onPlacementChange(e.target.value as FootnotePlacement)}
            className="min-w-0 flex-1 rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] text-text-primary outline-none focus:border-accent-gold"
          >
            {FOOTNOTE_PLACEMENTS.map((option) => (
              <option key={option} value={option}>
                {t(`writings.footnotes.placement.${option}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {notes.length > 0 && (
        <ol className="space-y-1.5">
          {notes.map((note) => (
            <FootnoteRow key={note.id} editor={editor} note={note} style={style} />
          ))}
        </ol>
      )}
    </aside>
  );
}
