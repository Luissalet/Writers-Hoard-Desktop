import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, BookOpen, Layers, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';

export default function GlobalSearch() {
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
    } else if (result.type === 'codex' && result.projectId) {
      navigate(`/project/${result.projectId}/codex?entry=${result.id}`);
    }
    setSearchOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[selectedIdx]) { handleSelect(results[selectedIdx]); }
    else if (e.key === 'Escape') { setSearchOpen(false); }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'project': return <Layers size={16} className="text-accent-gold" />;
      case 'codex': return <BookOpen size={16} className="text-accent-plum-light" />;
      default: return <Search size={16} className="text-text-muted" />;
    }
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
                placeholder="Search projects, characters, locations..."
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
                    {getIcon(result.type)}
                    <div>
                      <div className="text-sm text-text-primary">{result.title}</div>
                      <div className="text-xs text-text-muted capitalize">{result.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {query && results.length === 0 && (
              <div className="py-8 text-center text-text-muted text-sm">
                No results for "{query}"
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
