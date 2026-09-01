import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  BookmarkPlus,
  BookOpenCheck,
  HeartPulse,
  Home,
  Layers,
  LayoutDashboard,
  Loader2,
  Pencil,
  Search,
  Settings2,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import type { SearchResult } from '@/hooks/useGlobalSearch';
import { useTranslation } from '@/i18n/useTranslation';
import { getEngine } from '@/engines/_registry';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { ConfirmDialog } from '@/engines/_shared';
import { useProject } from '@/hooks/useProjects';
import {
  buildCommandCenterActions,
  deleteSavedSearch,
  filterCommandCenterActions,
  getOrderedEnabledEngineIds,
  getSavedSearches,
  moveCommandCenterSelection,
  saveSearch,
  type CommandCenterAction,
  type CommandCenterActionIcon,
  type SavedSearch,
} from '@/services/commandCenter';
import { releaseProjectSearchIndex } from '@/services/projectSearchIndex';
import {
  completeSearchField,
  parseSearchQuery,
  type ParsedSearchQuery,
} from '@/services/searchQuery';
import { useCommandCenterSearch, type CommandCenterGroup } from './useCommandCenterSearch';
import { COMMAND_CENTRE_SHORTCUT, matchesShortcut } from './shortcuts';

interface PresentedAction extends CommandCenterAction {
  title: string;
  subtitle: string;
}

interface SavedSearchItem {
  type: 'saved';
  key: string;
  id: string;
  title: string;
  subtitle: string;
  query: string;
}

type CommandCenterItem = PresentedAction | SearchResult | SavedSearchItem;

interface PaletteSection {
  key: string;
  label: string;
  /** Total matches behind this section, when it can exceed what is listed. */
  count?: number;
  items: CommandCenterItem[];
  /** Index of this section's first item in the flat keyboard list. */
  start: number;
}

const NO_GROUPS: CommandCenterGroup[] = [];

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled])';

type Translate = (key: string) => string;

interface OperatorHint {
  id: string;
  /** The operator as the writer will see and type it. */
  syntax: string;
  /** What clicking the chip inserts at the caret. */
  insert: string;
  /** Characters to step the caret back afterwards, to land inside the quotes. */
  caretBack?: number;
  label: (t: Translate) => string;
}

/**
 * The operator row. Discovery is the whole point: nobody guesses that a search
 * box takes `is:untagged`, so every operator the grammar understands is on
 * screen the moment the box is empty, and clicking one types it for you.
 *
 * Each label is a literal `t()` call rather than a composed key, so the locale
 * gate can prove the string exists instead of the row rendering key names.
 */
const OPERATOR_HINTS: OperatorHint[] = [
  { id: 'phrase', syntax: '"…"', insert: '""', caretBack: 1, label: t => t('search.commandCenter.hint.phrase') },
  { id: 'exclude', syntax: '-…', insert: '-', label: t => t('search.commandCenter.hint.exclude') },
  { id: 'engine', syntax: 'engine:', insert: 'engine:', label: t => t('search.commandCenter.hint.engine') },
  { id: 'tag', syntax: 'tag:', insert: 'tag:', label: t => t('search.commandCenter.hint.tag') },
  { id: 'type', syntax: 'type:', insert: 'type:', label: t => t('search.commandCenter.hint.type') },
  { id: 'status', syntax: 'status:', insert: 'status:', label: t => t('search.commandCenter.hint.status') },
  { id: 'untagged', syntax: 'is:untagged', insert: 'is:untagged ', label: t => t('search.commandCenter.hint.untagged') },
  { id: 'updated', syntax: 'updated:>7d', insert: 'updated:>7d ', label: t => t('search.commandCenter.hint.updated') },
];

const ACTION_ICONS: Record<Exclude<CommandCenterActionIcon, 'engine'>, typeof Search> = {
  home: Home,
  notes: StickyNote,
  overview: LayoutDashboard,
  health: HeartPulse,
  edit: Pencil,
  publishing: BookOpenCheck,
  manage: Settings2,
};

