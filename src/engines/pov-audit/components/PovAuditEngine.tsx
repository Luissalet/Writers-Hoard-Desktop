// ============================================
// POV Audit Engine — derived character usage view
// ============================================
//
// Read-only dashboard. No mutations, no forms. Three sub-blocks:
//   1. Totals strip (KPI cards)
//   2. Filter chips (all / mapped only / unused only / unmapped only)
//   3. Ranked bar chart of characters with line/word/scene counts
//
// All data is computed from existing tables — owned by codex / dialog-scene.

import type { ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Users, AlertTriangle, MessageSquare, Eye } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useUsageReport } from '../hooks';
import type { CharacterUsage } from '../types';

type FilterMode = 'all' | 'used' | 'unused' | 'unmapped';

export default function PovAuditEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items, loading, refresh } = useUsageReport(projectId);
  const [filter, setFilter] = useState<FilterMode>('all');

  const report = items[0];
  const rows = report?.rows ?? [];

  const filteredRows = useMemo(() => {
    if (filter === 'used') return rows.filter((r) => !r.isUnused);
    if (filter === 'unused') return rows.filter((r) => r.isUnused);
    if (filter === 'unmapped') return rows.filter((r) => r.isUnmapped);
    return rows;
  }, [rows, filter]);

  const maxLines = useMemo(
    () => filteredRows.reduce((m, r) => Math.max(m, r.lineCount), 0) || 1,
    [filteredRows],
  );

  if (loading) return <EngineSpinner />;
  if (!report) return null;

  const { totals } = report;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <Eye size={15} className="text-accent-gold" />
          {t('povAudit.title')}
        </h2>
        <button
          onClick={() => refresh()}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition"
        >
          {t('povAudit.refresh')}
        </button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi
          icon={<Users size={14} />}
          label={t('povAudit.charactersInCodex')}
          value={totals.charactersInCodex}
        />
        <Kpi
          icon={<MessageSquare size={14} />}
          label={t('povAudit.charactersUsed')}
          value={totals.charactersUsed}
        />
        <Kpi
          icon={<AlertTriangle size={14} />}
          label={t('povAudit.unused')}
          value={totals.unusedCount}
          warn={totals.unusedCount > 0}
        />
        <Kpi
          icon={<AlertTriangle size={14} />}
          label={t('povAudit.unmapped')}
          value={totals.unmappedCount}
          warn={totals.unmappedCount > 0}
        />
      </div>

      <p className="text-xs text-text-secondary">
        {t('povAudit.scannedSummary')
          .replace('{scenes}', String(totals.sceneCount))
          .replace('{blocks}', String(totals.blockCount))
          .replace('{words}', totals.totalWords.toLocaleString())}
      </p>

      {/* Filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        {(['all', 'used', 'unused', 'unmapped'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              filter === mode
                ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
                : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            }`}
          >
            {t(`povAudit.filter.${mode}`)}
          </button>
        ))}
      </div>

      {/* Ranking */}
      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-secondary">
          {t('povAudit.empty')}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {filteredRows.map((row) => (
            <CharacterRow key={row.characterId} row={row} maxLines={maxLines} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------
function Kpi({
  icon,
  label,
  value,
  warn,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  warn?: boolean;
}): ReactElement {
  return (
    <div
      className={`rounded-lg border p-3 ${
        warn && value > 0
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border bg-bg-elevated/40'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-text-secondary uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${
          warn && value > 0 ? 'text-amber-400' : 'text-text-primary'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Character row — bar chart cell with stats inline
// ---------------------------------------------------------------------------
function CharacterRow({
  row,
  maxLines,
}: {
  row: CharacterUsage;
  maxLines: number;
}): ReactElement {
  const { t } = useTranslation();
  const widthPct = Math.max(2, Math.round((row.lineCount / maxLines) * 100));
  const accent = row.color || '#c4973b';

  return (
    <li className="rounded-md border border-border bg-bg-elevated/30 px-3 py-2">
      <div className="flex items-center gap-3">
        {row.avatar ? (
          <img
            src={row.avatar}
            alt=""
            className="h-7 w-7 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="h-7 w-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-black"
            style={{ background: accent }}
          >
            {row.characterName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-text-primary truncate">
              {row.characterName}
            </span>
            {row.isUnmapped && (
              <span
                className="text-[10px] uppercase tracking-wide text-amber-400"
                title={t('povAudit.unmappedHint')}
              >
                {t('povAudit.unmapped')}
              </span>
            )}
            {row.isUnused && !row.isUnmapped && (
              <span
                className="text-[10px] uppercase tracking-wide text-text-secondary"
                title={t('povAudit.unusedHint')}
              >
                {t('povAudit.unused')}
              </span>
            )}
          </div>

          <div className="h-1.5 w-full rounded-full bg-bg-base overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${widthPct}%`, background: accent }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-[11px] text-text-secondary flex-shrink-0">
          <Stat label={t('povAudit.scenes')} value={row.sceneCount} />
          <Stat label={t('povAudit.lines')} value={row.lineCount} />
          <Stat label={t('povAudit.words')} value={row.wordCount} />
        </dl>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="text-right">
      <dt className="uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-semibold text-text-primary">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
