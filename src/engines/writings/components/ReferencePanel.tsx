// ============================================================================
// ReferencePanel — "Consultar": the codex entries a chapter mentions
// ============================================================================
//
// A collapsible panel beside the manuscript. It lists the codex entries whose
// name or alias occurs in the text (no model: the matcher in
// services/codexReference), shows their essentials, and opens the full entry
// in the panel itself. A consulted Codex entry can be edited without leaving
// the manuscript. Notes/library remain read-only. Items take focus without moving the
// editor's selection, and Escape hands focus back to it.
//
// Two shapes, one component:
//   * DOCKED, in the chapter editor's side column, when the window is wide
//     enough for that column to exist (the same breakpoint the editor's grid
//     uses, see referencePrefs.ts);
//   * a DRAWER over the text everywhere else: focus mode, the whole-book
//     editor, narrow windows. The drawer is a temporary consult: a floating
//     button opens it, it never takes the editor's selection, it is not
//     remembered, and in focus mode/the book it has no backdrop so the text
//     stays editable behind it.
//
// "Mentioned" is all it claims. A name in the text is not presence in a scene
// and not a point of view.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { BookOpen, ChevronLeft, ExternalLink, Pencil, Pin, PinOff, Search, X } from 'lucide-react';
import { useCodexEntries } from '@/engines/codex/hooks';
import { saveCodexDraft } from '@/engines/codex/operations';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import Modal from '@/components/common/Modal';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';
import { useEnginePane, paneReferenceScope, ownsEnginePaneEvent } from '@/engines/_shared/EnginePaneContext';
import { isAliasField, readAliases } from '@/services/codexReference/aliases';
import { useTranslation } from '@/i18n/useTranslation';
import {
  bodyParagraphs,
  entrySummary,
  findMentions,
  searchEntries,
  type ReferenceMatch,
} from '@/services/codexReference/matcher';
import { migrateLocalPins, onPinsChanged, readPins, setPinned } from '@/services/codexReference/pins';
import { searchSources, type ReferenceSourceItem } from '@/services/codexReference/sources';
import type { CodexEntry } from '@/types';
import { stripHtml } from '@/utils/text';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  REFERENCE_NARROW_PX,
  type ReferencePrefs,
} from './referencePrefs';

