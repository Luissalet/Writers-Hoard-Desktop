import { useMemo, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from '@/i18n/useTranslation';
import { refKey } from '../derive';
import type { InquiryModel } from '../hooks';
import { CLAIM_STATUSES, type InquiryRef } from '../types';
import { cardClass, refLabel, STATUS_STYLE, validityLabel } from './styles';
import { CountsLine, StatusBadge, TimeBadge } from './shared';

const WIDTH = 720;
const HEIGHT = 460;

/** Claims with both ends become edges; the ends become nodes on a circle. */
export default function GraphTab({ model, asOf }: { model: InquiryModel; asOf: string | null }) {
  const { t } = useTranslation();
  const [showRetracted, setShowRetracted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const entries = useMemo(() => new Map((model.snapshot?.entries ?? []).map(entry => [entry.id, entry])), [model.snapshot]);
  const missing = t('inquiry.claim.missingEntity');

  const { nodes, edges, unlinked } = useMemo(() => {
    const live = model.views.filter(view => (!asOf || view.inEffect) && (showRetracted || view.status !== 'retracted'));
    const linked = live.filter(view => refKey(view.claim.subject) && refKey(view.claim.object));
    const ends = new Map<string, InquiryRef>();
    for (const view of linked) {
      ends.set(refKey(view.claim.subject)!, view.claim.subject!);
      ends.set(refKey(view.claim.object)!, view.claim.object!);
    }
    const keys = [...ends.keys()];
    const flowNodes: Node[] = keys.map((key, index) => {
      const angle = (2 * Math.PI * index) / Math.max(1, keys.length) - Math.PI / 2;
      const ref = ends.get(key)!;
      const entry = ref.kind === 'codex' ? entries.get(ref.id) : undefined;
      return {
        id: key,
        position: {
          x: WIDTH / 2 + Math.cos(angle) * (keys.length > 1 ? 260 : 0),
          y: HEIGHT / 2 + Math.sin(angle) * (keys.length > 1 ? 170 : 0),
        },
        data: { label: refLabel(ref, entries, missing) },
        style: {
          borderRadius: 8, padding: '6px 10px', fontSize: 12,
          border: ref.kind === 'codex' ? '1px solid var(--color-accent-gold, #c4973b)' : '1px dashed #9ca3af',
          background: 'var(--color-elevated, #1f1f1f)', color: 'var(--color-text-primary, #eee)',
          opacity: entry || ref.kind === 'text' ? 1 : 0.6,
        },
      };
    });
    const flowEdges: Edge[] = linked.map(view => ({
      id: view.claim.id,
      source: refKey(view.claim.subject)!,
      target: refKey(view.claim.object)!,
      label: view.claim.predicate ?? '',
      animated: false,
      selected: selected === view.claim.id,
      style: {
        stroke: STATUS_STYLE[view.status].color,
        strokeWidth: selected === view.claim.id ? 3 : 2,
        strokeDasharray: view.timeState === 'ended' ? '6 4' : undefined,
      },
      labelStyle: { fontSize: 11, fill: STATUS_STYLE[view.status].color },
      markerEnd: { type: MarkerType.ArrowClosed, color: STATUS_STYLE[view.status].color },
      data: { status: view.status },
    }));
    return { nodes: flowNodes, edges: flowEdges, unlinked: live.length - linked.length };
  }, [model.views, asOf, showRetracted, entries, missing, selected]);

  const selectedView = model.views.find(view => view.claim.id === selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('inquiry.graph.legend')}>
          {CLAIM_STATUSES.map(status => (
            <li key={status} className="flex items-center gap-1 text-text-dim">
              <span className="inline-block h-0.5 w-5" style={{ background: STATUS_STYLE[status].color }} aria-hidden /> {t(`inquiry.status.${status}`)}
            </li>
          ))}
          <li className="flex items-center gap-1 text-text-dim"><span className="inline-block w-5 border-t-2 border-dashed border-text-dim" aria-hidden /> {t('inquiry.time.ended')}</li>
        </ul>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={showRetracted} onChange={event => setShowRetracted(event.target.checked)} /> {t('inquiry.graph.showRetracted')}
        </label>
      </div>

      {nodes.length === 0
        ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-dim">{t('inquiry.graph.empty')}</p>
        : (
          <div className={`${cardClass} h-[460px] overflow-hidden`} data-testid="inquiry-graph" aria-label={t('inquiry.tab.graph')}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodesDraggable
              nodesConnectable={false}
              fitView
              minZoom={0.3}
              onEdgeClick={(_event, edge) => setSelected(edge.id)}
              onPaneClick={() => setSelected(null)}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}
      {unlinked > 0 && <p className="text-xs text-text-dim">{t('inquiry.graph.unlinked').replace('{n}', String(unlinked))}</p>}

      {selectedView && (
        <section className={`${cardClass} space-y-1 p-4`} aria-label={t('inquiry.graph.selected')} data-testid="graph-selected">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-prose text-sm text-text-primary">{selectedView.claim.statement}</p>
            <span className="flex items-center gap-1.5"><StatusBadge status={selectedView.status} /><TimeBadge view={selectedView} /></span>
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-text-dim"><CountsLine view={selectedView} />{validityLabel(selectedView.claim.validFrom, selectedView.claim.validTo) && <span>{validityLabel(selectedView.claim.validFrom, selectedView.claim.validTo)}</span>}</div>
        </section>
      )}
    </div>
  );
}
