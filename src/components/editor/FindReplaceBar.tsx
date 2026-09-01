import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { useTranslation } from '@/i18n/useTranslation';
import {
  CURRENT_CLASS,
  createSearchPlugin,
  findMatches,
  searchDecorations,
  searchPluginKey,
} from './findReplace';

interface FindReplaceBarProps {
  editor: Editor;
  /** Seeded from the selection when the bar opened. */
  initialQuery: string;
  /** Caret position when the bar opened: a new query starts searching there. */
  anchor: number;
  showReplace: boolean;
  /** Bumped when the shortcut is pressed again — refocus and select the field. */
  focusToken: number;
  onToggleReplace: () => void;
  onClose: () => void;
}

function IconButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="p-1 rounded text-text-muted transition hover:text-text-primary hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}

function Toggle({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`h-5 min-w-[20px] px-1 rounded text-[11px] font-semibold leading-none transition ${
        active
          ? 'bg-accent-gold/20 text-accent-gold'
          : 'text-text-dim hover:text-text-primary hover:bg-elevated'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The find bar for one editor. Mounted only while find is open: the search
 * plugin is registered on mount and removed on unmount, so a document being
 * written to carries no search machinery at all.
 */
export default function FindReplaceBar({
  editor,
  initialQuery,
  anchor,
  showReplace,
  focusToken,
  onToggleReplace,
  onClose,
}: FindReplaceBarProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchDiacritics, setMatchDiacritics] = useState(false);
  const [current, setCurrent] = useState(0);
  // ProseMirror hands back the same document object for transactions that did
  // not change it, so this only ever moves on a real edit.
  const [doc, setDoc] = useState(editor.state.doc);

  useEffect(() => {
    editor.registerPlugin(createSearchPlugin());
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(searchPluginKey);
    };
  }, [editor]);

  useEffect(() => {
    const sync = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setDoc(editor.state.doc);
    };
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor]);

  const options = useMemo(
    () => ({ caseSensitive, wholeWord, matchDiacritics }),
    [caseSensitive, wholeWord, matchDiacritics],
  );
  const matches = useMemo(() => findMatches(doc, query, options), [doc, query, options]);

  // A changed query starts from where the caret was, not from the top of the
  // chapter — the writer is usually looking for the next one, not the first.
  const searchKey = `${caseSensitive}|${wholeWord}|${matchDiacritics}|${query}`;
  // `null` on the first render, so a query seeded from the selection also
  // starts on the occurrence that was selected.
  const [previousKey, setPreviousKey] = useState<string | null>(null);
  if (previousKey !== searchKey) {
    setPreviousKey(searchKey);
    const next = matches.findIndex((match) => match.from >= anchor);
    setCurrent(next === -1 ? 0 : next);
  }
  // The document can shrink under a stale index (Replace all, or the writer
  // typing), so the ordinal is derived rather than trusted.
  const index = matches.length > 0 ? Math.min(current, matches.length - 1) : 0;

  useEffect(() => {
    // Positions belong to the document they were counted in. If a newer one is
    // already in the editor its own render is a beat away; drawing these on it
    // would be drawing them in the wrong places.
    if (editor.isDestroyed || editor.state.doc !== doc) return;
    editor.view.dispatch(searchDecorations(editor.state.tr, matches, index));
    if (matches.length === 0) return;
    // The decoration is the most precise handle on the match — a paragraph
    // would only scroll to the paragraph.
    const frame = window.requestAnimationFrame(() => {
      editor.view.dom
        .querySelector(`.${CURRENT_CLASS}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, doc, matches, index]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  useEffect(() => {
    const bar = barRef.current;
    return () => {
      // Closing from the bar hands the keyboard back to the prose; closing
      // because the editor itself went away must not touch anything.
      if (editor.isDestroyed) return;
      if (bar && bar.contains(document.activeElement)) editor.view.focus();
    };
  }, [editor]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    setCurrent((index + delta + matches.length) % matches.length);
  };

  const replaceCurrent = () => {
    const match = matches[index];
    if (!match || editor.isDestroyed || editor.state.doc !== doc) return;
    // insertText keeps the marks the found text carried, so replacing a word
    // inside an italic line stays italic.
    editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to));
    // Step past what was just written. Without this, replacing "suddenly"
    // with "suddenly," would leave the cursor on a match that still matches,
    // and a second press would write the comma again.
    const remaining = findMatches(editor.state.doc, query, options);
    const next = remaining.findIndex((m) => m.from >= match.from + replacement.length);
    setCurrent(next === -1 ? 0 : next);
  };

  const replaceAll = () => {
    if (matches.length === 0 || editor.isDestroyed || editor.state.doc !== doc) return;
    const tr = editor.state.tr;
    // Back to front: an edit never moves the positions before it, so every
    // range stays valid and the whole pass is a single undo step.
    for (let position = matches.length - 1; position >= 0; position -= 1) {
      tr.insertText(replacement, matches[position].from, matches[position].to);
    }
    editor.view.dispatch(tr);
    setCurrent(0);
  };

  const status = query
    ? matches.length > 0
      ? t('editor.find.count')
          .replace('{current}', String(index + 1))
          .replace('{total}', String(matches.length))
      : t('editor.find.noResults')
    : '';

  return (
    <div
      ref={barRef}
      className="flex flex-col gap-1.5 px-2 py-1.5 border-b border-border bg-surface/70"
    >
      <div className="flex items-center gap-1.5">
        <IconButton
          onClick={onToggleReplace}
          title={showReplace ? t('editor.find.hideReplace') : t('editor.find.showReplace')}
        >
          {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>

        <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-elevated transition focus-within:border-accent-gold">
          <Search size={13} className="text-text-dim flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }}
            placeholder={t('editor.find.placeholder')}
            aria-label={t('editor.find.placeholder')}
            className="flex-1 min-w-0 bg-transparent text-sm text-text-primary outline-none"
          />
          <span className="text-[11px] text-text-dim whitespace-nowrap tabular-nums">{status}</span>
          <Toggle
            active={caseSensitive}
            label="Aa"
            title={t('editor.find.caseSensitive')}
            onClick={() => {
              setCaseSensitive((on) => !on);
              // Keep the keyboard in the field: the next Enter is a
              // jump to the next match, not a second toggle.
              inputRef.current?.focus();
            }}
          />
          <Toggle
            active={wholeWord}
            label="ab"
            title={t('editor.find.wholeWord')}
            onClick={() => {
              setWholeWord((on) => !on);
              inputRef.current?.focus();
            }}
          />
          <Toggle
            active={matchDiacritics}
            label="Á"
            title={t('editor.find.matchDiacritics')}
            onClick={() => {
              setMatchDiacritics((on) => !on);
              inputRef.current?.focus();
            }}
          />
        </div>

        <IconButton
          onClick={() => step(-1)}
          title={t('editor.find.previous')}
          disabled={matches.length === 0}
        >
          <ChevronUp size={14} />
        </IconButton>
        <IconButton
          onClick={() => step(1)}
          title={t('editor.find.next')}
          disabled={matches.length === 0}
        >
          <ChevronDown size={14} />
        </IconButton>
        <IconButton onClick={onClose} title={t('editor.find.close')}>
          <X size={14} />
        </IconButton>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1.5 pl-7">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (event.ctrlKey || event.metaKey) replaceAll();
              else replaceCurrent();
            }}
            placeholder={t('editor.find.replacePlaceholder')}
            aria-label={t('editor.find.replacePlaceholder')}
            className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-elevated text-sm text-text-primary outline-none transition focus:border-accent-gold"
          />
          <button
            type="button"
            onClick={replaceCurrent}
            disabled={matches.length === 0}
            className="px-2.5 py-1 rounded text-xs font-medium text-text-muted border border-border transition hover:text-accent-gold hover:border-accent-gold/40 disabled:opacity-30 disabled:hover:text-text-muted disabled:hover:border-border"
          >
            {t('editor.find.replace')}
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={matches.length === 0}
            className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-gold text-deep transition hover:bg-accent-amber disabled:opacity-30 disabled:hover:bg-accent-gold"
          >
            {t('editor.find.replaceAll')}
          </button>
        </div>
      )}
    </div>
  );
}
