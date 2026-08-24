import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
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
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';
import { useTranslation } from '@/i18n/useTranslation';
import { getEngine } from '@/engines/_registry';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useProject } from '@/hooks/useProjects';
import {
  buildCommandCenterActions,
  filterCommandCenterActions,
  getOrderedEnabledEngineIds,
  moveCommandCenterSelection,
  type CommandCenterAction,
  type CommandCenterActionIcon,
} from '@/services/commandCenter';

interface PresentedAction extends CommandCenterAction {
  title: string;
  subtitle: string;
}

type CommandCenterItem = PresentedAction | SearchResult;

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
}: {
  item: CommandCenterItem;
  index: number;
  active: boolean;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      id={`command-center-option-${index}`}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseEnter={onHighlight}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
        active ? 'bg-elevated' : 'hover:bg-elevated/50'
      }`}
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
  const { search } = useGlobalSearch(projectId, enabledEngineIds);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchSequenceRef = useRef(0);
  const navigate = useNavigate();

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
      const shortcut =
        (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLocaleLowerCase() === 'k';
      if (!shortcut || event.repeat) return;
      event.preventDefault();
      if (searchOpen) closeSearch();
      else setSearchOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeSearch, searchOpen, setSearchOpen]);

  const [wasOpen, setWasOpen] = useState(false);
  if (searchOpen !== wasOpen) {
    setWasOpen(searchOpen);
    if (searchOpen) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setLoading(false);
      setSearchError(false);
    }
  }

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  const runSearch = useCallback(async (value: string, sequence: number) => {
    setLoading(true);
    setSearchError(false);
    setResults([]);
    try {
      const found = await search(value);
      if (sequence !== searchSequenceRef.current) return;
      setResults(found);
      setSelectedIdx(0);
    } catch (error) {
      if (sequence !== searchSequenceRef.current) return;
      console.error('Command center search failed', error);
      setResults([]);
      setSearchError(true);
    } finally {
      if (sequence === searchSequenceRef.current) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!searchOpen || !query.trim()) return;
    const sequence = ++searchSequenceRef.current;
    const timer = window.setTimeout(() => {
      void runSearch(query, sequence);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, runSearch, searchOpen]);

  const allActions = buildCommandCenterActions(activeProject ? {
    id: activeProject.id,
    enabledEngines: activeProject.enabledEngines,
    engineOrder: activeProject.engineOrder,
  } : undefined).filter(item => !item.engineId || Boolean(getEngine(item.engineId)));
  const actionResults: PresentedAction[] = filterCommandCenterActions(
    allActions,
    query,
    item => `${t(item.labelKey)} ${t(item.detailKey)} ${t(item.keywordsKey)}`,
  ).map(item => ({
    ...item,
    title: t(item.labelKey),
    subtitle: t(item.detailKey),
  }));
  const searchResults = query.trim() ? results : [];
  const items: CommandCenterItem[] = [...actionResults, ...searchResults];
  const activeIndex = items.length > 0 ? Math.min(selectedIdx, items.length - 1) : 0;

  useEffect(() => {
    if (!searchOpen || items.length === 0) return;
    document.getElementById(`command-center-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items.length, searchOpen]);

  const updateQuery = (value: string) => {
    searchSequenceRef.current += 1;
    setQuery(value);
    setResults([]);
    setSelectedIdx(0);
    setSearchError(false);
    setLoading(Boolean(value.trim()));
  };

  const handleSelect = (item: CommandCenterItem) => {
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
    closeSearch(false);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIdx(index => moveCommandCenterSelection(index, items.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIdx(index => moveCommandCenterSelection(index, items.length, -1));
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault();
      handleSelect(items[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [inputRef.current, closeButtonRef.current].filter(
      (element): element is HTMLInputElement | HTMLButtonElement => element !== null,
    );
    if (focusable.length === 0) return;
    const activeElement = document.activeElement;
    const current = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLButtonElement
      ? focusable.indexOf(activeElement)
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
                ref={closeButtonRef}
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
                {actionResults.length > 0 && (
                  <div role="group" aria-labelledby="command-center-actions-label">
                    <div id="command-center-actions-label" className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                      {t('search.commandCenter.actions')}
                    </div>
                    {actionResults.map((item, index) => (
                      <CommandCenterRow
                        key={item.key}
                        item={item}
                        index={index}
                        active={index === activeIndex}
                        onHighlight={() => setSelectedIdx(index)}
                        onSelect={() => handleSelect(item)}
                      />
                    ))}
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div role="group" aria-labelledby="command-center-results-label">
                    <div id="command-center-results-label" className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                      {t('search.commandCenter.results')}
                    </div>
                    {searchResults.map((item, resultIndex) => {
                      const index = actionResults.length + resultIndex;
                      return (
                        <CommandCenterRow
                          key={item.key}
                          item={item}
                          index={index}
                          active={index === activeIndex}
                          onHighlight={() => setSelectedIdx(index)}
                          onSelect={() => handleSelect(item)}
                        />
                      );
                    })}
                  </div>
                )}
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
            {query.trim() && !loading && !searchError && items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                {t('search.commandCenter.noResults').replace('{query}', query)}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
