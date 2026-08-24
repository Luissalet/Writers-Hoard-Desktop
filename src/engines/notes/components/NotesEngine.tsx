import { useMemo, useState } from 'react';
import { Search, StickyNote, X } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import EmptyState from '@/components/common/EmptyState';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { useProjects } from '@/hooks/useProjects';
import { notifyNotesChanged, useNotes } from '../hooks';
import { makeNote, moveNote } from '../operations';
import { GLOBAL_NOTES_SCOPE, NOTE_KINDS, NOTE_KIND_META, type Note, type NoteKind } from '../types';
import NoteCard from './NoteCard';
import NoteComposer, { type NoteDraft } from './NoteComposer';

type KindFilter = NoteKind | 'all';

/**
 * The notes board. Mounted twice with different scopes:
 *  - as a project engine tab (`projectId` = the project)
 *  - as the standalone inbox page (`projectId` = GLOBAL_NOTES_SCOPE), which
 *    additionally offers "move to project" on every card.
 */
export default function NotesEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const isInbox = projectId === GLOBAL_NOTES_SCOPE;
  const { items: notes, loading, addItem, editItem, removeItem, refresh } = useNotes(projectId);
  const { projects } = useProjects();
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const deepLinkedNoteId = useDeepLinkParam('note');
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);

  if (
    deepLinkedNoteId
    && deepLinkedNoteId !== appliedDeepLink
    && notes.some((note) => note.id === deepLinkedNoteId)
  ) {
    setAppliedDeepLink(deepLinkedNoteId);
    setKindFilter('all');
    setQuery('');
  }

  const moveTargets = useMemo(
    () => (isInbox ? projects.map((p) => ({ id: p.id, title: p.title })) : []),
    [isInbox, projects],
  );

  const allTags = useMemo(
    () => Array.from(new Set(notes.flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b)),
    [notes],
  );

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: notes.length };
    for (const k of NOTE_KINDS) counts[k] = 0;
    for (const n of notes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    return counts;
  }, [notes]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        n.text.toLowerCase().includes(q) ||
        (n.source ?? '').toLowerCase().includes(q) ||
        n.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [notes, kindFilter, query]);

  const handleCreate = (draft: NoteDraft) => {
    void (async () => {
      await addItem(makeNote(projectId, draft));
      notifyNotesChanged();
    })();
  };

  const handleDelete = (id: string) => {
    void (async () => {
      await removeItem(id);
      notifyNotesChanged();
    })();
  };

  const handleMove = (id: string, targetProjectId: string) => {
    void (async () => {
      await moveNote(id, targetProjectId);
      await refresh();
      notifyNotesChanged();
      const target = projects.find((p) => p.id === targetProjectId);
      toast.success(`${t('notes.moved')} ${target?.title ?? ''}`.trim());
    })();
  };

  if (loading && notes.length === 0) return <EngineSpinner />;

  return (
    <div className="flex flex-col h-full bg-deep">
      <div className="p-4 pb-0">
        <NoteComposer onSubmit={handleCreate} tagSuggestions={allTags} />
      </div>

      {/* Filters */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', ...NOTE_KINDS] as KindFilter[]).map((k) => {
            const active = kindFilter === k;
            const meta = k === 'all' ? null : NOTE_KIND_META[k];
            const Icon = meta?.icon;
            return (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${
                  active
                    ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
                    : 'border-border text-text-muted hover:text-text-primary hover:bg-elevated'
                }`}
              >
                {Icon && <Icon size={13} style={{ color: meta?.color }} />}
                {k === 'all' ? t('common.all') : t(`notes.kind.${k}`)}
                <span className="text-text-dim">{kindCounts[k] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('notes.search')}
            className="w-full pl-8 pr-8 py-1.5 bg-elevated border border-border rounded-lg text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary transition"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {visible.length === 0 ? (
          <EmptyState
            icon={<StickyNote size={40} />}
            title={query || kindFilter !== 'all' ? t('notes.noResults') : t('notes.empty.title')}
            message={
              query || kindFilter !== 'all' ? t('notes.adjustSearch') : t('notes.empty.message')
            }
          />
        ) : (
          <div className="columns-1 md:columns-2 xl:columns-3 gap-3">
            {visible.map((note: Note) => (
              <NoteCard
                key={note.id}
                note={note}
                onUpdate={editItem}
                onDelete={handleDelete}
                moveTargets={moveTargets}
                onMove={handleMove}
                onTagClick={(tag) => setQuery(tag)}
                deepLinkToken={note.id === deepLinkedNoteId ? deepLinkedNoteId : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