function ResultIcon({ item }: { item: CommandCenterItem }) {
  if (item.type === 'saved') return <Bookmark size={16} className="text-accent-gold" />;
  if (item.type === 'project') return <Layers size={16} className="text-accent-gold" />;
  if (item.engineId) {
    const engine = getEngine(item.engineId);
    if (engine) {
      const Icon = engine.icon;
      return <Icon size={16} className="text-accent-plum-light" />;
    }
  }
  if (item.type === 'action' && item.icon !== 'engine') {
    const Icon = ACTION_ICONS[item.icon];
    return <Icon size={16} className="text-accent-gold" />;
  }
  return <Search size={16} className="text-text-muted" />;
}

function CommandCenterRow({
  item,
  index,
  active,
  onHighlight,
  onSelect,
  trailing,
}: {
  item: CommandCenterItem;
  index: number;
  active: boolean;
  onHighlight: () => void;
  onSelect: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      role="presentation"
      onMouseEnter={onHighlight}
      className={`flex items-center transition ${active ? 'bg-elevated' : 'hover:bg-elevated/50'}`}
    >
      <button
        id={`command-center-option-${index}`}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={-1}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left"
      >
        <ResultIcon item={item} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-primary">{item.title}</span>
          {item.type === 'entity' && item.snippet ? (
            <span className="block truncate text-xs italic text-text-muted">“{item.snippet}”</span>
          ) : (
            <span className="block truncate text-xs text-text-muted">{item.subtitle}</span>
          )}
        </span>
      </button>
      {trailing}
    </div>
  );
}

