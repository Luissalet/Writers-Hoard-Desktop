// ============================================
// BacklinksSection — "what references this entity?" listing
// ============================================
//
// Drop into any entity detail view (codex entry, seed card, map pin, etc.)
// to surface the bidirectional half of references — i.e. notes elsewhere
// that point *at* this entity. Clicking a row jumps to the source entity.

import { Link as LinkIcon, ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useEntityBacklinks } from '../hooks';

export interface BacklinksSectionProps {
  engineId: string;
  entityId: string;
  /** Compact mode hides the heading — useful inside dense cards. */
  compact?: boolean;
}

export default function BacklinksSection({ engineId, entityId, compact }: BacklinksSectionProps) {
  const { t } = useTranslation();
  const { items, loading } = useEntityBacklinks({ engineId, entityId });

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      {!compact && (
        <h3 className="text-xs uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
          <LinkIcon size={12} />
          {t('annotations.backlinks.title')}
          <span className="text-text-muted">· {items.length}</span>
        </h3>
      )}
      <ul className="space-y-1.5">
        {items.map((b) => {
          const adapter = getAnchorAdapter(b.sourceEngineId);
          const engineLabel = adapter?.getEngineChipLabel() ?? b.sourceEngineId;
          return (
            <li key={b.annotationId}>
              <button
                onClick={() => adapter?.navigateToEntity(b.sourceEntityId)}
                className="w-full flex items-start gap-2 rounded-md border border-border bg-bg-base/60 hover:bg-bg-elevated transition px-2.5 py-2 text-left group"
              >
                <span className="text-[10px] uppercase tracking-wide text-accent-gold mt-0.5 flex-shrink-0">
                  {engineLabel}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{b.sourceEntityTitle}</div>
                  {b.anchorSnippet && (
                    <div className="text-[11px] text-text-secondary italic truncate">
                      "{b.anchorSnippet}"
                    </div>
                  )}
                  {b.noteType === 'text' && b.noteBody && (
                    <div className="text-[11px] text-text-secondary truncate mt-0.5">
                      {b.noteBody}
                    </div>
                  )}
                </div>
                <ArrowUpRight
                  size={13}
                  className="text-text-secondary group-hover:text-accent-gold flex-shrink-0 mt-0.5"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
