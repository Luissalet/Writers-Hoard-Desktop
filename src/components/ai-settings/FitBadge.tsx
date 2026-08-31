// ============================================================================
// AI settings — "does it fit?" badge
// ============================================================================

import { useTranslation } from '@/i18n/useTranslation';
import { formatBytes } from '@/services/aiRuntime/fit';
import type { FitEstimate } from '@/services/aiRuntime/types';

const TONE: Record<FitEstimate['label'], string> = {
  perfect: 'bg-success/15 text-success border-success/30',
  good: 'bg-accent-gold/15 text-accent-gold border-accent-gold/30',
  tight: 'bg-warning/15 text-warning border-warning/30',
  'no-fit': 'bg-danger/15 text-danger border-danger/30',
};

export default function FitBadge({ fit, compact = false }: { fit: FitEstimate | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (!fit) return null;
  const title = [
    `${t('settings.ai.fit.total')}: ${formatBytes(fit.totalBytes)}`,
    `${t('settings.ai.fit.weights')}: ${formatBytes(fit.weightsBytes)}`,
    `${t('settings.ai.fit.kv')} (${Math.round(fit.contextTokens / 1024)}K): ${formatBytes(fit.kvCacheBytes)}`,
    `${t('settings.ai.fit.placement')}: ${t(`settings.ai.fit.placement.${fit.placement}`)}`,
    `${t('settings.ai.fit.speed')}: ${t(`settings.ai.fit.speed.${fit.speedHint}`)}${fit.tokensPerSecond ? ` (${fit.tokensPerSecond} tok/s, ${fit.speedSource === 'measured' ? t('settings.ai.fit.speedMeasured') : t('settings.ai.fit.speedEstimated')})` : ''}`,
    fit.confidence === 'measured' ? t('settings.ai.fit.measured') : t('settings.ai.fit.estimated'),
  ].join('\n');
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${TONE[fit.label]}`}
    >
      {t(`settings.ai.fit.${fit.label}`)}
      {!compact && (
        <span className="opacity-70">
          {fit.speedSource === 'measured' && fit.tokensPerSecond
            ? ` · ${Math.round(fit.tokensPerSecond)} tok/s`
            : ` · ${t(`settings.ai.fit.speed.${fit.speedHint}`)}${fit.confidence === 'estimated' ? ' ≈' : ''}`}
        </span>
      )}
    </span>
  );
}
