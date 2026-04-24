import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Layers, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';
import { useTranslation } from '@/i18n/useTranslation';
import { getEngine } from '@/engines/_registry';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';

export default function GlobalSearch() {
  const { t } = useTranslation();
  const { searchOpen, setSearchOpen } = useAppStore();
  const { search } = useGlobalSearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, setSearchOpen]);

  // Focus on open
  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  const doSearch = useCallback(async (q: string) => {
    const found = await search(q);
    setResults(found);
    setSelectedIdx(0);
  }, [search]);

  useEffect(() => { doSearch(query); }, [query, doSearch]);

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'project') {
      navigate(`/project/${result.id}`);
    } else if (result.type === 'entity' && result.engineId) {
      // Prefer the engine's own navigator (anchor-adapter has route knowledge).
      const adapter = getAnchorAdapter(result.engineId);
      if (adapter) {
        adapter.navigateToEntity(result.id);
      }
      // For engines without an anchor adapter (diary, timeline, etc.), we
      // can't yet deep-link to an individual row — fall back to the engine
      // tab on the current project if we have one.
    }
    setSearchOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[selectedIdx]) { handleSelect(results[selectedIdx]); }
    else if (e.key === 'Escape') { setSearchOpen(false); }
  };

  const renderIcon = (result: SearchResult) => {
    if (result.type === 'project') {
      return <Layers size={16} className="text-accent-gold" />;
    }
    if (result.type === 'entity' && result.engineId) {
      const engine = getEngine(result.engineId);
      if (engine) {
        const Icon = engine.icon;
        return <Icon size={16} className="text-accent-plum-light" />;
      }
    }
    return <Search size={16} className="text-text-muted" />;
  };

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setSearchOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.95, y: -20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: -20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={18} className="text-text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('search.placeholder')}
                className="flex-1 bg-transparent border-none outline-none text-text-primary"
              />
              <button onClick={() => setSearchOpen(false)} className="p-1 hover:bg-elevated rounded">
                <X size={16} className="text-text-muted" />
              </button>
            </div>

            {results.length > 0 && (
              <div className="max-h-[50vh] overflow-y-auto py-2">
                {results.map((result, idx) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => handleSelect(result)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${
                      idx === selectedIdx ? 'bg-elevated' : 'hover:bg-elevated/50'
                    }`}
                  >
                    {renderIcon(result)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{result.title}</div>
                      <div className="text-xs text-text-muted capitalize truncate">
                        {result.engineId ? `${result.engineId} · ` : ''}{result.subtitle}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {query && results.length === 0 && (
              <div className="py-8 text-center text-text-muted text-sm">
                {t('search.noResults')} "{query}"
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
