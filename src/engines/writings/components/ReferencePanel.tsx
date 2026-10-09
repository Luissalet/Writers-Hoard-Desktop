// ============================================================================
// ReferencePanel — "Consultar": the codex entries a chapter mentions
// ============================================================================
//
// A collapsible panel beside the manuscript. It lists the codex entries whose
// name or alias occurs in the open chapter (no model: the matcher in
// services/codexReference), shows their essentials, and opens the full entry
// in the panel itself. The editor is never touched: items take focus without
// moving the editor's selection, and Escape hands focus back to it.
//
// "Mentioned" is all it claims. A name in the text is not presence in a scene
// and not a point of view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BookOpen, ChevronLeft, Pin, PinOff, Search, X } from 'lucide-react';
import { useCodexEntries } from '@/engines/codex/hooks';
import { useTranslation } from '@/i18n/useTranslation';
import {
  bodyParagraphs,
  entrySummary,
  findMentions,
  searchEntries,
  type ReferenceMatch,
} from '@/services/codexReference/matcher';
import { onPinsChanged, readPins, setPinned } from '@/services/codexReference/pins';
import type { CodexEntry } from '@/types';
import { stripHtml } from '@/utils/text';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  REFERENCE_NARROW_PX,
  type ReferencePrefs,
} from './referencePrefs';

const DEBOUNCE_MS = 600;

function useNarrow(breakpoint: number): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

interface Props {
  projectId: string;
  writingId: string;
  /** The chapter's current HTML; matching follows it as the author types. */
  content: string;
  editor: Editor | null;
  prefs: ReferencePrefs;
  /** Test seam: the window width under which the panel becomes a drawer. */
  narrowBreakpoint?: number;
}

interface Row {
  entry: CodexEntry;
  match?: ReferenceMatch;
  pinned: boolean;
}

