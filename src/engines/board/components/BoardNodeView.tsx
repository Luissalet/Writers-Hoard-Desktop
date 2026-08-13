import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  HelpCircle, Lightbulb, Link2, Lock, MapPin, Package, Pencil, Search,
  Sparkles, StickyNote, Trash2, Unlink, User, Users, Zap,
} from 'lucide-react';
import { MIN_SIZE, getNodeRole } from '../catalog';
import type { BoardNode } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

// Explicit map instead of `import * as Lucide` — a namespace import pulls the
// entire icon set into the bundle, and this project checks its bundle budget.
const ROLE_ICONS = {
  User, Zap, MapPin, Package, Users, Lightbulb, Search, HelpCircle, Sparkles, StickyNote,
} as const;

/** Kinds whose main text can be edited in place rather than in the inspector. */
const INLINE_EDITABLE = new Set<BoardNode['kind']>(['postit', 'card', 'frame', 'shape']);

export interface BoardNodeData extends Record<string, unknown> {
  node: BoardNode;
  /** The query said "not this one" — visible, but pushed into the background. */
  dimmed: boolean;
  layerOpacity: number;
  /** Staged as an endpoint while the link tool is open. */
  linking: false | 'source' | 'target';
  /** Sits on the path currently being traced. */
  onPath: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onStartLink: (id: string) => void;
  onOpenRef: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export type BoardFlowNode = Node<BoardNodeData, 'board'>;

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return `rgba(138, 134, 144, ${alpha})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function NodeChrome({ data, selected }: { data: BoardNodeData; selected: boolean }) {
  const { t } = useTranslation();
  const { node } = data;
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div
      className={`absolute -top-8 right-0 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 px-1 py-0.5 shadow-lg backdrop-blur transition ${
        selected
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
      }`}
      onMouseDown={stop}
    >
      {node.ref ? (
        <button
          type="button"
          title={node.ref.missing ? t('board.node.refBroken') : t('board.node.refOpen')}
          onClick={(event) => {
            stop(event);
            data.onOpenRef(node.id);
          }}
          className={node.ref.missing ? 'p-1 text-danger' : 'p-1 text-accent-plum-light hover:text-accent-gold'}
        >
          {node.ref.missing ? <Unlink size={13} /> : <Link2 size={13} />}
        </button>
      ) : null}
      <button
        type="button"
        title={t('board.node.connect')}
        onClick={(event) => {
          stop(event);
          data.onStartLink(node.id);
        }}
        className="p-1 text-text-muted transition hover:text-accent-gold"
      >
        <Link2 size={13} />
      </button>
      <button
        type="button"
        title={t('common.edit')}
        onClick={(event) => {
          stop(event);
          data.onEdit(node.id);
        }}
        className="p-1 text-text-muted transition hover:text-accent-gold"
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        title={t('common.delete')}
        onClick={(event) => {
          stop(event);
          data.onDelete(node.id);
        }}
        className="p-1 text-text-muted transition hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function shapeStyle(node: BoardNode): React.CSSProperties {
  const shape = node.shape ?? 'rectangle';
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    background: hexToRgba(node.color, 0.18),
    border: `2px solid ${node.color}`,
  };
  if (shape === 'circle') style.borderRadius = '50%';
  else if (shape === 'pill') style.borderRadius = '999px';
  else style.borderRadius = '10px';

  // Clipped, not rotated. The old engine rotated the whole container for the
  // diamond, which sent the handles and the delete button off on a diagonal.
  if (shape === 'diamond' || shape === 'hexagon') {
    style.border = 'none';
    style.background = hexToRgba(node.color, 0.34);
    style.clipPath =
      shape === 'diamond'
        ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
        : 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
  }
  return style;
}

function BoardNodeView({ id, data, selected }: NodeProps<BoardFlowNode>) {
  const { t } = useTranslation();
  const { node } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Render-adjust rather than an effect: the draft must already match the new
  // title on the render that shows it, not one frame later.
  const [syncedTitle, setSyncedTitle] = useState(node.title);
  if (!editing && syncedTitle !== node.title) {
    setSyncedTitle(node.title);
    setDraft(node.title);
  }

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(
    (accept: boolean) => {
      setEditing(false);
      if (accept && draft !== node.title) data.onRename(id, draft);
    },
    [draft, node.title, data, id],
  );

  const handleDoubleClick = useCallback(() => {
    if (node.locked) return;
    if (INLINE_EDITABLE.has(node.kind)) setEditing(true);
    else data.onEdit(id);
  }, [node.locked, node.kind, data, id]);

  const roleDef = getNodeRole(node.role);
  const RoleIcon = roleDef ? ROLE_ICONS[roleDef.icon as keyof typeof ROLE_ICONS] : undefined;

  const outline = data.linking === 'source'
    ? '2px solid #4a9e6d'
    : data.linking === 'target'
      ? '2px solid #e4a853'
      : data.onPath
        ? '2px dashed #c4973b'
        : selected
          ? '2px solid #c4973b'
          : 'none';

  const wrapper: React.CSSProperties = {
    width: '100%',
    height: '100%',
    opacity: data.dimmed ? 0.16 : data.layerOpacity,
    outline,
    outlineOffset: 3,
    transition: 'opacity 120ms linear',
  };

  // Every handle carries an id. React Flow keys its connection lookup by
  // node + type + handle id, so two handles of the same type without ids
  // collapse onto one entry and the other stops existing as far as dragging
  // is concerned — which is exactly what "the thread will not start" was.
  const handleClass = 'board-handle';

  const titleNode = editing ? (
    <textarea
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commit(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          commit(false);
        }
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="nodrag nowheel w-full resize-none rounded bg-black/20 px-1 text-sm text-inherit outline-none ring-1 ring-accent-gold/60"
      rows={2}
      autoFocus
    />
  ) : null;

  const body = (() => {
    switch (node.kind) {
      case 'frame':
        return (
          <div
            className="flex h-full w-full flex-col rounded-xl border-2 border-dashed"
            style={{ borderColor: node.color, background: hexToRgba(node.color, 0.07) }}
          >
            <div
              className="flex items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ background: node.color, color: '#07070d' }}
            >
              <span>{node.collapsed ? '▸' : '▾'}</span>
              {titleNode ?? <span className="truncate">{node.title || t('board.node.frame')}</span>}
            </div>
          </div>
        );

      case 'postit':
        return (
          <div
            className="flex h-full w-full flex-col gap-1 rounded-sm p-3 shadow-lg"
            style={{ background: node.color, color: '#231d10' }}
          >
            {titleNode ?? (
              <span className="whitespace-pre-wrap break-words text-sm font-semibold leading-tight">
                {node.title || '—'}
              </span>
            )}
            {node.content ? (
              <span className="overflow-hidden text-xs leading-snug opacity-80">{node.content}</span>
            ) : null}
          </div>
        );

      case 'text':
        return (
          <div className="nowheel h-full w-full overflow-auto px-1 py-0.5">
            {node.richContent ? (
              <div
                className="prose prose-invert max-w-none text-sm text-text-primary"
                dangerouslySetInnerHTML={{ __html: node.richContent }}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words font-serif text-sm text-text-primary">
                {node.content || node.title}
              </p>
            )}
          </div>
        );

      case 'image':
        return (
          <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-lg">
            {node.image ? (
              <img src={node.image} alt={node.title} className="min-h-0 flex-1 object-cover" draggable={false} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-text-dim">{t('board.node.noImage')}</div>
            )}
            {node.title ? <span className="truncate px-2 py-1 text-xs text-text-muted">{node.title}</span> : null}
          </div>
        );

      case 'shape':
        return (
          <div style={shapeStyle(node)} className="flex items-center justify-center p-3 text-center">
            {titleNode ?? <span className="text-sm font-semibold text-text-primary">{node.title}</span>}
          </div>
        );

      case 'entity':
        return (
          <div
            className="flex h-full w-full items-center gap-2 overflow-hidden rounded-xl border bg-elevated p-2 shadow-lg"
            style={{ borderColor: node.ref?.missing ? '#c4463a' : node.color }}
          >
            {node.ref?.thumbnail ? (
              <img src={node.ref.thumbnail} alt="" className="h-12 w-12 rounded-lg object-cover" draggable={false} />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-accent-gold">
                {node.ref?.entityType ?? t('board.node.entity')}
              </p>
              <p className="truncate text-sm font-medium text-text-primary">
                {node.ref?.title || node.title || '—'}
              </p>
              {node.ref?.missing ? (
                <p className="truncate text-[11px] text-danger">{t('board.node.targetGone')}</p>
              ) : node.ref?.subtitle ? (
                <p className="truncate text-[11px] text-text-muted">{node.ref.subtitle}</p>
              ) : null}
            </div>
          </div>
        );

      case 'card':
      default:
        return (
          <div
            className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border-2 bg-elevated shadow-lg"
            style={{ borderColor: node.color }}
          >
            {node.image ? <img src={node.image} alt="" className="h-20 w-full object-cover" draggable={false} /> : null}
            <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
              {roleDef ? (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: node.color }}
                >
                  {RoleIcon ? <RoleIcon size={11} /> : null}
                  {node.role}
                </span>
              ) : null}
              {titleNode ?? (
                <h4 className="truncate font-serif text-sm font-bold text-text-primary">{node.title || '—'}</h4>
              )}
              {node.content ? (
                <p className="overflow-hidden text-xs leading-snug text-text-muted">{node.content}</p>
              ) : null}
              {node.tags.length > 0 ? (
                <div className="mt-auto flex flex-wrap gap-1 pt-1">
                  {node.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-dim">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
    }
  })();

  const min = MIN_SIZE[node.kind];

  return (
    <div className="group relative" style={wrapper} onDoubleClick={handleDoubleClick}>
      {selected && !node.locked ? (
        <NodeResizer
          minWidth={min.width}
          minHeight={min.height}
          lineClassName="!border-accent-gold/40"
          handleClassName="!h-2 !w-2 !rounded-sm !border-0 !bg-accent-gold"
        />
      ) : null}

      <Handle id="top" type="target" position={Position.Top} className={handleClass} />
      <Handle id="left" type="target" position={Position.Left} className={handleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />

      {node.kind === 'card' ? (
        <span
          className="absolute -top-1.5 left-1/2 z-10 h-3 w-3 -translate-x-1/2 rounded-full shadow"
          style={{ background: node.color }}
        />
      ) : null}
      {node.locked ? (
        <span className="absolute -left-2 -top-2 z-10 rounded-full bg-surface p-1 text-text-muted shadow">
          <Lock size={10} />
        </span>
      ) : null}
      {node.pinned ? (
        <span className="absolute -right-1.5 -top-1.5 z-10 h-2.5 w-2.5 rounded-full bg-accent-plum-light shadow" />
      ) : null}

      {body}
      <NodeChrome data={data} selected={Boolean(selected)} />
    </div>
  );
}

export default memo(BoardNodeView, (previous, next) =>
  previous.id === next.id &&
  previous.selected === next.selected &&
  previous.data.node === next.data.node &&
  previous.data.dimmed === next.data.dimmed &&
  previous.data.layerOpacity === next.data.layerOpacity &&
  previous.data.linking === next.data.linking &&
  previous.data.onPath === next.data.onPath,
);