const DEBOUNCE_MS = 600;
const SOURCE_DEBOUNCE_MS = 150;

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
  /** The pin scope: a chapter id, or `book:<projectId>` in the whole-book editor. */
  writingId: string;
  /**
   * The chapter's current HTML; matching follows it as the author types. Leave
   * it out where the text lives only in the editor (the whole book): the panel
   * then reads it from `editor`.
   */
  content?: string;
  editor: Editor | null;
  prefs: ReferencePrefs;
  /** `docked` sits in the side column when there is one; `temporary` is always a drawer. */
  mode?: 'docked' | 'temporary';
  /**
   * The window width under which the docked panel becomes a drawer. The editor
   * passes the width its own two-column grid starts at (1024, or 1440 in page
   * mode) so the panel is never stacked under the text.
   */
  narrowBreakpoint?: number;
  /** Which bottom corner the floating "Consultar" button takes. */
  anchor?: 'right' | 'left';
  /** Whole-book editor only: the chapters actually loaded, when that is not the whole book. */
  loadedRange?: { from: number; to: number } | null;
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
  mode = 'docked',
  narrowBreakpoint = REFERENCE_NARROW_PX,
  anchor = 'right',
  loadedRange = null,
}: Props) {
  const { t, locale } = useTranslation();
  const pane = useEnginePane();
  const referenceScope = paneReferenceScope(writingId, pane);
  const panelBodyId = useId();
  const floating = (children: ReactNode) => pane?.overlayTarget ? createPortal(children, pane.overlayTarget) : children;
  const positioning = pane?.overlayTarget ? 'absolute' : 'fixed';
  const { items: entries, refresh } = useCodexEntries(projectId);
  const windowNarrow = useNarrow(narrowBreakpoint);
  const narrow = pane?.width !== undefined ? pane.width < narrowBreakpoint : windowNarrow;
  const { width } = prefs;
  const drawer = mode === 'temporary' || narrow;
  const open = drawer ? prefs.consult : prefs.open;
  const setOpen = drawer ? prefs.setConsult : prefs.setOpen;

  const [matches, setMatches] = useState<ReferenceMatch[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sourceHits, setSourceHits] = useState<ReferenceSourceItem[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<ReferenceSourceItem | null>(null);
  const [liveText, setLiveText] = useState('');
  const [editingEntry, setEditingEntry] = useState<CodexEntry | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryDirty, setEntryDirty] = useState(false);
  useEffect(() => {
    const openMention = (event: Event) => {
      const detail = (event as CustomEvent<OpenCodexReferenceDetail>).detail;
      if (pane && !pane.visible || !detail || detail.handled || detail.projectId !== projectId || detail.scopeId && detail.scopeId !== referenceScope || !entries.some(entry => entry.id === detail.entryId) || editingEntry) return;
      detail.handled = true;
      setPreviewSource(null); setPreviewId(detail.entryId); setQuery(''); setOpen(true);
    };
    window.addEventListener(OPEN_CODEX_REFERENCE, openMention);
    return () => window.removeEventListener(OPEN_CODEX_REFERENCE, openMention);
  }, [entries, projectId, referenceScope, setOpen, editingEntry, pane]);
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstRun = useRef(true);

  // Where the text comes from: the chapter's HTML, or (whole book) the editor itself.
  useEffect(() => {
    if (content !== undefined || !editor || !open) return;
    let timer: number | undefined;
    const read = () => setLiveText(editor.getText({ blockSeparator: '\n' }));
    read();
    const onUpdate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, DEBOUNCE_MS / 2);
    };
    editor.on('update', onUpdate);
    return () => {
      window.clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [content, editor, open]);

  // Pins live in the project's data; any localStorage pins from before are
  // moved there once. Reloaded when the bridge or another panel changes them.
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readPins(projectId, writingId)
        .then((next) => { if (alive) setPins(next); })
        .catch(() => undefined);
    };
    void migrateLocalPins().catch(() => 0).then(load);
    const off = onPinsChanged((id) => {
      if (id === writingId || id === '*') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [projectId, writingId]);

  // Matching: debounced after the last keystroke and run when the browser is
  // idle, so typing never waits on it. Closed panel, no work.
  useEffect(() => {
    if (!open) return;
    const delay = firstRun.current ? 0 : DEBOUNCE_MS;
    firstRun.current = false;
    let cancelled = false;
    let idle: number | undefined;
    const run = () => {
      if (!cancelled) setMatches(findMentions(content !== undefined ? stripHtml(content) : liveText, entries));
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
  }, [content, liveText, entries, open]);

  // Notes and library: looked up only when the author searches, read-only.
  useEffect(() => {
    const needle = query.trim();
    if (!open || !needle) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      searchSources(projectId, needle, 20, pane?.projectId === projectId ? pane.eraId : undefined)
        .then((hits) => { if (alive) setSourceHits(hits); })
        .catch(() => { if (alive) setSourceHits([]); });
    }, SOURCE_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, projectId, open, pane?.projectId, pane?.eraId]);

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
  const visibleSources = query.trim() ? sourceHits : [];

  const focusEditor = useCallback(() => {
    // `view.focus()` puts the cursor back exactly where the selection was.
    editor?.view.focus();
  }, [editor]);


  const closePreviews = () => {
    setPreviewId(null);
    setPreviewSource(null);
  };

  const toggle = useCallback(() => {
    setOpen(!open);
    if (open) {
      setPreviewId(null);
      setPreviewSource(null);
      focusEditor();
    }
  }, [open, setOpen, focusEditor]);

  // The panel's shortcut. Capture on the window so it works from the editor.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!ownsEnginePaneEvent(pane, event)) return;
      if (editingEntry) return;
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, editingEntry, pane]);

  // Escape from the text closes a drawer left open over it (inside the panel
  // its own handler runs first and stops the event).
  useEffect(() => {
    if (!drawer || !open) return;
    // Capture phase: this Escape is spent on the drawer, so it must not also
    // leave focus mode (the editor's own handler listens on the way back up).
    const handler = (event: KeyboardEvent) => {
      if (!ownsEnginePaneEvent(pane, event)) return;
      if (editingEntry) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // From inside the panel, its own handler (preview, search, then close) decides.
      if (event.target instanceof Element && event.target.closest('[data-testid="reference-panel"]')) return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [drawer, open, setOpen, editingEntry, pane]);

  useEffect(() => {
    if (previewId || previewSource) previewTitleRef.current?.focus();
  }, [previewId, previewSource]);

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (editingEntry) return;
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (previewId || previewSource) closePreviews();
    else if (query) setQuery('');
    else if (drawer) setOpen(false);
    focusEditor();
  };

  const togglePin = (entry: CodexEntry) => {
    void setPinned(projectId, writingId, entry.id, !pins.includes(entry.id))
      .then(setPins)
      .catch(() => undefined);
  };

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

  const sourceKindLabel = (item: ReferenceSourceItem) =>
    t(item.kind === 'note' ? 'writings.reference.sourceNote' : 'writings.reference.sourceCitation');

  const renderSourceRow = (item: ReferenceSourceItem) => (
    <li key={`${item.kind}:${item.id}`} data-testid="reference-source-row" data-source-kind={item.kind} data-source-id={item.id}>
      <button
        type="button"
        onMouseDown={keepEditorFocus}
        onClick={() => setPreviewSource(item)}
        aria-label={t('writings.reference.sourceOpen').replace('{name}', item.title)}
        className="flex w-full min-w-0 flex-col rounded-md border border-border bg-surface px-2 py-1.5 text-left transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold text-text-primary">{item.title}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">{sourceKindLabel(item)}</span>
        </span>
        {item.subtitle && <span className="block truncate text-[11px] text-text-muted">{item.subtitle}</span>}
      </button>
    </li>
  );

  const backButton = (
    <button
      type="button"
      onMouseDown={keepEditorFocus}
      onClick={closePreviews}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
    >
      <ChevronLeft size={14} aria-hidden="true" />
      {t('writings.reference.back')}
    </button>
  );

  const previewEntry = previewId ? byId.get(previewId) : undefined;
  const renderPreview = (entry: CodexEntry) => {
    const paragraphs = bodyParagraphs(entry.content);
    const fields = Object.entries(entry.fields ?? {}).filter(([key, value]) => !isAliasField(key) && typeof value === 'string' && value.trim());
    return (
      <div data-testid="reference-preview" className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {backButton}
          {pane?.openBeside && <button type="button" onMouseDown={keepEditorFocus} onClick={() => pane.openBeside!(`/project/${encodeURIComponent(entry.projectId)}/codex?entry=${encodeURIComponent(entry.id)}`)} data-testid="reference-open-beside" title={locale === 'es' ? 'Abrir en su propia pestaña al lado' : 'Open in its own tab beside'} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-muted hover:bg-elevated hover:text-text-primary"><ExternalLink size={13} aria-hidden="true" />{locale === 'es' ? 'Abrir al lado' : 'Open beside'}</button>}
          <button type="button" onMouseDown={keepEditorFocus} onClick={() => { setEntryDirty(false); setEditingEntry(entry); }} data-testid="reference-edit-entry" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"><Pencil size={13} aria-hidden="true" />{t('codex.editEntry')}</button>
        </div>
        <div className="flex items-start gap-3">
          {entry.avatar && <img src={entry.avatar} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover" />}
          <div className="min-w-0">
            <h3 ref={previewTitleRef} tabIndex={-1} className="text-base font-semibold text-text-primary outline-none">
              {entry.title}
            </h3>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">{typeLabel(entry.type)}</p>
            {entry.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{entry.tags.join(' · ')}</p>}
            {readAliases(entry.fields).length > 0 && <p className="mt-1 text-xs text-text-muted">{t('codex.aliases')}: {readAliases(entry.fields).join(' · ')}</p>}
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
        {Object.entries(entry.referenceFields ?? {}).some(([, ids]) => ids.length > 0) && <dl className="space-y-2 text-xs">{Object.entries(entry.referenceFields ?? {}).map(([key, ids]) => ids.length > 0 && <div key={key}><dt className="font-semibold text-text-primary">{key}</dt><dd className="flex flex-wrap gap-2 mt-1">{ids.map(id => { const target = byId.get(id); return target ? <button key={id} type="button" onMouseDown={keepEditorFocus} onClick={() => setPreviewId(target.id)} className="text-accent-gold underline underline-offset-2">{target.title}</button> : <span key={id} className="text-text-muted">{t('codex.fields.missingReference')}</span>; })}</dd></div>)}</dl>}
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

  const renderSourcePreview = (item: ReferenceSourceItem) => (
    <div data-testid="reference-source-preview" data-source-kind={item.kind} className="space-y-3">
      {backButton}
      <div className="min-w-0">
        <h3 ref={previewTitleRef} tabIndex={-1} className="text-base font-semibold text-text-primary outline-none">
          {item.title}
        </h3>
        <p className="text-[10px] uppercase tracking-wide text-text-muted">{sourceKindLabel(item)}</p>
        {item.subtitle && <p className="mt-1 text-xs text-text-muted">{item.subtitle}</p>}
        {item.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{item.tags.join(' · ')}</p>}
      </div>
      {item.body.length > 0 && (
        <div className="space-y-2 text-sm leading-relaxed text-text-primary">
          {item.body.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-text-muted">{t('writings.reference.readOnly')}</p>
    </div>
  );

  const header = (
    <div className="flex items-center gap-2">
      <button
        ref={toggleRef}
        type="button"
        onMouseDown={keepEditorFocus}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelBodyId}
        aria-label={t('writings.reference.toggle')}
        title={`${t('writings.reference.toggle')} (Ctrl+Alt+R)`}
        data-testid="reference-toggle"
        className="inline-flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
      >
        <BookOpen size={15} aria-hidden="true" className="text-accent-gold" />
        {t('writings.reference.title')}
        {writingId.startsWith('book:') && (
          <span className="text-xs font-normal text-text-muted">· {loadedRange
              ? t('writings.reference.scopeRange').replace('{from}', String(loadedRange.from)).replace('{to}', String(loadedRange.to))
              : t('writings.reference.scopeBook')}</span>
        )}
        {open && rows.length > 0 && <span className="text-xs font-normal text-text-muted">{rows.length}</span>}
      </button>
      {open && drawer && (
        <button
          type="button"
          onMouseDown={keepEditorFocus}
          onClick={() => {
            setOpen(false);
            focusEditor();
          }}
          aria-label={t('writings.reference.close')}
          data-testid="reference-close"
          className="rounded-md p-1.5 text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const body = open && (
    <div id={panelBodyId} className="mt-3 space-y-3">
      {previewEntry ? (
        renderPreview(previewEntry)
      ) : previewSource ? (
        renderSourcePreview(previewSource)
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
            found.length > 0 || visibleSources.length > 0 ? (
              <>
                {found.length > 0 && (
                  <ul className="space-y-1.5" data-testid="reference-results">
                    {found.map((entry) => renderRow({ entry, pinned: pins.includes(entry.id), match: matches.find((m) => m.entryId === entry.id) }))}
                  </ul>
                )}
                {visibleSources.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{t('writings.reference.sources')}</h4>
                    <ul className="space-y-1.5" data-testid="reference-source-results">
                      {visibleSources.map(renderSourceRow)}
                    </ul>
                  </div>
                )}
              </>
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

  const entryEditor = (
    <Modal open={editingEntry !== null} busy={savingEntry} dismissible={!entryDirty} onClose={() => setEditingEntry(null)} restoreFocus={focusEditor} title={t('codex.editEntry')} wide>
      {editingEntry && (
        <CodexEntryForm
          key={editingEntry.id}
          projectId={projectId}
          entry={editingEntry}
          onPendingChange={setSavingEntry}
          onDirtyChange={setEntryDirty}
          onSave={async (draft, base) => {
            await saveCodexDraft(base ?? editingEntry, draft, { projectId, eraId: pane?.projectId === projectId ? pane.eraId : undefined });
            await refresh();
            notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: draft.id });
            setEditingEntry(null);
          }}
          onCancel={() => setEditingEntry(null)}
        />
      )}
    </Modal>
  );

  const resizeHandle = open && !drawer && (
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
        if (event.key === 'ArrowLeft') { event.preventDefault(); prefs.setWidth(width + 20); }
        if (event.key === 'ArrowRight') { event.preventDefault(); prefs.setWidth(width - 20); }
      }}
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startWidth = width;
        const move = (e: PointerEvent) => prefs.setWidth(startWidth + (startX - e.clientX));
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      }}
      className="flex h-6 w-full cursor-col-resize items-center justify-center rounded text-text-muted hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
    >
      <span className="h-0.5 w-8 rounded bg-border" />
    </div>
  );

  if (drawer && !open) {
    // Closed drawer: one floating button, always inside the viewport, so the
    // panel is never down at the end of a long chapter.
    return floating(
      <button
        ref={toggleRef}
        type="button"
        onMouseDown={keepEditorFocus}
        onClick={toggle}
        aria-expanded={false}
        aria-controls={panelBodyId}
        aria-label={t('writings.reference.toggle')}
        title={`${t('writings.reference.toggle')} (Ctrl+Alt+R)`}
        data-testid="reference-toggle"
        data-mode="floating"
        className={`${positioning} pointer-events-auto bottom-4 ${anchor === 'left' ? 'left-4' : 'right-4'} z-30 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 py-2 text-sm font-semibold text-text-primary shadow-lg backdrop-blur transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50`}
      >
        <BookOpen size={15} aria-hidden="true" className="text-accent-gold" />
        {t('writings.reference.title')}
      </button>
    );
  }

  if (drawer) {
    return floating(
      <>
        {mode === 'docked' && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className={`${positioning} pointer-events-auto inset-0 z-30 bg-black/40`}
            data-testid="reference-backdrop"
          />
        )}
        <aside
          role="dialog"
          aria-modal={mode === 'docked' ? undefined : false}
          aria-label={t('writings.reference.toggle')}
          data-testid="reference-panel"
          data-mode="drawer"
          data-temporary={mode === 'temporary' ? 'true' : 'false'}
          data-open="true"
          onKeyDown={onPanelKeyDown}
          style={{ width: `min(${width}px, calc(${pane?.overlayTarget ? '100%' : '100vw'} - 24px))` }}
          className={`${positioning} pointer-events-auto inset-y-0 right-0 z-40 overflow-y-auto border-l border-border bg-surface p-3 shadow-2xl`}
        >
          {header}
          {body}
        </aside>
        {entryEditor}
      </>
    );
  }

  return (
    <>
    <section
      aria-label={t('writings.reference.toggle')}
      data-testid="reference-panel"
      data-mode="column"
      data-open={open}
      onKeyDown={onPanelKeyDown}
      className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-border bg-deep/45 p-2"
    >
      {resizeHandle}
      {header}
      {body}
    </section>
    {entryEditor}
    </>
  );
}