export default function ReferencePanel({
  projectId,
  writingId,
  content,
  editor,
  prefs,
  narrowBreakpoint = REFERENCE_NARROW_PX,
}: Props) {
  const { t } = useTranslation();
  const { items: entries } = useCodexEntries(projectId);
  const narrow = useNarrow(narrowBreakpoint);
  const { open, width, setOpen, setWidth } = prefs;

  const [matches, setMatches] = useState<ReferenceMatch[]>([]);
  const [pins, setPins] = useState<string[]>(() => readPins(writingId));
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstRun = useRef(true);

  // The panel is keyed by chapter, so the first read is the initial state; this keeps it in step with the bridge tool.
  useEffect(() => {
    return onPinsChanged((id) => {
      if (id === writingId) setPins(readPins(writingId));
    });
  }, [writingId]);

  // Matching: debounced after the last keystroke and run when the browser is
  // idle, so typing never waits on it. Closed panel, no work.
  useEffect(() => {
    if (!open) return;
    const delay = firstRun.current ? 0 : DEBOUNCE_MS;
    firstRun.current = false;
    let cancelled = false;
    let idle: number | undefined;
    const run = () => {
      if (!cancelled) setMatches(findMentions(stripHtml(content), entries));
    };
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 400 });
      else run();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idle !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
    };
  }, [content, entries, open]);

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const rows = useMemo<Row[]>(() => {
    const matchById = new Map(matches.map((match) => [match.entryId, match]));
    const pinned: Row[] = pins
      .map((id) => byId.get(id))
      .filter((entry): entry is CodexEntry => Boolean(entry))
      .map((entry) => ({ entry, match: matchById.get(entry.id), pinned: true }));
    const pinnedIds = new Set(pinned.map((row) => row.entry.id));
    const mentioned: Row[] = matches
      .filter((match) => !pinnedIds.has(match.entryId) && byId.has(match.entryId))
      .map((match) => ({ entry: byId.get(match.entryId)!, match, pinned: false }));
    return [...pinned, ...mentioned];
  }, [matches, pins, byId]);
  const found = useMemo(() => (query.trim() ? searchEntries(query, entries) : []), [query, entries]);

  const focusEditor = useCallback(() => {
    // `view.focus()` puts the cursor back exactly where the selection was.
    editor?.view.focus();
  }, [editor]);

  const toggle = useCallback(() => {
    setOpen(!open);
    if (open) {
      setPreviewId(null);
      focusEditor();
    }
  }, [open, setOpen, focusEditor]);

  // The panel's shortcut. Capture on the window so it works from the editor.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  useEffect(() => {
    if (previewId) previewTitleRef.current?.focus();
  }, [previewId]);

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (previewId) setPreviewId(null);
    else if (query) setQuery('');
    else if (narrow) setOpen(false);
    focusEditor();
  };

  const togglePin = (entry: CodexEntry) => setPins(setPinned(writingId, entry.id, !pins.includes(entry.id)));

  // Clicking a row must not pull the editor's focus (and with it the caret).
  const keepEditorFocus = (event: React.MouseEvent) => event.preventDefault();

  const typeLabel = (type: string) => {
    const key = `codex.types.${type}`;
    const label = t(key as Parameters<typeof t>[0]);
    return label === key ? type : label;
  };

  const renderRow = (row: Row) => {
    const { entry, match, pinned } = row;
    const summary = entrySummary(entry, 110);
    return (
      <li key={entry.id} className="flex items-stretch gap-1" data-testid="reference-row" data-entry-id={entry.id}>
        <button
          type="button"
          onMouseDown={keepEditorFocus}
          onClick={() => setPreviewId(entry.id)}
          aria-label={t('writings.reference.open').replace('{name}', entry.title)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
        >
          {entry.avatar ? (
            <img src={entry.avatar} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
          ) : (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-deep/60 text-text-muted">
              <BookOpen size={14} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-semibold text-text-primary">{entry.title}</span>
              <span className="text-[10px] uppercase tracking-wide text-text-muted">{typeLabel(entry.type)}</span>
            </span>
            {match && (
              <span className="block text-[11px] text-accent-gold">
                {t('writings.reference.mentioned')} · {t('writings.reference.times').replace('{n}', String(match.count))}
                {match.matchedAlias !== entry.title ? ` · “${match.matchedAlias}”` : ''}
              </span>
            )}
            {pinned && <span className="block text-[11px] text-text-muted">{t('writings.reference.pinnedBadge')}</span>}
            {summary && <span className="mt-0.5 block text-xs leading-snug text-text-muted">{summary}</span>}
          </span>
        </button>
        <button
          type="button"
          onMouseDown={keepEditorFocus}
          onClick={() => togglePin(entry)}
          aria-pressed={pinned}
          aria-label={t(pinned ? 'writings.reference.unpin' : 'writings.reference.pin').replace('{name}', entry.title)}
          data-testid="reference-pin"
          className="flex w-8 flex-shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50 aria-pressed:text-accent-gold"
        >
          {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
        </button>
      </li>
    );
  };

  const previewEntry = previewId ? byId.get(previewId) : undefined;
  const renderPreview = (entry: CodexEntry) => {
    const paragraphs = bodyParagraphs(entry.content);
    const fields = Object.entries(entry.fields ?? {}).filter(([, value]) => typeof value === 'string' && value.trim());
    return (
      <div data-testid="reference-preview" className="space-y-3">
        <button
          type="button"
          onMouseDown={keepEditorFocus}
          onClick={() => setPreviewId(null)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          {t('writings.reference.back')}
        </button>
        <div className="flex items-start gap-3">
          {entry.avatar && <img src={entry.avatar} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover" />}
          <div className="min-w-0">
            <h3 ref={previewTitleRef} tabIndex={-1} className="text-base font-semibold text-text-primary outline-none">
              {entry.title}
            </h3>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">{typeLabel(entry.type)}</p>
            {entry.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{entry.tags.join(' · ')}</p>}
          </div>
        </div>
        {fields.length > 0 && (
          <dl className="space-y-1 text-xs">
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt className="font-semibold text-text-primary">{key}</dt>
                <dd className="whitespace-pre-wrap text-text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {paragraphs.length > 0 ? (
          <div className="space-y-2 text-sm leading-relaxed text-text-primary">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        ) : (
          fields.length === 0 && <p className="text-xs text-text-muted">{t('writings.reference.noBody')}</p>
        )}
      </div>
    );
  };

  const header = (
    <div className="flex items-center gap-2">
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="reference-panel-body"
        aria-label={t('writings.reference.toggle')}
        title={`${t('writings.reference.toggle')} (Ctrl+Alt+R)`}
        data-testid="reference-toggle"
        className="inline-flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
      >
        <BookOpen size={15} aria-hidden="true" className="text-accent-gold" />
        {t('writings.reference.title')}
        {open && rows.length > 0 && <span className="text-xs font-normal text-text-muted">{rows.length}</span>}
      </button>
      {open && narrow && (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            focusEditor();
          }}
          aria-label={t('writings.reference.close')}
          className="rounded-md p-1.5 text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const body = open && (
    <div id="reference-panel-body" className="mt-3 space-y-3">
      {previewEntry ? (
        renderPreview(previewEntry)
      ) : (
        <>
          <label className="relative block">
            <span className="sr-only">{t('writings.reference.searchLabel')}</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 top-2.5 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('writings.reference.search')}
              aria-label={t('writings.reference.searchLabel')}
              data-testid="reference-search"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
            />
          </label>
          {query.trim() ? (
            found.length > 0 ? (
              <ul className="space-y-1.5" data-testid="reference-results">
                {found.map((entry) => renderRow({ entry, pinned: pins.includes(entry.id), match: matches.find((m) => m.entryId === entry.id) }))}
              </ul>
            ) : (
              <p className="text-xs text-text-muted">{t('writings.reference.noResults')}</p>
            )
          ) : rows.length > 0 ? (
            <ul className="space-y-1.5" data-testid="reference-list">
              {rows.map(renderRow)}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">{t('writings.reference.empty')}</p>
          )}
          <p className="text-[11px] leading-snug text-text-muted">{t('writings.reference.note')}</p>
        </>
      )}
    </div>
  );

  const resizeHandle = open && !narrow && (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('writings.reference.resize')}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="reference-resize"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(width + 20); }
        if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(width - 20); }
      }}
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startWidth = width;
        const move = (e: PointerEvent) => setWidth(startWidth + (startX - e.clientX));
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      }}
      className="hidden h-6 w-full cursor-col-resize items-center justify-center rounded text-text-muted hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50 lg:flex"
    >
      <span className="h-0.5 w-8 rounded bg-border" />
    </div>
  );

  if (open && narrow) {
    return (
      <>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40"
          data-testid="reference-backdrop"
        />
        <aside
          role="dialog"
          aria-label={t('writings.reference.toggle')}
          data-testid="reference-panel"
          data-mode="drawer"
          onKeyDown={onPanelKeyDown}
          style={{ width: `min(${width}px, calc(100vw - 24px))` }}
          className="fixed inset-y-0 right-0 z-40 overflow-y-auto border-l border-border bg-surface p-3 shadow-2xl"
        >
          {header}
          {body}
        </aside>
      </>
    );
  }

  return (
    <section
      aria-label={t('writings.reference.toggle')}
      data-testid="reference-panel"
      data-mode="column"
      data-open={open}
      onKeyDown={onPanelKeyDown}
      className="rounded-lg border border-border bg-deep/45 p-2"
    >
      {resizeHandle}
      {header}
      {body}
    </section>
  );
}
