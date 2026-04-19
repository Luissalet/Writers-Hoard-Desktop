// ============================================
// ReferenceChip — the "square" embedded in a reference note
// ============================================
//
// Layout (horizontal):
//   [Engine label] [Title — truncated] [jump →]
//
// Resolves title via the target engine's AnchorAdapter. Falls back to
// "(missing)" if the target was deleted — lets the user see the dangling
// link rather than silently disappearing.

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useTranslation } from '@/i18n/useTranslation';

export interface ReferenceChipProps {
  targetEngineId: string;
  targetEntityId: string;
}

export default function ReferenceChip({
  targetEngineId,
  targetEntityId,
}: ReferenceChipProps) {
  const { t } = useTranslation();
  const adapter = getAnchorAdapter(targetEngineId);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!adapter) {
        setTitle(null);
        setLoading(false);
        return;
      }
      const t = await adapter.getEntityTitle(targetEntityId);
      if (!cancelled) {
        setTitle(t);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, targetEntityId]);

  if (!adapter) {
    return (
      <div className="rounded-md border border-border bg-bg-base/60 px-2.5 py-1.5 text-xs text-text-secondary">
        {t('annotations.chip.unknownEngine')}
      </div>
    );
  }

  const engineLabel = adapter.getEngineChipLabel();

  return (
    <button
      onClick={() => adapter.navigateToEntity(targetEntityId)}
      disabled={loading}
      className="w-full flex items-center gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/5 hover:bg-accent-gold/10 transition px-2.5 py-1.5 text-left group"
    >
      <span className="text-[10px] uppercase tracking-wide text-accent-gold flex-shrink-0">
        {engineLabel}
      </span>
      <span className="flex-1 min-w-0 text-xs text-text-primary truncate">
        {loading ? '…' : title ?? t('annotations.chip.missingTarget')}
      </span>
      <ArrowUpRight
        size={13}
        className="text-text-secondary group-hover:text-accent-gold flex-shrink-0"
      />
    </button>
  );
}
