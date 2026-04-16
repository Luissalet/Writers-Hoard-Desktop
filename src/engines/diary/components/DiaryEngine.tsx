import { useState, useMemo, useCallback } from 'react';
import { BookOpen, Plus, Search, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useDiaryEntries } from '../hooks';
import type { DiaryEntry, DiaryMood } from '../types';
import { MOOD_CONFIG } from '../types';
import { generateId } from '@/utils/idGenerator';
import QuickEntry from './QuickEntry';
import EntryCard from './EntryCard';
import EntryEditor from './EntryEditor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByDate(entries: DiaryEntry[]): Map<string, DiaryEntry[]> {
  const map = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const day = e.entryDate.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return map;
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return '__TODAY__';
  if (d.toDateString() === yesterday.toDateString()) return '__YESTERDAY__';

  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

// ---------------------------------------------------------------------------
// DiaryEngine
// ---------------------------------------------------------------------------

export default function DiaryEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: entries, loading, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useDiaryEntries(projectId);

  // null = timeline view, string = editing existing, 'new' = creating new full entry
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMood, setFilterMood] = useState<DiaryMood | ''>('');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  // --- Filtering ---
  const filtered = useMemo(() => {
    let list = entries;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (filterMood) {
      list = list.filter((e) => e.mood === filterMood);
    }
    return list;
  }, [entries, searchQuery, filterMood]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);
  const sortedDays = useMemo(() => Array.from(grouped.keys()).sort().reverse(), [grouped]);

  // --- Quick add ---
  const handleQuickAdd = useCallback(
    async (content: string, mood?: DiaryMood) => {
      const now = new Date();
      const entry: DiaryEntry = {
        id: generateId('diary'),
        projectId,
        entryDate: now.toISOString().slice(0, 16),
        title: '',
        content,
        mood,
        tags: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await addEntry(entry);
    },
    [projectId, addEntry],
  );

  // --- Day collapse ---
  const toggleDay = useCallback((day: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

  // --- Loading ---
  if (loading) return <EngineSpinner />;

  // --- New full entry ---
  if (editingId === 'new') {
    const now = new Date();
    const blank: DiaryEntry = {
      id: generateId('diary'),
      projectId,
      entryDate: now.toISOString().slice(0, 16),
      title: '',
      content: '',
      mood: undefined,
      tags: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return (
      <EntryEditor
        entry={blank}
        isNew
        onSave={async (changes) => {
          await addEntry({ ...blank, ...changes });
          setEditingId(null);
        }}
        onDelete={async () => setEditingId(null)}
        onClose={() => setEditingId(null)}
      />
    );
  }

  // --- Editing existing entry ---
  if (editingId) {
    const entry = entries.find((e) => e.id === editingId);
    if (entry) {
      return (
        <EntryEditor
          entry={entry}
          onSave={async (changes) => {
            await editEntry(entry.id, changes);
            setEditingId(null);
          }}
          onDelete={async () => {
            await removeEntry(entry.id);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Top bar: Quick entry + New full entry ---- */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <QuickEntry onSubmit={handleQuickAdd} />
        </div>
        <button
          onClick={() => setEditingId('new')}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-accent-gold/10 text-accent-gold rounded-xl hover:bg-accent-gold/20 border border-accent-gold/20 transition whitespace-nowrap mt-0.5"
        >
          <Plus size={15} />
          {t('diary.newEntry')}
        </button>
      </div>

      {/* ---- Search / filter bar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('diary.searchEntries')}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
        </div>

        {/* Mood filter */}
        <select
          value={filterMood}
          onChange={(e) => setFilterMood(e.target.value as DiaryMood | '')}
          className="px-2.5 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition cursor-pointer"
        >
          <option value="">{t('diary.allMoods')}</option>
          {Object.entries(MOOD_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.emoji} {cfg.label}
            </option>
          ))}
        </select>

        <span className="text-xs text-text-dim whitespace-nowrap">
          {filtered.length} {filtered.length === 1 ? t('diary.entry.singular') : t('diary.entry.plural')}
        </span>
      </div>

      {/* ---- Day-grouped timeline ---- */}
      {sortedDays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-dim">
          <BookOpen size={36} className="mb-3 opacity-40" />
          <p className="text-sm">
            {entries.length === 0
              ? t('diary.noEntries')
              : t('diary.noResults')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDays.map((day) => {
            const dayEntries = grouped.get(day)!;
            const collapsed = collapsedDays.has(day);

            return (
              <div key={day}>
                <button
                  onClick={() => toggleDay(day)}
                  className="flex items-center gap-2 mb-2 group w-full text-left"
                >
                  {collapsed ? (
                    <ChevronRight size={14} className="text-text-dim group-hover:text-accent-gold transition" />
                  ) : (
                    <ChevronDown size={14} className="text-text-dim group-hover:text-accent-gold transition" />
                  )}
                  <Calendar size={12} className="text-accent-gold" />
                  <span className="text-sm font-semibold text-text-primary">
                    {(() => {
                      const header = formatDayHeader(day);
                      if (header === '__TODAY__') return t('diary.today');
                      if (header === '__YESTERDAY__') return t('diary.yesterday');
                      return header;
                    })()}
                  </span>
                  <span className="text-xs text-text-dim">
                    ({dayEntries.length})
                  </span>
                </button>

                {!collapsed && (
                  <div className="ml-5 space-y-2 border-l-2 border-border pl-4">
                    {dayEntries.map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        onEdit={() => setEditingId(entry.id)}
                        onTogglePin={async () => {
                          await editEntry(entry.id, { pinned: !entry.pinned });
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
