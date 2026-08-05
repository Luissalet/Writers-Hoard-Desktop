import { useState } from 'react';
import { BookmarkPlus, Map, Pencil, Search, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/engines/_shared';
import type { SavedWorldRegion } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface SavedRegionsPanelProps {
  regions: SavedWorldRegion[];
  onOpen: (region: SavedWorldRegion) => void;
  onCreateHere: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export default function SavedRegionsPanel({
  regions,
  onOpen,
  onCreateHere,
  onRename,
  onDelete,
}: SavedRegionsPanelProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deleting = regions.find((region) => region.id === deleteId);

  const beginRename = (region: SavedWorldRegion) => {
    setEditingId(region.id);
    setDraft(region.title);
  };

  const commitRename = () => {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRename(editingId, title);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <button
        type="button"
        onClick={onCreateHere}
        className="flex items-center justify-center gap-2 rounded-lg border border-accent-gold/35 bg-accent-gold/10 px-3 py-2 text-xs text-accent-gold hover:bg-accent-gold/15"
      >
        <BookmarkPlus size={14} />
        {t('worldgen.regions.saveView')}
      </button>

      {regions.length > 0 && (
        <label className="flex items-center gap-1.5 rounded-lg border border-border bg-deep px-2">
          <Search size={12} className="text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('worldgen.regions.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
        </label>
      )}

      {regions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
          {t('worldgen.regions.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {regions
            .slice()
            .filter((region) => region.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((region) => (
              <div
                key={region.id}
                className="group flex items-center gap-2 rounded-lg border border-border bg-elevated/60 px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => onOpen(region)}
                  className="min-w-0 flex-1 text-left"
                >
                  {editingId === region.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename();
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="w-full rounded border border-accent-gold/40 bg-deep px-2 py-1 text-xs text-text-primary outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 truncate text-xs font-medium text-text-primary">
                        <Map size={12} className="shrink-0 text-accent-gold" />
                        {region.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-text-muted">
                        {t('worldgen.regions.meta')
                          .replace('{km}', String(region.spanKm))
                          .replace('{cells}', String(region.params.res))}
                      </span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => beginRename(region)}
                  className="rounded p-1 text-text-muted opacity-60 hover:bg-surface hover:text-text-primary group-hover:opacity-100"
                  title={t('worldgen.regions.rename')}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(region.id)}
                  className="rounded p-1 text-text-muted opacity-60 hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                  title={t('worldgen.regions.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        destructive
        message={t('worldgen.regions.deleteConfirm').replace('{name}', deleting?.title ?? '')}
        onConfirm={() => {
          if (deleteId) onDelete(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
