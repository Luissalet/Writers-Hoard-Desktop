import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { searchEntities } from '@/engines/_shared';
import type { EntityPreview } from '@/engines/_types';
import { useTranslation } from '@/i18n/useTranslation';

const EMPTY_RESULTS: EntityPreview[] = [];

export interface EntityPickerProps {
  open: boolean;
  projectId: string;
  onPick: (preview: EntityPreview) => void;
  onClose: () => void;
}

/**
 * The cross-engine picker the old Brainstorm engine promised and never
 * shipped: its `entity-ref` node type had a data model, a card renderer and
 * an editor that said "created via the entity picker" — but no picker existed
 * anywhere in the codebase, so no reference could ever be created.
 *
 * This one searches every registered resolver, scoped to the current project.
 */
export default function EntityPicker({ open, projectId, onPick, onClose }: EntityPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<EntityPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Render-adjust: reopening the picker starts from a clean search rather than
  // flashing the previous one for a frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setQuery('');
  }

  const term = query.trim();
  const active = open && term.length >= 2;
  // Results are only meaningful for the term that produced them, so an
  // inactive search renders empty instead of storing an empty array.
  const results = useMemo(() => (active ? found : EMPTY_RESULTS), [active, found]);

  useEffect(() => {
    if (!active) return;
    const current = ++seq.current;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void searchEntities(term, undefined, projectId)
        .then((matches) => {
          if (current !== seq.current) return;
          setFound(matches);
        })
        .catch((reason: unknown) => {
          console.error('[board] entity search failed', reason);
          if (current === seq.current) setFound([]);
        })
        .finally(() => {
          if (current === seq.current) setBusy(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [active, term, projectId]);

  const grouped = useMemo(() => {
    const map = new Map<string, EntityPreview[]>();
    for (const result of results) {
      const bucket = map.get(result.engineId);
      if (bucket) bucket.push(result);
      else map.set(result.engineId, [result]);
    }
    return Array.from(map.entries());
  }, [results]);

  return (
    <Modal open={open} onClose={onClose} title={t('board.picker.title')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1.5">
          <Search size={14} className="text-text-dim" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('board.picker.placeholder')}
            className="flex-1 bg-transparent text-sm text-text-primary outline-none"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="text-text-dim hover:text-text-primary">
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {busy ? <p className="text-xs text-text-dim">{t('board.picker.searching')}</p> : null}
          {!busy && active && results.length === 0 ? (
            <p className="text-xs text-text-dim">{t('board.picker.empty')}</p>
          ) : null}

          {grouped.map(([engineId, entries]) => (
            <div key={engineId}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent-gold">{engineId}</p>
              <div className="space-y-1">
                {entries.map((entry) => (
                  <button
                    key={`${entry.engineId}-${entry.type}-${entry.id}`}
                    type="button"
                    onClick={() => onPick(entry)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left transition hover:border-accent-gold"
                  >
                    {entry.thumbnail ? (
                      <img src={entry.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <span
                        className="h-8 w-8 shrink-0 rounded"
                        style={{ background: entry.color ?? '#2a2a3a' }}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">{entry.title}</span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {entry.subtitle ?? entry.type}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
