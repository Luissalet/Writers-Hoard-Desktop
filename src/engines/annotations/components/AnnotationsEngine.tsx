// ============================================
// Annotations Engine — Project-level dashboard
// ============================================
//
// Cross-cutting read-only view. Lists every annotation in the project,
// grouped by source engine, with orphan count pinned at the top so the user
// can fix drifted anchors in one place.

import { useMemo, useState } from 'react';
import { MessageSquare, AlertTriangle, FileText, Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useAnnotationsForProject } from '../hooks';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';
import type { Annotation, NoteType } from '../types';

export default function AnnotationsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items, loading, error, refetching, refresh } = useAnnotationsForProject(projectId);
  const [query, setQuery] = useState('');
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const orphanCount = items.filter(ann => ann.isOrphaned).length;
  const search = foldText(query.trim());

  const grouped = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const ann of items) {
      if (onlyOrphans && !ann.isOrphaned) continue;
      if (search && !foldText(`${ann.noteBody ?? ''} ${ann.anchor.selectedText ?? ''}`).includes(search)) continue;
      const list = map.get(ann.sourceEngineId) ?? [];
      list.push(ann);
      map.set(ann.sourceEngineId, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items, search, onlyOrphans]);

  if (loading) return <EngineSpinner />;
  if (error) return <ReadErrorNotice onRetry={refresh} retrying={refetching} />;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <MessageSquare size={15} className="text-accent-gold" />
          {t('annotations.dashboard.title')}
        </h2>
        <button
          onClick={() => refresh()}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition"
        >
          {t('common.refresh')}
        </button>
      </header>

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Kpi
          icon={<MessageSquare size={14} />}
          label={t('annotations.dashboard.total')}
          value={items.length}
        />
        <Kpi
          icon={<AlertTriangle size={14} />}
          label={t('annotations.dashboard.orphans')}
          value={orphanCount}
          warn={orphanCount > 0}
        />
        <Kpi
          icon={<LinkIcon size={14} />}
          label={t('annotations.dashboard.references')}
          value={items.filter((a) => a.noteType === 'reference').length}
        />
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('annotations.searchNotes')} placeholder={t('annotations.searchNotes')} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
          <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={onlyOrphans} onChange={event => setOnlyOrphans(event.target.checked)} />{t('annotations.onlyOrphans')}</label>
          {(query || onlyOrphans) && <button type="button" onClick={() => { setQuery(''); setOnlyOrphans(false); }} className="px-3 py-2 text-sm text-accent-gold hover:underline">{t('common.resetFilters')}</button>}
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-secondary">
          {t('annotations.dashboard.empty')}
        </div>
      ) : grouped.length === 0 ? (
        <p role="status" className="py-6 text-sm text-text-muted">{t('common.filteredEmpty')}</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([engineId, anns]) => (
            <EngineGroup key={engineId} engineId={engineId} annotations={anns} />
          ))}
        </div>
      )}
    </div>
  );
}

function EngineGroup({ engineId, annotations }: { engineId: string; annotations: Annotation[] }) {
  const adapter = getAnchorAdapter(engineId);
  const label = adapter?.getEngineChipLabel() ?? engineId;

  return (
    <section className="rounded-lg border border-border bg-bg-elevated/30 p-3">
      <h3 className="text-xs uppercase tracking-wide text-text-secondary mb-2">
        {label} · {annotations.length}
      </h3>
      <ul className="space-y-1.5">
        {annotations.map((ann) => (
          <AnnotationRow key={ann.id} ann={ann} />
        ))}
      </ul>
    </section>
  );
}

function AnnotationRow({ ann }: { ann: Annotation }) {
  const { t } = useTranslation();
  const adapter = getAnchorAdapter(ann.sourceEngineId);
  const snippet =
    ann.noteBody ||
    ann.anchor.selectedText ||
    '—';

  return (
    <li className="flex items-start gap-2 rounded-md border border-border/70 bg-bg-base/60 px-2.5 py-2">
      <NoteTypeIcon type={ann.noteType} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-3">{snippet}</p>
        {ann.noteBody && ann.anchor.selectedText && <p className="mt-1 text-xs text-text-muted line-clamp-2">{ann.anchor.selectedText}</p>}
      </div>
      {ann.isOrphaned && (
        <span className="text-[10px] uppercase tracking-wide text-amber-400 flex items-center gap-1">
          <AlertTriangle size={10} />
          {t('annotations.card.orphan')}
        </span>
      )}
      {adapter && (
        <button
          onClick={() => adapter.navigateToEntity(ann.sourceEntityId, ann.projectId)}
          className="text-[11px] text-accent-gold hover:underline flex-shrink-0"
        >
          {t('common.open')}
        </button>
      )}
    </li>
  );
}

function foldText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function NoteTypeIcon({ type }: { type: NoteType }) {
  const size = 13;
  if (type === 'image') return <ImageIcon size={size} className="text-text-secondary mt-0.5" />;
  if (type === 'reference') return <LinkIcon size={size} className="text-accent-gold mt-0.5" />;
  return <FileText size={size} className="text-text-secondary mt-0.5" />;
}

function Kpi({
  icon,
  label,
  value,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        warn && value > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-bg-elevated/40'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-text-secondary uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 text-xl font-semibold ${warn && value > 0 ? 'text-amber-400' : 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  );
}