export default function GlobalSearch() {
  const { t } = useTranslation();
  const { searchOpen, setSearchOpen } = useAppStore();
  const { id: projectId } = useParams<{ id?: string }>();
  const { project } = useProject(projectId);
  const activeProject = project?.id === projectId ? project : undefined;
  const enabledEngineIds = useMemo(
    () => activeProject
      ? getOrderedEnabledEngineIds(activeProject.enabledEngines, activeProject.engineOrder)
      : [],
    [activeProject],
  );
  const { search } = useCommandCenterSearch(projectId, enabledEngineIds);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<CommandCenterGroup[]>(NO_GROUPS);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  /** null while not naming; a string is the pending name of the current query. */
  const [saveName, setSaveName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchSequenceRef = useRef(0);
  /** Caret to restore after a programmatic edit (Tab completion, operator chip). */
  const pendingCaretRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const naming = saveName !== null;

  const closeSearch = useCallback((restoreFocus = true) => {
    searchSequenceRef.current += 1;
    setSearchOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      });
    }
  }, [setSearchOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // The chord is not spelled out here: it is read from the shortcuts
      // table, so the key the palette answers to and the key the shortcuts
      // sheet promises are the same string and cannot drift apart.
      if (event.repeat || !matchesShortcut(event, COMMAND_CENTRE_SHORTCUT)) return;
      event.preventDefault();
      if (searchOpen) closeSearch();
      else setSearchOpen(true);
    };
    // Escape is handled on the dialog too, but that only fires while focus is
    // inside it. Focus can end up on the body (a click on the backdrop's edge,
    // a result that unmounted), and then the palette could not be closed from
    // the keyboard at all. `defaultPrevented` keeps a modal stacked above us
    // from having its own Escape swallowed here.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !searchOpen) return;
      closeSearch();
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', escape);
    };
  }, [closeSearch, searchOpen, setSearchOpen]);

  const [wasOpen, setWasOpen] = useState(false);
  if (searchOpen !== wasOpen) {
    setWasOpen(searchOpen);
    if (searchOpen) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setQuery('');
      setGroups(NO_GROUPS);
      setSelectedIdx(0);
      setLoading(false);
      setSearchError(false);
      setSaveName(null);
      setPendingDelete(null);
    }
  }

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  // The palette is what loads a project's prose into memory, so it is also what
  // lets it go: everything but the open project is released the moment the
  // palette closes, and again whenever the route moves to another project.
  // Without this the index only ever grew, one project per search, for the
  // whole session.
  useEffect(() => {
    if (searchOpen) return;
    releaseProjectSearchIndex(projectId);
  }, [projectId, searchOpen]);

  // Saved searches are per project, so the palette reloads them whenever the
  // scope it opens in changes.
  useEffect(() => {
    if (!searchOpen) return;
    let live = true;
    void getSavedSearches(projectId).then((searches) => {
      if (live) setSavedSearches(searches);
    });
    return () => { live = false; };
  }, [projectId, searchOpen]);

  // Restore the caret after Tab completion or an operator chip rewrote the box.
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    inputRef.current?.setSelectionRange(caret, caret);
  });

  useEffect(() => {
    if (naming) saveInputRef.current?.focus();
  }, [naming]);

  const runSearch = useCallback(async (value: ParsedSearchQuery, sequence: number) => {
    setLoading(true);
    setSearchError(false);
    setGroups(NO_GROUPS);
    try {
      const found = await search(value);
      if (sequence !== searchSequenceRef.current) return;
      setGroups(found);
      setSelectedIdx(0);
    } catch (error) {
      if (sequence !== searchSequenceRef.current) return;
      console.error('Command center search failed', error);
      setGroups(NO_GROUPS);
      setSearchError(true);
    } finally {
      if (sequence === searchSequenceRef.current) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!searchOpen || parsed.isEmpty) return;
    const sequence = ++searchSequenceRef.current;
    const timer = window.setTimeout(() => {
      void runSearch(parsed, sequence);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [parsed, runSearch, searchOpen]);

  const allActions = buildCommandCenterActions(activeProject ? {
    id: activeProject.id,
    enabledEngines: activeProject.enabledEngines,
    engineOrder: activeProject.engineOrder,
  } : undefined).filter(item => !item.engineId || Boolean(getEngine(item.engineId)));
  // A query that is nothing but filters (`is:untagged`) is not asking for a
  // command, so the action list steps aside instead of listing everything.
  const actionResults: PresentedAction[] = !parsed.isEmpty && !parsed.hasText
    ? []
    : filterCommandCenterActions(
      allActions,
      parsed.isEmpty ? '' : parsed.text,
      item => `${t(item.labelKey)} ${t(item.detailKey)} ${t(item.keywordsKey)}`,
    ).map(item => ({
      ...item,
      title: t(item.labelKey),
      subtitle: t(item.detailKey),
    }));

  const savedItems: SavedSearchItem[] = query.trim()
    ? []
    : savedSearches.map(saved => ({
      type: 'saved' as const,
      key: `saved:${saved.id}`,
      id: saved.id,
      title: saved.name,
      subtitle: saved.query,
      query: saved.query,
    }));

  const sections: PaletteSection[] = [];
  let cursor = 0;
  const addSection = (key: string, label: string, items: CommandCenterItem[], count?: number) => {
    if (items.length === 0) return;
    sections.push({ key, label, items, count, start: cursor });
    cursor += items.length;
  };

  addSection('saved', t('search.commandCenter.saved.title'), savedItems, savedItems.length);
  addSection('actions', t('search.commandCenter.actions'), actionResults);
  for (const group of groups) {
    const label = group.engineId === ''
      ? t('dashboard.projects')
      : getEngine(group.engineId)
        ? t(`engines.${group.engineId}.name`)
        : t('search.commandCenter.results');
    addSection(`engine:${group.engineId}`, label, group.items, group.count);
  }

  const items: CommandCenterItem[] = sections.flatMap(section => section.items);
  const activeIndex = items.length > 0 ? Math.min(selectedIdx, items.length - 1) : 0;

  useEffect(() => {
    if (!searchOpen || items.length === 0) return;
    document.getElementById(`command-center-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items.length, searchOpen]);

  const updateQuery = (value: string) => {
    searchSequenceRef.current += 1;
    setQuery(value);
    setGroups(NO_GROUPS);
    setSelectedIdx(0);
    setSearchError(false);
    setLoading(!parseSearchQuery(value).isEmpty);
  };

  const insertOperator = (snippet: string, caretBack = 0) => {
    const input = inputRef.current;
    const at = input?.selectionStart ?? query.length;
    updateQuery(`${query.slice(0, at)}${snippet}${query.slice(at)}`);
    pendingCaretRef.current = at + snippet.length - caretBack;
    input?.focus();
  };

  const openItem = (item: PresentedAction | SearchResult) => {
    if (item.type === 'action') {
      navigate(item.target);
    } else if (item.type === 'project') {
      navigate(`/project/${encodeURIComponent(item.id)}/overview`);
    } else if (item.engineId) {
      const adapter = getAnchorAdapter(item.engineId);
      if (adapter) adapter.navigateToEntity(item.id, item.projectId);
      else if (item.projectId) {
        navigate(`/project/${encodeURIComponent(item.projectId)}/${encodeURIComponent(item.engineId)}`);
      }
    }
  };

  /**
   * `keepOpen` is Cmd/Ctrl+Enter: jump to the hit but leave the palette up and
   * step to the next one, which is how you walk a list of matches without
   * retyping the query at every stop.
   */
  const activate = (item: CommandCenterItem, keepOpen: boolean) => {
    if (item.type === 'saved') {
      updateQuery(item.query);
      pendingCaretRef.current = item.query.length;
      inputRef.current?.focus();
      return;
    }
    openItem(item);
    if (!keepOpen) {
      closeSearch(false);
      return;
    }
    setSelectedIdx(index => moveCommandCenterSelection(index, items.length, 1));
    inputRef.current?.focus();
  };

  const commitSave = async () => {
    if (saveName === null) return;
    setSavedSearches(await saveSearch(query, saveName, projectId));
    setSaveName(null);
    inputRef.current?.focus();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setSavedSearches(await deleteSavedSearch(pendingDelete.id, projectId));
    setPendingDelete(null);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || pendingDelete) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIdx(index => moveCommandCenterSelection(index, items.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIdx(index => moveCommandCenterSelection(index, items.length, -1));
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault();
      activate(items[activeIndex], event.metaKey || event.ctrlKey);
    } else if (event.key === 'Tab' && !event.shiftKey) {
      const completion = completeSearchField(query, event.currentTarget.selectionStart ?? query.length);
      // No field to complete: let the dialog's Tab handler move focus instead.
      if (!completion) return;
      event.preventDefault();
      updateQuery(completion.text);
      pendingCaretRef.current = completion.caret;
    } else if (event.key === 'Delete' || (event.key === 'Backspace' && query === '')) {
      // On a Mac the key labelled Delete reports Backspace, and with an empty
      // box Backspace has no text left to remove.
      const item = items[activeIndex];
      if (item?.type !== 'saved') return;
      event.preventDefault();
      setPendingDelete(savedSearches.find(saved => saved.id === item.id) ?? null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (naming) {
        setSaveName(null);
        return;
      }
      closeSearch();
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (naming) {
        setSaveName(null);
        inputRef.current?.focus();
        return;
      }
      closeSearch();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    // Result rows carry tabindex -1: they are reached with the arrows, and
    // walking 40 of them with Tab would bury the close button.
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => element.tabIndex >= 0);
    if (focusable.length === 0) return;
    const current = document.activeElement instanceof HTMLElement
      ? focusable.indexOf(document.activeElement)
      : -1;
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  };

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => closeSearch()}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-center-title"
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            initial={{ scale: 0.95, y: -20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: -20 }}
            onClick={event => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="command-center-title" className="sr-only">{t('search.commandCenter.title')}</h2>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search size={18} className="text-text-muted" aria-hidden="true" />
              <input
                ref={inputRef}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="command-center-results"
                aria-activedescendant={items.length > 0 ? `command-center-option-${activeIndex}` : undefined}
                value={query}
                onChange={event => updateQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={t('search.commandCenter.placeholder')}
                className="flex-1 border-none bg-transparent text-text-primary outline-none"
              />
              {loading && <Loader2 size={15} className="animate-spin text-text-muted" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => closeSearch()}
                aria-label={t('search.commandCenter.close')}
                className="rounded p-1 hover:bg-elevated"
              >
                <X size={16} className="text-text-muted" aria-hidden="true" />
              </button>
            </div>

            {items.length > 0 && (
              <div id="command-center-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-2">
                {sections.map((section, sectionIndex) => (
                  <div key={section.key} role="group" aria-labelledby={`command-center-label-${section.key}`}>
                    <div
                      id={`command-center-label-${section.key}`}
                      className={`flex items-center gap-2 px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim ${sectionIndex === 0 ? 'pt-1' : 'pt-3'}`}
                    >
                      <span className="truncate">{section.label}</span>
                      {section.count !== undefined && (
                        <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                          {section.count}
                        </span>
                      )}
                    </div>
                    {section.items.map((item, offset) => {
                      const index = section.start + offset;
                      return (
                        <CommandCenterRow
                          key={item.key}
                          item={item}
                          index={index}
                          active={index === activeIndex}
                          onHighlight={() => setSelectedIdx(index)}
                          onSelect={() => activate(item, false)}
                          trailing={item.type === 'saved' ? (
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setPendingDelete(
                                savedSearches.find(saved => saved.id === item.id) ?? null,
                              )}
                              aria-label={t('search.commandCenter.saved.delete')}
                              className="mr-2 rounded p-1.5 text-text-muted hover:bg-elevated hover:text-danger"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          ) : undefined}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div role="status" className="px-4 py-3 text-center text-sm text-text-muted">
                {t('search.commandCenter.loading')}
              </div>
            )}
            {searchError && !loading && (
              <div role="alert" className="px-4 py-5 text-center text-sm text-red-400">
                {t('search.commandCenter.error')}
              </div>
            )}
            {!parsed.isEmpty && !loading && !searchError && items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                {t('search.commandCenter.noResults').replace('{query}', query)}
              </div>
            )}
            {/* Outside a project the palette matches titles only, and `tag:`,
                `status:` and `updated:` have no layer to answer them. Say so
                rather than letting an empty list read as "you have nothing". */}
            {!projectId && !parsed.isEmpty && !loading && !searchError && (
              <div className="border-t border-border px-4 py-2 text-[11px] text-text-dim">
                {t('search.commandCenter.titlesOnly')}
              </div>
            )}

            {parsed.isEmpty && (
              <div className="border-t border-border px-4 py-3">
                <div className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                  {t('search.commandCenter.operators')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {OPERATOR_HINTS.map(hint => (
                    <button
                      key={hint.id}
                      type="button"
                      onClick={() => insertOperator(hint.insert, hint.caretBack)}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left text-[11px] hover:bg-elevated"
                    >
                      <code className="font-mono text-accent-gold">{hint.syntax}</code>
                      <span className="text-text-muted">{hint.label(t)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-border px-4 py-2">
              {query.trim() && !naming && (
                <button
                  type="button"
                  onClick={() => setSaveName(query.trim().slice(0, 60))}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
                >
                  <BookmarkPlus size={13} aria-hidden="true" />
                  {t('search.commandCenter.saved.save')}
                </button>
              )}
              {naming && (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    ref={saveInputRef}
                    value={saveName ?? ''}
                    onChange={event => setSaveName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      void commitSave();
                    }}
                    placeholder={t('search.commandCenter.saved.namePlaceholder')}
                    aria-label={t('search.commandCenter.saved.namePlaceholder')}
                    className="min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold"
                  />
                  <button
                    type="button"
                    onClick={() => void commitSave()}
                    className="rounded-md bg-accent-gold px-2 py-1 text-xs font-semibold text-deep hover:bg-accent-amber"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSaveName(null); inputRef.current?.focus(); }}
                    className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-elevated"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
              {!naming && (
                <span className="ml-auto truncate text-[10px] text-text-dim">
                  {t('search.commandCenter.keyHints')}
                </span>
              )}
            </div>
          </motion.div>

          {/* Outside the palette panel on purpose: that panel clips its own
              overflow, and a dialog rendered inside it would be cut off. */}
          <div onClick={event => event.stopPropagation()}>
            <ConfirmDialog
              open={pendingDelete !== null}
              destructive
              message={t('search.commandCenter.saved.confirm').replace(
                '{name}',
                pendingDelete?.name ?? '',
              )}
              onConfirm={() => void confirmDelete()}
              onCancel={() => { setPendingDelete(null); inputRef.current?.focus(); }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
