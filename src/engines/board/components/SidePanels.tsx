import { useState } from 'react';
import {
  Activity, Eye, EyeOff, Layers as LayersIcon, Lock, Plus, Save, Trash2, Unlock,
} from 'lucide-react';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import { ConfirmDialog, useDebouncedField } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import type { GraphSummary } from '../graph/metrics';
import type { BoardLayer, BoardView } from '../types';

const panelButton =
  'flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:text-accent-gold';

// ---------------------------------------------------------------------------

/**
 * Buffered: `onPatch` is a Dexie write plus a full refetch of the layer table,
 * and the input was bound to the row coming back from it — so typing a layer
 * name dropped characters and threw the caret to the end.
 */
function LayerNameField({ layer, onPatch }: { layer: BoardLayer; onPatch: LayersPanelProps['onPatch'] }) {
  const field = useDebouncedField(layer.name, (name) => onPatch(layer.id, { name }));
  return (
    <input
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
      onBlur={field.onBlur}
      className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none"
    />
  );
}

/** Same write-and-refetch on every drag tick; the opacity lands on release. */
function LayerOpacitySlider({ layer, onPatch }: { layer: BoardLayer; onPatch: LayersPanelProps['onPatch'] }) {
  const [opacity, setOpacity] = useState(layer.opacity);
  const [seenRemote, setSeenRemote] = useState(layer.opacity);
  if (layer.opacity !== seenRemote) {
    setSeenRemote(layer.opacity);
    setOpacity(layer.opacity);
  }

  const commit = () => {
    if (opacity !== layer.opacity) onPatch(layer.id, { opacity });
  };

  return (
    <input
      type="range"
      min={0.1}
      max={1}
      step={0.1}
      value={opacity}
      onChange={(event) => setOpacity(Number(event.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      className="h-1 flex-1 accent-accent-gold"
    />
  );
}

export interface LayersPanelProps {
  layers: BoardLayer[];
  activeLayerId: string | null;
  counts: Map<string, number>;
  onCreate: (name: string) => void;
  onPatch: (id: string, changes: Partial<BoardLayer>) => Promise<void>;
  onDelete: (id: string) => void;
  onSetActive: (id: string | null) => void;
  onSelectContents: (id: string) => void;
}

export function LayersPanel({
  layers, activeLayerId, counts, onCreate, onPatch, onDelete, onSetActive, onSelectContents,
}: LayersPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-text-dim">{t('board.layers.hint')}</p>

      <button
        type="button"
        onClick={() => onSetActive(null)}
        className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs transition ${
          activeLayerId === null ? 'border-accent-gold text-accent-gold' : 'border-border text-text-muted'
        }`}
      >
        {t('board.layers.none')}
      </button>

      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`rounded-lg border px-2 py-1.5 ${
            activeLayerId === layer.id ? 'border-accent-gold' : 'border-border'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPatch(layer.id, { visible: !layer.visible })}
              className="text-text-muted transition hover:text-accent-gold"
              title={t('board.layers.toggle')}
            >
              {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <InlineColorPicker value={layer.color} onChange={(color) => onPatch(layer.id, { color })} size="sm" />
            <LayerNameField layer={layer} onPatch={onPatch} />
            <span className="text-[10px] text-text-dim">{counts.get(layer.id) ?? 0}</span>
            <button
              type="button"
              onClick={() => onPatch(layer.id, { locked: !layer.locked })}
              className="text-text-muted transition hover:text-accent-gold"
              title={t('board.layers.lock')}
            >
              {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button
              type="button"
              // Los únicos botones destructivos del motor que no preguntaban,
              // en una fila de cuatro iconos de doce píxeles pegados: la
              // papelera está justo al lado del candado. Y `useBoardLayers`
              // escribe directo, fuera del sistema de comandos, así que Ctrl+Z
              // tampoco lo recuperaba.
              onClick={() => setPendingDelete(layer.id)}
              className="text-text-muted transition hover:text-danger"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <LayerOpacitySlider layer={layer} onPatch={onPatch} />
            <button type="button" onClick={() => onSetActive(layer.id)} className="text-[10px] text-text-dim hover:text-accent-gold">
              {t('board.layers.setActive')}
            </button>
            <button type="button" onClick={() => onSelectContents(layer.id)} className="text-[10px] text-text-dim hover:text-accent-gold">
              {t('board.layers.select')}
            </button>
          </div>
        </div>
      ))}

      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              onCreate(draft.trim());
              setDraft('');
            }
          }}
          placeholder={t('board.layers.newPlaceholder')}
          className="flex-1 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold"
        />
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) return;
            onCreate(draft.trim());
            setDraft('');
          }}
          className={panelButton}
          title={t('common.create')}
          aria-label={t('common.create')}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('board.layers.confirmDelete').replace(
          '{n}',
          String(pendingDelete ? counts.get(pendingDelete) ?? 0 : 0),
        )}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) onDelete(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface ViewsPanelProps {
  views: BoardView[];
  activeViewId: string | null;
  onApply: (view: BoardView) => void;
  onSave: (name: string) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ViewsPanel({ views, activeViewId, onApply, onSave, onUpdate, onDelete }: ViewsPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-text-dim">{t('board.views.hint')}</p>

      {views.map((view) => (
        <div
          key={view.id}
          className={`rounded-lg border px-2 py-1.5 ${
            activeViewId === view.id ? 'border-accent-gold' : 'border-border'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onApply(view)}
              className="min-w-0 flex-1 truncate text-left text-xs text-text-primary transition hover:text-accent-gold"
            >
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => onUpdate(view.id)}
              title={t('board.views.update')}
              className="text-text-muted transition hover:text-accent-gold"
            >
              <Save size={12} />
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(view.id)}
              className="text-text-muted transition hover:text-danger"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
          {view.query ? (
            <p className="truncate font-mono text-[10px] text-text-dim">{view.query}</p>
          ) : null}
        </div>
      ))}

      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              onSave(draft.trim());
              setDraft('');
            }
          }}
          placeholder={t('board.views.newPlaceholder')}
          className="flex-1 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold"
        />
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) return;
            onSave(draft.trim());
            setDraft('');
          }}
          className={panelButton}
          title={t('common.create')}
          aria-label={t('common.create')}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('board.views.confirmDelete')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) onDelete(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface MetricsPanelProps {
  summary: GraphSummary;
  keystoneTitles: Array<{ id: string; title: string; score: number }>;
  onFocus: (id: string) => void;
  onQuery: (query: string) => void;
}

export function MetricsPanel({ summary, keystoneTitles, onFocus, onQuery }: MetricsPanelProps) {
  const { t } = useTranslation();

  const stats: Array<{ label: string; value: string; query?: string }> = [
    { label: t('board.metrics.nodes'), value: String(summary.nodeCount) },
    { label: t('board.metrics.edges'), value: String(summary.edgeCount) },
    { label: t('board.metrics.hyper'), value: String(summary.hyperEdgeCount), query: 'is:hyper' },
    { label: t('board.metrics.meta'), value: String(summary.metaEdgeCount), query: 'is:meta' },
    { label: t('board.metrics.clusters'), value: String(summary.componentCount) },
    { label: t('board.metrics.largest'), value: String(summary.largestComponent) },
    { label: t('board.metrics.isolated'), value: String(summary.isolatedCount), query: 'is:orphan' },
    { label: t('board.metrics.bridges'), value: String(summary.bridgeEdgeIds.length), query: 'is:bridge' },
    { label: t('board.metrics.avgDegree'), value: summary.averageDegree.toFixed(1) },
    { label: t('board.metrics.density'), value: `${Math.round(summary.density * 100)}%` },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            disabled={!stat.query}
            onClick={() => stat.query && onQuery(stat.query)}
            className={`rounded-lg border border-border px-2 py-1.5 text-left ${
              stat.query ? 'transition hover:border-accent-gold' : 'cursor-default'
            }`}
          >
            <span className="block text-[10px] uppercase tracking-wide text-text-dim">{stat.label}</span>
            <span className="text-sm font-semibold text-text-primary">{stat.value}</span>
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          <Activity size={12} /> {t('board.metrics.keystones')}
        </p>
        <p className="mb-1.5 text-[11px] leading-snug text-text-dim">{t('board.metrics.keystonesHint')}</p>
        {keystoneTitles.length === 0 ? (
          <p className="text-xs text-text-dim">{t('board.metrics.none')}</p>
        ) : (
          <div className="space-y-1">
            {keystoneTitles.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onFocus(entry.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1 text-left text-xs text-text-primary transition hover:border-accent-gold"
              >
                <LayersIcon size={11} className="shrink-0 text-accent-gold" />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="text-[10px] text-text-dim">{Math.round(entry.score * 100)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
