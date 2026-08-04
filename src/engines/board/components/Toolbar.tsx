import { useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, BarChart3, Bookmark, Camera, Circle,
  Frame, Grid3x3, Image as ImageIcon, Layers, Link2, Magnet, Maximize,
  Network, Redo2, Share2, Spline, Square, StickyNote, Tag, Type, Undo2, User,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { LayoutKind } from '../graph/layout';
import type { BoardNodeKind } from '../types';

export type PanelKey = 'layers' | 'views' | 'metrics' | null;

export interface ToolbarProps {
  onAdd: (kind: BoardNodeKind) => void;
  linking: boolean;
  onToggleLink: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onLayout: (kind: LayoutKind) => void;
  onAlign: (mode: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom') => void;
  onDistribute: (axis: 'x' | 'y') => void;
  selectionCount: number;
  snap: boolean;
  onToggleSnap: () => void;
  labels: boolean;
  onToggleLabels: () => void;
  panel: PanelKey;
  onPanel: (panel: PanelKey) => void;
  onFit: () => void;
  onExport: () => void;
}

const NODE_BUTTONS: Array<{ kind: BoardNodeKind; icon: typeof User; labelKey: string }> = [
  { kind: 'card', icon: User, labelKey: 'board.add.card' },
  { kind: 'postit', icon: StickyNote, labelKey: 'board.add.postit' },
  { kind: 'text', icon: Type, labelKey: 'board.add.text' },
  { kind: 'image', icon: ImageIcon, labelKey: 'board.add.image' },
  { kind: 'shape', icon: Square, labelKey: 'board.add.shape' },
  { kind: 'frame', icon: Frame, labelKey: 'board.add.frame' },
  { kind: 'entity', icon: Link2, labelKey: 'board.add.entity' },
];

const LAYOUTS: Array<{ kind: LayoutKind; icon: typeof Network; labelKey: string }> = [
  { kind: 'force', icon: Share2, labelKey: 'board.layout.force' },
  { kind: 'hierarchy', icon: Network, labelKey: 'board.layout.hierarchy' },
  { kind: 'radial', icon: Circle, labelKey: 'board.layout.radial' },
  { kind: 'grid', icon: Grid3x3, labelKey: 'board.layout.grid' },
  { kind: 'circle', icon: Spline, labelKey: 'board.layout.circle' },
];

const ALIGNMENTS = [
  { mode: 'left', icon: AlignStartVertical },
  { mode: 'center-x', icon: AlignCenterVertical },
  { mode: 'right', icon: AlignEndVertical },
  { mode: 'top', icon: AlignStartHorizontal },
  { mode: 'center-y', icon: AlignCenterHorizontal },
  { mode: 'bottom', icon: AlignEndHorizontal },
] as const;

const buttonClass =
  'flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition hover:bg-elevated hover:text-accent-gold disabled:cursor-not-allowed disabled:opacity-30';
const activeClass = 'bg-accent-gold/15 text-accent-gold';
const groupClass =
  'flex items-center gap-0.5 rounded-xl border border-border bg-surface/95 p-1 shadow-lg backdrop-blur';

export default function Toolbar(props: ToolbarProps) {
  const { t } = useTranslation();
  const [layoutOpen, setLayoutOpen] = useState(false);

  return (
    <div className="board-chrome flex flex-col gap-2">
      <div className={groupClass}>
        {NODE_BUTTONS.map(({ kind, icon: Icon, labelKey }) => (
          <button
            key={kind}
            type="button"
            title={t(labelKey)}
            onClick={() => props.onAdd(kind)}
            className={buttonClass}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          title={t('board.tool.link')}
          onClick={props.onToggleLink}
          className={`${buttonClass} ${props.linking ? activeClass : ''}`}
        >
          <Share2 size={15} />
        </button>
      </div>

      <div className={groupClass}>
        <button
          type="button"
          title={props.undoLabel ? `${t('board.tool.undo')}: ${props.undoLabel}` : t('board.tool.undo')}
          onClick={props.onUndo}
          disabled={!props.canUndo}
          className={buttonClass}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          title={props.redoLabel ? `${t('board.tool.redo')}: ${props.redoLabel}` : t('board.tool.redo')}
          onClick={props.onRedo}
          disabled={!props.canRedo}
          className={buttonClass}
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="relative">
        <div className={groupClass}>
          <button
            type="button"
            title={t('board.tool.layout')}
            onClick={() => setLayoutOpen((value) => !value)}
            className={`${buttonClass} ${layoutOpen ? activeClass : ''}`}
          >
            <Network size={15} />
          </button>
          <button
            type="button"
            title={t('board.tool.snap')}
            onClick={props.onToggleSnap}
            className={`${buttonClass} ${props.snap ? activeClass : ''}`}
          >
            <Magnet size={15} />
          </button>
          <button
            type="button"
            title={t('board.tool.labels')}
            onClick={props.onToggleLabels}
            className={`${buttonClass} ${props.labels ? activeClass : ''}`}
          >
            <Tag size={15} />
          </button>
        </div>

        {layoutOpen ? (
          <div className="absolute left-full top-0 ml-2 w-48 rounded-xl border border-border bg-surface/95 p-1.5 shadow-xl backdrop-blur">
            {LAYOUTS.map(({ kind, icon: Icon, labelKey }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  props.onLayout(kind);
                  setLayoutOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-text-muted transition hover:bg-elevated hover:text-accent-gold"
              >
                <Icon size={13} /> {t(labelKey)}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-dim">
              {t('board.tool.align')} · {props.selectionCount}
            </p>
            <div className="flex flex-wrap gap-0.5 px-1">
              {ALIGNMENTS.map(({ mode, icon: Icon }) => (
                <button
                  key={mode}
                  type="button"
                  disabled={props.selectionCount < 2}
                  onClick={() => props.onAlign(mode)}
                  className={buttonClass}
                  title={t(`board.align.${mode}`)}
                >
                  <Icon size={14} />
                </button>
              ))}
              <button
                type="button"
                disabled={props.selectionCount < 3}
                onClick={() => props.onDistribute('x')}
                className={buttonClass}
                title={t('board.align.distributeX')}
              >
                <AlignCenterVertical size={14} className="rotate-90" />
              </button>
              <button
                type="button"
                disabled={props.selectionCount < 3}
                onClick={() => props.onDistribute('y')}
                className={buttonClass}
                title={t('board.align.distributeY')}
              >
                <AlignCenterHorizontal size={14} className="rotate-90" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={groupClass}>
        <button
          type="button"
          title={t('board.panel.layers')}
          onClick={() => props.onPanel(props.panel === 'layers' ? null : 'layers')}
          className={`${buttonClass} ${props.panel === 'layers' ? activeClass : ''}`}
        >
          <Layers size={15} />
        </button>
        <button
          type="button"
          title={t('board.panel.views')}
          onClick={() => props.onPanel(props.panel === 'views' ? null : 'views')}
          className={`${buttonClass} ${props.panel === 'views' ? activeClass : ''}`}
        >
          <Bookmark size={15} />
        </button>
        <button
          type="button"
          title={t('board.panel.metrics')}
          onClick={() => props.onPanel(props.panel === 'metrics' ? null : 'metrics')}
          className={`${buttonClass} ${props.panel === 'metrics' ? activeClass : ''}`}
        >
          <BarChart3 size={15} />
        </button>
      </div>

      <div className={groupClass}>
        <button type="button" title={t('board.tool.fit')} onClick={props.onFit} className={buttonClass}>
          <Maximize size={15} />
        </button>
        <button type="button" title={t('board.tool.export')} onClick={props.onExport} className={buttonClass}>
          <Camera size={15} />
        </button>
      </div>
    </div>
  );
}
