import {getBoardCopy} from '../copy';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Plus, HelpCircle, Lightbulb, Link2, Lock, MapPin, Package, Pencil, Search,
  Sparkles, StickyNote, Trash2, User, Users, Zap,
} from 'lucide-react';
import {isBoardMediaRef} from './boardAssets';
import { MIN_SIZE, getNodeRole } from '../catalog';
import type { BoardNode } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import BoardEntityTile from './BoardEntityTile';
import {boardShapePath} from '../shapes';
import {strokeOutline} from '../freehand';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';

// Explicit map instead of `import * as Lucide` — a namespace import pulls the
// entire icon set into the bundle, and this project checks its bundle budget.
const ROLE_ICONS = {
  User, Zap, MapPin, Package, Users, Lightbulb, Search, HelpCircle, Sparkles, StickyNote,
} as const;

/** Kinds whose main text can be edited in place rather than in the inspector. */
const INLINE_EDITABLE = new Set<BoardNode['kind']>(['postit', 'card', 'frame', 'shape']);

export interface BoardNodeData extends Record<string, unknown> {
  node: BoardNode;
  layerLocked?: boolean;
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
  onToggleFrame?:(id:string)=>void;
  /** A new idea like this one on that side, joined to it. */
  onQuickConnect?: (id: string, side: 'top' | 'right' | 'bottom' | 'left') => void;
  memberCount?:number;
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
          title={t('board.node.refOpen')}
          onClick={(event) => {
            stop(event);
            data.onOpenRef(node.id);
          }}
          className="p-1 text-accent-plum-light hover:text-accent-gold"
        >
          <Link2 size={13} />
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


function BoardNodeView({ id, data, selected }: NodeProps<BoardFlowNode>) {
  const { t,locale } = useTranslation();
  const copy=getBoardCopy(locale);
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
      else if (!accept) setDraft(node.title);
    },
    [draft, node.title, data, id],
  );

  const handleDoubleClick = useCallback(() => {
    if (node.locked || data.layerLocked) return;
    if (INLINE_EDITABLE.has(node.kind) && !node.freehand) setEditing(true);
    else if(node.kind==='entity'&&node.ref)data.onOpenRef(id);
    else data.onEdit(id);
  }, [node.locked, node.kind, node.freehand, node.ref, data, id]);

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
        if(node.collapsed)return <div className="flex h-full min-w-0 flex-col justify-between rounded-lg border border-border bg-surface p-3 shadow-lg" data-board-pile={node.id}><div className="flex min-w-0 items-center gap-2 text-sm text-text-primary"><span className="rounded bg-elevated px-2 py-1 font-semibold tabular-nums">{data.memberCount??0}</span><span>{copy.items}</span><span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={node.title}>{node.title}</span></div><button type="button" className="nodrag min-h-9 rounded border border-border px-2 text-left text-xs text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40" aria-expanded="false" disabled={node.locked||data.layerLocked||!data.onToggleFrame} onClick={event=>{event.stopPropagation();data.onToggleFrame?.(id);}} onDoubleClick={event=>event.stopPropagation()}>{copy.openPile}</button></div>;
        return (
          <div
            className="flex h-full w-full flex-col rounded-xl border-2 border-dashed"
            style={{ borderColor: node.color, background: hexToRgba(node.color, 0.07) }}
          >
            <div
              className="flex items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ background: node.color, color: '#07070d' }}
            >
              <button type="button" className="nodrag flex min-h-9 min-w-9 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40" aria-label={copy.collapsePile} aria-expanded="true" disabled={node.locked||data.layerLocked||!data.onToggleFrame} onClick={event=>{event.stopPropagation();data.onToggleFrame?.(id);}}>▾</button>
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
                dangerouslySetInnerHTML={sanitizedHtml(node.richContent)}
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
        if (node.freehand) {const stroke=node.freehand;return <svg viewBox={`0 0 ${node.size.width} ${node.size.height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" data-testid={`board-stroke-${node.id}`}><title>{node.title}</title><path d={strokeOutline(stroke.points.map(p=>({...p,x:p.x*node.size.width/100,y:p.y*node.size.height/100})),stroke.width)} fill={node.color} opacity={stroke.opacity??(stroke.tool==='marker'?.32:1)} /></svg>;}
        return <div className="relative flex h-full w-full items-center justify-center p-3 text-center" data-board-border={node.border ?? 'solid'}><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">{node.border === 'sketch' && <SketchFilter id={`sketch-${node.id}`} />}<path d={boardShapePath(node.shape??'rectangle')} fill={['line','arrow'].includes(node.shape??'')?'none':hexToRgba(node.color,.18)} stroke={node.color} strokeWidth={node.border === 'sketch' ? 2.4 : 2} strokeDasharray={node.border === 'dashed' ? '7 5' : undefined} filter={node.border === 'sketch' ? `url(#sketch-${node.id})` : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>{node.border === 'sketch' && <path d={boardShapePath(node.shape??'rectangle')} fill="none" stroke={node.color} strokeOpacity={.55} strokeWidth="1.2" filter={`url(#sketch-${node.id})`} transform="translate(.8 -.6)" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>}</svg><div className="relative">{titleNode??<span className="text-sm font-semibold text-text-primary">{node.title}</span>}</div></div>;
      case 'entity':
        return <BoardEntityTile node={node}/>;

      case 'card':
      default:
        return (
          <div
            className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border-2 bg-elevated shadow-lg"
            data-board-border={node.border ?? 'solid'}
            style={{ borderColor: node.border === 'sketch' ? 'transparent' : node.color, borderStyle: node.border === 'dashed' ? 'dashed' : 'solid' }}
          >
            {node.border === 'sketch' && <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true"><SketchFilter id={`sketch-${node.id}`} /><rect x="1.5" y="1.5" style={{ width: 'calc(100% - 3px)', height: 'calc(100% - 3px)' }} rx="11" fill="none" stroke={node.color} strokeWidth="2.2" filter={`url(#sketch-${node.id})`} /><rect x="2.5" y="1" style={{ width: 'calc(100% - 4px)', height: 'calc(100% - 3px)' }} rx="12" fill="none" stroke={node.color} strokeOpacity=".5" strokeWidth="1.1" filter={`url(#sketch-${node.id})`} /></svg>}
            {node.image ? <img src={node.image} alt="" className="h-20 w-full object-cover" draggable={false} /> : null}
            <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
              {roleDef ? (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: node.color }}
                >
                  {RoleIcon ? <RoleIcon size={11} /> : null}
                  {roleDef ? t(roleDef.labelKey) : node.role}
                </span>
              ) : null}
              {titleNode ?? (
                <h4 className="truncate font-serif text-sm font-bold text-text-primary">{node.title || '—'}</h4>
              )}
              {node.richContent?<div className="prose prose-invert max-w-none min-h-0 overflow-hidden text-xs leading-snug text-text-primary" dangerouslySetInnerHTML={sanitizedHtml(node.richContent)}/>:node.content?<p className="overflow-hidden text-xs leading-snug text-text-muted">{node.content}</p>:null}
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

  const min = node.kind==='entity'&&isBoardMediaRef(node.ref)?{width:280,height:96}:MIN_SIZE[node.kind];

  return (
    <div className="group relative" style={wrapper} onDoubleClick={handleDoubleClick}>
      {selected && !node.locked && !data.layerLocked && !(node.kind==='frame'&&node.collapsed) ? (
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
      {!data.layerLocked && <NodeChrome data={data} selected={Boolean(selected)} />}
      {selected && !data.layerLocked && data.onQuickConnect && !node.freehand && node.kind !== 'frame' ? (['top', 'right', 'bottom', 'left'] as const).map(side => (
        <button key={side} type="button" data-testid={`board-quick-${side}`} title={copy.quickConnect} aria-label={`${copy.quickConnect} · ${side}`}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); data.onQuickConnect?.(node.id, side); }}
          className="nodrag nopan absolute z-20 flex h-5 w-5 items-center justify-center rounded-full border border-accent-gold/60 bg-surface text-accent-gold shadow hover:bg-accent-gold hover:text-deep"
          style={side === 'top' ? { top: -34, left: '50%', marginLeft: -10 } : side === 'bottom' ? { bottom: -30, left: '50%', marginLeft: -10 } : side === 'left' ? { left: -30, top: '50%', marginTop: -10 } : { right: -30, top: '50%', marginTop: -10 }}>
          <Plus size={12} aria-hidden="true" />
        </button>
      )) : null}
    </div>
  );
}


/** A hand-drawn outline: the stroke wobbles a little, as if traced by hand. */
function SketchFilter({ id }: { id: string }) {
  return <defs><filter id={id} x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" /></filter></defs>;
}

export default memo(BoardNodeView, (previous, next) =>
  previous.id === next.id &&
  previous.selected === next.selected &&
  previous.data.node === next.data.node &&
  previous.data.dimmed === next.data.dimmed &&
  previous.data.layerOpacity === next.data.layerOpacity &&
  previous.data.layerLocked === next.data.layerLocked &&
  previous.data.linking === next.data.linking &&
  previous.data.onPath === next.data.onPath,
);
