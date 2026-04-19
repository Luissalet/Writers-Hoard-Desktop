// ============================================
// Annotations Engine — Project-level dashboard
// ============================================
//
// Cross-cutting read-only view. Lists every annotation in the project,
// grouped by source engine, with orphan count pinned at the top so the user
// can fix drifted anchors in one place.

import { useMemo } from 'react';
import { MessageSquare, AlertTriangle, FileText, Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useAnnotationsForProject, useOrphanCount } from '../hooks';
import type { Annotation, NoteType } from '../types';

export default function AnnotationsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items, loading, refresh } = useAnnotationsForProject(projectId);
  const { count: orphanCount } = useOrphanCount(projectId);

  const grouped = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const ann of items) {
      const list = map.get(ann.sourceEngineId) ?? [];
      list.push(ann);
      map.set(ann.sourceEngineId, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  if (loading) return <EngineSpinner />;

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

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-secondary">
          {t('annotations.dashboard.empty')}
        </div>
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
  const adapter = getAnchorAdapter(ann.sourceEngineId);
  const snippet =
    ann.anchor.selectedText ||
    (ann.noteType === 'text' && ann.noteBody) ||
    '—';

  return (
    <li className="flex items-start gap-2 rounded-md border border-border/70 bg-bg-base/60 px-2.5 py-2">
      <NoteTypeIcon type={ann.noteType} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-secondary truncate">{snippet}</div>
      </div>
      {ann.isOrphaned && (
        <span className="text-[10px] uppercase tracking-wide text-amber-400 flex items-center gap-1">
          <AlertTriangle size={10} />
          orphaned
        </span>
      )}
      {adapter && (
        <button
          onClick={() => adapter.navigateToEntity(ann.sourceEntityId)}
          className="text-[11px] text-accent-gold hover:underline flex-shrink-0"
        >
          open
        </button>
      )}
    </li>
  );
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
