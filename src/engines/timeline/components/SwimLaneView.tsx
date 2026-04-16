import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, Link2, Trash2, Edit3, X, Calendar, Type, ChevronLeft, ChevronRight, ArrowRightLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Timeline, TimelineEvent, TimelineConnection, TimelineEventType, DateMode } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import ColorPicker from '@/components/common/ColorPicker';

// ============================================
// Swim-Lane Timeline View
// Renders multiple timelines as horizontal lanes with events,
// ranges as bars, milestones as diamonds, and curved connections.
// ============================================

interface SwimLaneViewProps {
  projectId: string;
  timelines: Timeline[];
  events: TimelineEvent[];
  connections: TimelineConnection[];
  onAddEvent: (event: TimelineEvent) => void;
  onEditEvent: (id: string, changes: Partial<TimelineEvent>) => void;
  onDeleteEvent: (id: string) => void;
  onAddConnection: (conn: TimelineConnection) => void;
  onDeleteConnection: (id: string) => void;
  onEditTimeline: (id: string, changes: Partial<Timeline>) => void;
}

// Layout constants
const LANE_HEIGHT = 120;
const LANE_PADDING = 16;
const LANE_LABEL_WIDTH = 160;
const EVENT_SPACING = 160;
const EVENT_RADIUS = 20;
const RANGE_HEIGHT = 36;
const MILESTONE_SIZE = 16;
const TOP_PADDING = 40;

// ── Helpers ──

function getEventsForTimeline(events: TimelineEvent[], timelineId: string): TimelineEvent[] {
  return events.filter(e => e.timelineId === timelineId).sort((a, b) => a.order - b.order);
}

function getLaneY(laneIndex: number): number {
  return TOP_PADDING + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2;
}

/** Parse a date key from an event for chronological positioning.
 *  Returns a timestamp for calendar events, null for text-only. */
function getEventTimeKey(evt: TimelineEvent): number | null {
  if (evt.dateMode === 'calendar' && evt.realDate) {
    return new Date(evt.realDate + 'T00:00:00').getTime();
  }
  return null;
}

/**
 * Build a shared time axis so events at the same date align vertically
 * across all lanes. Calendar events are placed on a proportional axis,
 * text-only events are interleaved by their manual order within each lane.
 */
function buildEventPositions(
  timelines: Timeline[],
  events: TimelineEvent[]
): { positions: Map<string, { x: number; y: number; laneIdx: number; evtIdx: number }>; totalWidth: number } {
  const map = new Map<string, { x: number; y: number; laneIdx: number; evtIdx: number }>();
  const START_X = LANE_LABEL_WIDTH + 60;

  // 1. Collect all unique calendar timestamps across ALL timelines
  const allTimestamps = new Set<number>();
  events.forEach(evt => {
    const t = getEventTimeKey(evt);
    if (t !== null) allTimestamps.add(t);
  });

  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);
  const hasCalendar = sortedTimestamps.length > 0;

  if (!hasCalendar) {
    // Pure manual mode — evenly spaced per lane
    let maxX = START_X;
    timelines.forEach((tl, laneIdx) => {
      const laneEvents = getEventsForTimeline(events, tl.id);
      const y = getLaneY(laneIdx);
      laneEvents.forEach((evt, evtIdx) => {
        const x = START_X + evtIdx * EVENT_SPACING;
        map.set(evt.id, { x, y, laneIdx, evtIdx });
        maxX = Math.max(maxX, x);
      });
    });
    return { positions: map, totalWidth: maxX + EVENT_SPACING };
  }

  // 2. Build a slot index: each unique timestamp gets a slot position
  //    Slots are evenly spaced along the X axis.
  const slotMap = new Map<number, number>(); // timestamp → slot index
  sortedTimestamps.forEach((ts, i) => slotMap.set(ts, i));
  const totalSlots = sortedTimestamps.length;

  // 3. For each lane, place events:
  //    - Calendar events → placed at their slot's X position
  //    - Text events → placed in gaps between calendar events or at the end
  let maxX = START_X;

  timelines.forEach((tl, laneIdx) => {
    const laneEvents = getEventsForTimeline(events, tl.id);
    const y = getLaneY(laneIdx);

    // Separate calendar and text events while preserving order
    let textCounter = 0;
    laneEvents.forEach((evt, evtIdx) => {
      const ts = getEventTimeKey(evt);
      let x: number;

      if (ts !== null) {
        // Calendar event → align to shared slot
        const slot = slotMap.get(ts)!;
        x = START_X + slot * EVENT_SPACING;
      } else {
        // Text event → place after all calendar slots + its own offset
        x = START_X + totalSlots * EVENT_SPACING + textCounter * EVENT_SPACING;
        textCounter++;
      }

      map.set(evt.id, { x, y, laneIdx, evtIdx });
      maxX = Math.max(maxX, x);
    });
  });

  return { positions: map, totalWidth: maxX + EVENT_SPACING };
}

/** Bezier curve: same lane arcs up, cross-lane uses S-curve */
function connectionPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dy) < 10) {
    const h = Math.max(40, Math.abs(dx) * 0.25);
    return `M ${x1} ${y1} C ${x1 + dx * 0.3} ${y1 - h}, ${x2 - dx * 0.3} ${y2 - h}, ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${x1 + dx * 0.5} ${y1}, ${x2 - dx * 0.5} ${y2}, ${x2} ${y2}`;
}

/** Get the display date string for an event */
function getDisplayDate(evt: TimelineEvent): string {
  if (evt.dateMode === 'calendar' && evt.realDate) {
    return formatDate(evt.realDate, evt.realDateEnd);
  }
  return evt.date || '';
}

function formatDate(iso: string, endIso?: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  try {
    const start = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, opts);
    if (endIso) {
      const end = new Date(endIso + 'T00:00:00').toLocaleDateString(undefined, opts);
      return `${start} — ${end}`;
    }
    return start;
  } catch { return iso; }
}

// TYPE_LABELS is built inside the component to use t() — see getTypeLabels()

// ── Tooltip state ──

interface TooltipData {
  x: number;
  y: number;
  event?: TimelineEvent;
  connection?: TimelineConnection;
  sourceTitle?: string;
  targetTitle?: string;
}

// ── Event Node (SVG) ──

function EventNode({
  evt, x, y,
  isSelected, isConnecting, isDragTarget, isConnectTarget,
  onMouseDown, onDoubleClick, onClick, onContextMenu,
  onHoverStart, onHoverEnd,
}: {
  evt: TimelineEvent;
  x: number; y: number;
  isSelected: boolean;
  isConnecting: boolean;
  isDragTarget: boolean;
  isConnectTarget: boolean; // true when another event is being connected and this is a valid target
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onHoverStart: (rect: DOMRect) => void;
  onHoverEnd: () => void;
}) {
  const type = evt.eventType || 'point';
  const gRef = useRef<SVGGElement>(null);

  const handleMouseEnter = () => {
    if (gRef.current) {
      onHoverStart(gRef.current.getBoundingClientRect());
    }
  };

  return (
    <g
      ref={gRef}
      className="cursor-pointer"
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
      style={{ filter: isSelected ? `drop-shadow(0 0 8px ${evt.color})` : undefined }}
    >
      {/* Bigger hit area */}
      <circle cx={x} cy={y} r={EVENT_RADIUS + 8} fill="transparent" />

      {/* Drag target indicator */}
      {isDragTarget && (
        <line x1={x - 4} y1={y - 28} x2={x - 4} y2={y + 28}
          stroke="#c4973b" strokeWidth={3} strokeLinecap="round" />
      )}

      {type === 'range' ? (
        <>
          <rect x={x - EVENT_RADIUS} y={y - RANGE_HEIGHT / 2}
            width={EVENT_SPACING * 0.7} height={RANGE_HEIGHT} rx={RANGE_HEIGHT / 2}
            fill={`${evt.color}30`} stroke={evt.color}
            strokeWidth={isSelected || isConnecting ? 3 : 2} />
          <text x={x + EVENT_SPACING * 0.35 - EVENT_RADIUS} y={y + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={evt.color} fontSize={11} fontWeight={600}
            fontFamily="ui-serif, Georgia, serif"
            className="pointer-events-none select-none">
            {evt.title.length > 16 ? evt.title.slice(0, 15) + '…' : evt.title}
          </text>
          {/* Date below range bar */}
          {getDisplayDate(evt) && (
            <text x={x + EVENT_SPACING * 0.35 - EVENT_RADIUS} y={y + RANGE_HEIGHT / 2 + 14}
              textAnchor="middle" fill="#8a8578" fontSize={9}
              className="pointer-events-none select-none">
              {getDisplayDate(evt).slice(0, 30)}
            </text>
          )}
        </>
      ) : type === 'milestone' ? (
        <>
          <rect x={x - MILESTONE_SIZE} y={y - MILESTONE_SIZE}
            width={MILESTONE_SIZE * 2} height={MILESTONE_SIZE * 2} rx={3}
            fill={`${evt.color}30`} stroke={evt.color}
            strokeWidth={isSelected || isConnecting ? 3 : 2}
            transform={`rotate(45 ${x} ${y})`} />
          <text x={x} y={y + MILESTONE_SIZE + 16}
            textAnchor="middle" fill="#d4d0c8" fontSize={11} fontWeight={600}
            fontFamily="ui-serif, Georgia, serif"
            className="pointer-events-none select-none">
            {evt.title.length > 20 ? evt.title.slice(0, 19) + '…' : evt.title}
          </text>
          {getDisplayDate(evt) && (
            <text x={x} y={y - MILESTONE_SIZE - 10}
              textAnchor="middle" fill="#8a8578" fontSize={9}
              className="pointer-events-none select-none">
              {getDisplayDate(evt).slice(0, 24)}
            </text>
          )}
        </>
      ) : (
        <>
          <circle cx={x} cy={y} r={EVENT_RADIUS}
            fill={`${evt.color}30`} stroke={evt.color}
            strokeWidth={isSelected || isConnecting ? 3 : 2} />
          <text x={x} y={y + EVENT_RADIUS + 16}
            textAnchor="middle" fill="#d4d0c8" fontSize={11} fontWeight={600}
            fontFamily="ui-serif, Georgia, serif"
            className="pointer-events-none select-none">
            {evt.title.length > 20 ? evt.title.slice(0, 19) + '…' : evt.title}
          </text>
          {getDisplayDate(evt) && (
            <text x={x} y={y - EVENT_RADIUS - 8}
              textAnchor="middle" fill="#8a8578" fontSize={9}
              className="pointer-events-none select-none">
              {getDisplayDate(evt).slice(0, 24)}
            </text>
          )}
        </>
      )}

      {/* Source indicator: spinning dashed ring */}
      {isConnecting && (
        <circle cx={x} cy={y} r={EVENT_RADIUS + 8}
          fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 3"
          className="animate-spin" style={{ animationDuration: '3s' }} />
      )}

      {/* Target indicator: pulsing ring on valid targets */}
      {isConnectTarget && (
        <circle cx={x} cy={y} r={EVENT_RADIUS + 6}
          fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="6 3"
          opacity={0.6} />
      )}
    </g>
  );
}

// ── Main Component ──

export default function SwimLaneView({
  projectId, timelines, events, connections,
  onAddEvent, onEditEvent, onDeleteEvent,
  onAddConnection, onDeleteConnection, onEditTimeline: _onEditTimeline,
}: SwimLaneViewProps) {
  const { t } = useTranslation();
  const TYPE_LABELS: Record<string, string> = useMemo(() => ({
    point: t('timeline.typePointSymbol'),
    range: t('timeline.typeRangeSymbol'),
    milestone: t('timeline.typeMilestoneSymbol'),
  }), [t]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; eventId: string } | null>(null);
  const [connContextMenu, setConnContextMenu] = useState<{ x: number; y: number; connId: string } | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Drag-to-reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetIdx, setDragTargetIdx] = useState<number | null>(null);
  const [dragTargetLane, setDragTargetLane] = useState<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragStarted = useRef(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    date: '',
    dateMode: 'text' as DateMode,
    eventType: 'point' as TimelineEventType,
    realDate: '',
    realDateEnd: '',
    lane: 'Main',
    color: '#c4973b',
    timelineId: '',
  });

  const { positions, totalWidth } = useMemo(() => buildEventPositions(timelines, events), [timelines, events]);

  const svgWidth = Math.max(800, totalWidth + 80);
  const svgHeight = Math.max(300, TOP_PADDING + timelines.length * LANE_HEIGHT + 40);

  // ── Zoom ──
  const handleZoomIn = () => setZoom(z => Math.min(z + 0.15, 2.5));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.15, 0.3));

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.min(Math.max(z - e.deltaY * 0.002, 0.3), 2.5));
    }
  }, []);

  // ── Tooltip ──
  const showEventTooltip = useCallback((evt: TimelineEvent, rect: DOMRect) => {
    if (draggingId) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    setTooltip({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      event: evt,
    });
  }, [draggingId]);

  const showConnectionTooltip = useCallback((conn: TimelineConnection, e: React.MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const src = events.find(ev => ev.id === conn.sourceEventId);
    const tgt = events.find(ev => ev.id === conn.targetEventId);
    setTooltip({
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top - 8,
      connection: conn,
      sourceTitle: src?.title || '?',
      targetTitle: tgt?.title || '?',
    });
  }, [events]);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  // ── Event clicks ──
  const handleEventClick = useCallback((e: React.MouseEvent, evt: TimelineEvent) => {
    e.stopPropagation();
    if (dragStarted.current) return; // was a drag, not a click
    if (connectingFromId) {
      if (connectingFromId !== evt.id) {
        onAddConnection({
          id: generateId('conn'), projectId,
          timelineId: evt.timelineId,
          sourceEventId: connectingFromId, targetEventId: evt.id,
          label: '', color: '#c4973b', style: 'solid', createdAt: Date.now(),
        });
      }
      setConnectingFromId(null);
    } else {
      setSelectedEventId(prev => prev === evt.id ? null : evt.id);
    }
  }, [connectingFromId, projectId, onAddConnection]);

  const handleDoubleClick = useCallback((evt: TimelineEvent) => {
    openEditForm(evt);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, evtId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConnContextMenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, eventId: evtId });
  }, []);

  // ── Drag to reorder ── (disabled when connecting)
  const handleMouseDown = useCallback((e: React.MouseEvent, evtId: string) => {
    if (e.button !== 0) return; // left click only
    if (connectingFromId) return; // don't drag while connecting
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragStarted.current = false;
    setDraggingId(evtId);
  }, [connectingFromId]);

  useEffect(() => {
    if (!draggingId) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (!dragStarted.current && Math.abs(dx) + Math.abs(dy) > 8) {
        dragStarted.current = true;
        setTooltip(null);
      }
      if (!dragStarted.current) return;

      // Figure out which lane and position the cursor is over
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;
      const svgX = (e.clientX - rect.left + scrollLeft) / zoom;
      const svgY = (e.clientY - rect.top + scrollTop) / zoom;

      // Find nearest lane
      let bestLane: string | null = null;
      let bestLaneIdx = -1;
      timelines.forEach((tl, i) => {
        const ly = getLaneY(i);
        if (Math.abs(svgY - ly) < LANE_HEIGHT / 2) {
          bestLane = tl.id;
          bestLaneIdx = i;
        }
      });

      if (bestLane && bestLaneIdx >= 0) {
        setDragTargetLane(bestLane);
        // Find insert position using actual rendered positions
        const laneEvts = getEventsForTimeline(events, bestLane).filter(e => e.id !== draggingId);
        let insertIdx = laneEvts.length;
        for (let i = 0; i < laneEvts.length; i++) {
          const pos = positions.get(laneEvts[i].id);
          if (pos && svgX < pos.x) { insertIdx = i; break; }
        }
        setDragTargetIdx(insertIdx);
      } else {
        setDragTargetLane(null);
        setDragTargetIdx(null);
      }
    };

    const handleMouseUp = () => {
      if (dragStarted.current && draggingId && dragTargetLane !== null && dragTargetIdx !== null) {
        const evt = events.find(e => e.id === draggingId);
        if (evt) {
          const targetTlId = dragTargetLane;
          const targetIdx = dragTargetIdx;
          const laneEvts = getEventsForTimeline(events, targetTlId).filter(e => e.id !== draggingId);

          // Reorder: insert at targetIdx
          laneEvts.splice(targetIdx, 0, evt);
          laneEvts.forEach((e, i) => {
            if (e.id === draggingId) {
              // Move to new timeline + new order
              onEditEvent(e.id, { timelineId: targetTlId, order: i });
            } else if (e.order !== i) {
              onEditEvent(e.id, { order: i });
            }
          });
        }
      }
      setDraggingId(null);
      setDragTargetIdx(null);
      setDragTargetLane(null);
      dragStartPos.current = null;
      // Reset dragStarted after a frame so click handler can check it
      requestAnimationFrame(() => { dragStarted.current = false; });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, dragTargetLane, dragTargetIdx, events, timelines, zoom, onEditEvent, positions]);

  // ── Reorder helpers (for context menu) ──
  const moveEvent = useCallback((evtId: string, direction: -1 | 1) => {
    const evt = events.find(e => e.id === evtId);
    if (!evt) return;
    const laneEvts = getEventsForTimeline(events, evt.timelineId);
    const idx = laneEvts.findIndex(e => e.id === evtId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= laneEvts.length) return;
    // Swap orders
    onEditEvent(laneEvts[idx].id, { order: laneEvts[newIdx].order });
    onEditEvent(laneEvts[newIdx].id, { order: laneEvts[idx].order });
    setContextMenu(null);
  }, [events, onEditEvent]);

  // ── Form handling ──
  const openAddForm = (timelineId: string) => {
    const tl = timelines.find(t => t.id === timelineId);
    setForm({
      title: '', description: '', date: '', dateMode: 'text', eventType: 'point',
      realDate: '', realDateEnd: '', lane: 'Main', color: tl?.color || '#c4973b',
      timelineId,
    });
    setEditingEvent(null);
    setShowEventForm(true);
  };

  const openEditForm = (evt: TimelineEvent) => {
    setForm({
      title: evt.title, description: evt.description,
      date: evt.date, dateMode: evt.dateMode || 'text',
      eventType: evt.eventType || 'point',
      realDate: evt.realDate || '', realDateEnd: evt.realDateEnd || '',
      lane: evt.lane, color: evt.color, timelineId: evt.timelineId,
    });
    setEditingEvent(evt);
    setShowEventForm(true);
    setContextMenu(null);
  };

  const handleSave = () => {
    if (!form.title.trim()) return;

    const dateValue = form.dateMode === 'calendar' && form.realDate
      ? formatDate(form.realDate, form.realDateEnd) : form.date;

    const effectiveType: TimelineEventType =
      form.dateMode === 'calendar' && form.realDateEnd ? 'range' : form.eventType;

    if (editingEvent) {
      // If timeline changed, also update order to be last in new lane
      const timelineChanged = form.timelineId !== editingEvent.timelineId;
      const newOrder = timelineChanged
        ? events.filter(e => e.timelineId === form.timelineId).length
        : undefined;

      onEditEvent(editingEvent.id, {
        title: form.title, description: form.description, date: dateValue,
        dateMode: form.dateMode, eventType: effectiveType,
        realDate: form.dateMode === 'calendar' ? form.realDate : undefined,
        realDateEnd: form.dateMode === 'calendar' ? form.realDateEnd || undefined : undefined,
        lane: form.lane, color: form.color,
        ...(timelineChanged ? { timelineId: form.timelineId, order: newOrder } : {}),
      });
    } else {
      const tlEvents = events.filter(e => e.timelineId === form.timelineId);
      onAddEvent({
        id: generateId('evt'), projectId, timelineId: form.timelineId,
        title: form.title, description: form.description, date: dateValue,
        dateMode: form.dateMode, eventType: effectiveType,
        realDate: form.dateMode === 'calendar' ? form.realDate : undefined,
        realDateEnd: form.dateMode === 'calendar' ? form.realDateEnd || undefined : undefined,
        order: tlEvents.length, lane: form.lane, color: form.color,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
    setShowEventForm(false);
    setEditingEvent(null);
  };

  // Close context menus on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    if (!connContextMenu) return;
    const close = () => setConnContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [connContextMenu]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-serif font-bold text-accent-gold">{t('timeline.swimLaneView')}</h3>
        <div className="flex items-center gap-2">
          {connectingFromId && (() => {
            const src = events.find(e => e.id === connectingFromId);
            return (
              <span className="text-xs bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-pulse">
                <Link2 size={13} />
                {t('timeline.connectingFrom')} <strong className="text-blue-300">{src?.title || '?'}</strong> {t('timeline.clickAnyEvent')}
                <button onClick={() => setConnectingFromId(null)} className="ml-1 p-0.5 rounded hover:bg-blue-500/20"><X size={13} /></button>
              </span>
            );
          })()}
          {draggingId && (
            <span className="text-xs text-accent-gold animate-pulse">{t('timeline.dragging')}</span>
          )}
          <span className="text-[10px] text-text-dim hidden sm:inline">{t('timeline.canvasHint')}</span>
          <button onClick={handleZoomOut} className="p-2 border border-border rounded-lg hover:bg-elevated transition" title={t('timeline.zoomOut')}>
            <ZoomOut size={14} className="text-text-muted" />
          </button>
          <span className="text-xs text-text-dim w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="p-2 border border-border rounded-lg hover:bg-elevated transition" title={t('timeline.zoomIn')}>
            <ZoomIn size={14} className="text-text-muted" />
          </button>
        </div>
      </div>

      {/* Canvas container (for tooltip positioning) */}
      <div ref={containerRef} className="relative overflow-auto border border-border rounded-xl bg-deep"
        style={{ maxHeight: '70vh' }} onWheel={handleWheel}
      >
        <svg
          width={svgWidth * zoom} height={svgHeight * zoom}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className={`select-none ${draggingId ? 'cursor-grabbing' : ''}`}
          onClick={() => { setContextMenu(null); if (!connectingFromId) setSelectedEventId(null); }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse" fill="#c4973b">
              <path d="M 0 0 L 10 5 L 0 10 Z" />
            </marker>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Shared time axis markers (for calendar events) */}
          {(() => {
            const allTimestamps = new Set<number>();
            events.forEach(evt => {
              const t = getEventTimeKey(evt);
              if (t !== null) allTimestamps.add(t);
            });
            const sorted = [...allTimestamps].sort((a, b) => a - b);
            if (sorted.length === 0) return null;

            const START_X = LANE_LABEL_WIDTH + 60;
            const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short' };
            return sorted.map((ts, i) => {
              const x = START_X + i * EVENT_SPACING;
              const label = new Date(ts).toLocaleDateString(undefined, opts);
              return (
                <g key={`axis-${ts}`}>
                  {/* Vertical guide line */}
                  <line x1={x} y1={TOP_PADDING - 4} x2={x} y2={svgHeight}
                    stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                  {/* Date label at top */}
                  <text x={x} y={TOP_PADDING - 12}
                    textAnchor="middle" fill="#6b6560" fontSize={10}
                    fontFamily="ui-monospace, monospace">
                    {label}
                  </text>
                </g>
              );
            });
          })()}

          {/* Lane backgrounds */}
          {timelines.map((tl, i) => {
            const y = TOP_PADDING + i * LANE_HEIGHT;
            const laneEvts = getEventsForTimeline(events, tl.id);
            const isDropTarget = draggingId && dragTargetLane === tl.id;
            return (
              <g key={`lane-${tl.id}`}>
                <rect x={0} y={y} width={svgWidth} height={LANE_HEIGHT}
                  fill={isDropTarget ? `${tl.color || '#c4973b'}12` : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.15)'}
                  stroke={isDropTarget ? `${tl.color || '#c4973b'}40` : 'transparent'} strokeWidth={1}
                />
                {/* Lane track line */}
                <line x1={LANE_LABEL_WIDTH + 20} y1={getLaneY(i)} x2={svgWidth - 20} y2={getLaneY(i)}
                  stroke={`${tl.color || '#c4973b'}40`} strokeWidth={2} strokeDasharray="6 4" />

                {/* Lane label */}
                <g className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <rect x={8} y={y + LANE_PADDING}
                    width={LANE_LABEL_WIDTH - 16} height={LANE_HEIGHT - LANE_PADDING * 2}
                    rx={8} fill={`${tl.color || '#c4973b'}15`}
                    stroke={`${tl.color || '#c4973b'}40`} strokeWidth={1} />
                  <text x={LANE_LABEL_WIDTH / 2} y={getLaneY(i) - 6}
                    textAnchor="middle" fill={tl.color || '#c4973b'}
                    fontSize={13} fontWeight={700} fontFamily="ui-serif, Georgia, serif">
                    {tl.title.length > 18 ? tl.title.slice(0, 17) + '…' : tl.title}
                  </text>
                  {tl.description && (
                    <text x={LANE_LABEL_WIDTH / 2} y={getLaneY(i) + 12}
                      textAnchor="middle" fill="#8a8578" fontSize={9}>
                      {tl.description.length > 24 ? tl.description.slice(0, 23) + '…' : tl.description}
                    </text>
                  )}
                </g>

                {/* Add event "+" button at end of lane */}
                {(() => {
                  // Position after last event in this lane
                  const lastEvt = laneEvts[laneEvts.length - 1];
                  const lastPos = lastEvt ? positions.get(lastEvt.id) : null;
                  const addX = lastPos ? lastPos.x + EVENT_SPACING - 40 : LANE_LABEL_WIDTH + 20;
                  return (
                    <g className="cursor-pointer opacity-30 hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); openAddForm(tl.id); }}>
                      <circle cx={addX} cy={getLaneY(i)} r={14}
                        fill="transparent" stroke={`${tl.color || '#c4973b'}60`}
                        strokeWidth={1.5} strokeDasharray="3 2" />
                      <text x={addX} y={getLaneY(i) + 1}
                        textAnchor="middle" dominantBaseline="middle"
                        fill={`${tl.color || '#c4973b'}80`} fontSize={16} fontWeight={300}>+</text>
                    </g>
                  );
                })()}

                {/* Drag insert indicator */}
                {isDropTarget && dragTargetIdx !== null && (() => {
                  // Position the indicator between events using actual positions
                  const laneEvtsFiltered = laneEvts.filter(e => e.id !== draggingId);
                  const prevEvt = dragTargetIdx > 0 ? laneEvtsFiltered[dragTargetIdx - 1] : null;
                  const nextEvt = laneEvtsFiltered[dragTargetIdx];
                  const prevPos = prevEvt ? positions.get(prevEvt.id) : null;
                  const nextPos = nextEvt ? positions.get(nextEvt.id) : null;
                  const indicatorX = prevPos && nextPos
                    ? (prevPos.x + nextPos.x) / 2
                    : nextPos
                      ? nextPos.x - EVENT_SPACING / 2
                      : prevPos
                        ? prevPos.x + EVENT_SPACING / 2
                        : LANE_LABEL_WIDTH + 40;
                  return (
                    <line x1={indicatorX} y1={getLaneY(i) - 30}
                      x2={indicatorX} y2={getLaneY(i) + 30}
                      stroke="#c4973b" strokeWidth={3} strokeLinecap="round" strokeDasharray="6 3" />
                  );
                })()}
              </g>
            );
          })}

          {/* Connections */}
          {connections.map(conn => {
            const from = positions.get(conn.sourceEventId);
            const to = positions.get(conn.targetEventId);
            if (!from || !to) return null;
            const isHovered = hoveredConnectionId === conn.id;
            const dash = conn.style === 'dashed' ? '8 4' : conn.style === 'dotted' ? '3 3' : undefined;

            return (
              <g key={conn.id} className="cursor-pointer"
                onMouseEnter={(e) => { setHoveredConnectionId(conn.id); showConnectionTooltip(conn, e); }}
                onMouseLeave={() => { setHoveredConnectionId(null); hideTooltip(); }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  setContextMenu(null);
                  setConnContextMenu({ x: e.clientX, y: e.clientY, connId: conn.id });
                  hideTooltip();
                }}>
                {/* Wide hit area */}
                <path d={connectionPath(from.x, from.y, to.x, to.y)}
                  fill="none" stroke="transparent" strokeWidth={20} />
                {/* Visible path */}
                <path d={connectionPath(from.x, from.y, to.x, to.y)}
                  fill="none" stroke={conn.color || '#c4973b'}
                  strokeWidth={isHovered ? 3.5 : 2} strokeDasharray={dash}
                  markerEnd="url(#arrow)"
                  filter={isHovered ? 'url(#glow)' : undefined}
                  opacity={isHovered ? 1 : 0.7} />
                {conn.label && (
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10}
                    textAnchor="middle" fill={conn.color || '#c4973b'}
                    fontSize={10} fontStyle="italic" className="pointer-events-none">
                    {conn.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Event nodes */}
          {timelines.map((tl) => {
            const laneEvents = getEventsForTimeline(events, tl.id);
            return laneEvents.map((evt, evtIdx) => {
              const pos = positions.get(evt.id);
              if (!pos) return null;
              const isDragTarget = draggingId !== null && draggingId !== evt.id &&
                dragTargetLane === tl.id && dragTargetIdx === evtIdx;
              return (
                <EventNode key={evt.id} evt={evt} x={pos.x} y={pos.y}
                  isSelected={selectedEventId === evt.id}
                  isConnecting={connectingFromId === evt.id}
                  isDragTarget={isDragTarget}
                  isConnectTarget={!!connectingFromId && connectingFromId !== evt.id}
                  onMouseDown={(e) => handleMouseDown(e, evt.id)}
                  onDoubleClick={() => handleDoubleClick(evt)}
                  onClick={(e) => handleEventClick(e, evt)}
                  onContextMenu={(e) => handleContextMenu(e, evt.id)}
                  onHoverStart={(rect) => showEventTooltip(evt, rect)}
                  onHoverEnd={hideTooltip}
                />
              );
            });
          })}

          {/* Floating action buttons on selected event */}
          {selectedEventId && !connectingFromId && (() => {
            const pos = positions.get(selectedEventId);
            const evt = events.find(e => e.id === selectedEventId);
            if (!pos || !evt) return null;
            const btnY = pos.y + 42;
            const btnSpacing = 30;
            return (
              <g>
                {/* Edit */}
                <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); openEditForm(evt); }}>
                  <circle cx={pos.x - btnSpacing} cy={btnY} r={12}
                    fill="#1a1a1a" stroke="#c4973b" strokeWidth={1.5} />
                  <text x={pos.x - btnSpacing} y={btnY + 1} textAnchor="middle" dominantBaseline="middle"
                    fill="#c4973b" fontSize={11} fontWeight={600}>✎</text>
                </g>
                {/* Connect */}
                <g className="cursor-pointer" onClick={(e) => {
                  e.stopPropagation();
                  setConnectingFromId(selectedEventId);
                  setSelectedEventId(null);
                }}>
                  <circle cx={pos.x} cy={btnY} r={12}
                    fill="#1a1a1a" stroke="#3b82f6" strokeWidth={1.5} />
                  <text x={pos.x} y={btnY + 1} textAnchor="middle" dominantBaseline="middle"
                    fill="#3b82f6" fontSize={13} fontWeight={600}>⤳</text>
                </g>
                {/* Delete */}
                <g className="cursor-pointer" onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEvent(selectedEventId);
                  setSelectedEventId(null);
                }}>
                  <circle cx={pos.x + btnSpacing} cy={btnY} r={12}
                    fill="#1a1a1a" stroke="#ef4444" strokeWidth={1.5} />
                  <text x={pos.x + btnSpacing} y={btnY + 1} textAnchor="middle" dominantBaseline="middle"
                    fill="#ef4444" fontSize={11} fontWeight={700}>✕</text>
                </g>
              </g>
            );
          })()}
        </svg>

        {/* HTML Tooltip overlay */}
        <AnimatePresence>
          {tooltip && (
            <motion.div
              className="absolute pointer-events-none z-40"
              style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
            >
              <div className="bg-surface border border-border rounded-lg shadow-xl px-3 py-2 max-w-[260px]">
                {tooltip.event && (
                  <>
                    <p className="text-sm font-serif font-bold text-text-primary truncate">{tooltip.event.title}</p>
                    {getDisplayDate(tooltip.event) && (
                      <p className="text-xs text-accent-gold mt-0.5 flex items-center gap-1">
                        {tooltip.event.dateMode === 'calendar' && <Calendar size={10} />}
                        {getDisplayDate(tooltip.event)}
                      </p>
                    )}
                    {tooltip.event.description && (
                      <p className="text-xs text-text-muted mt-1 line-clamp-3">{tooltip.event.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-text-dim uppercase tracking-wider">{tooltip.event.lane}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${tooltip.event.color}20`, color: tooltip.event.color }}>
                        {TYPE_LABELS[tooltip.event.eventType || 'point']}
                      </span>
                    </div>
                  </>
                )}
                {tooltip.connection && (
                  <>
                    <p className="text-xs text-text-muted">
                      <span className="text-text-primary font-semibold">{tooltip.sourceTitle}</span>
                      {' → '}
                      <span className="text-text-primary font-semibold">{tooltip.targetTitle}</span>
                    </p>
                    {tooltip.connection.label && (
                      <p className="text-xs text-accent-gold mt-0.5 italic">{tooltip.connection.label}</p>
                    )}
                  </>
                )}
              </div>
              {/* Arrow */}
              <div className="w-0 h-0 mx-auto border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-border" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (() => {
          const evt = events.find(e => e.id === contextMenu.eventId);
          const laneEvts = evt ? getEventsForTimeline(events, evt.timelineId) : [];
          const idx = evt ? laneEvts.findIndex(e => e.id === evt.id) : -1;
          return (
            <motion.div
              className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-elevated transition"
                onClick={() => { if (evt) openEditForm(evt); }}>
                <Edit3 size={13} /> {t('timeline.editEvent')}
              </button>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-elevated transition"
                onClick={() => { setConnectingFromId(contextMenu.eventId); setContextMenu(null); }}>
                <Link2 size={13} /> {t('timeline.connectTo')}
              </button>
              <div className="border-t border-border my-1" />
              {/* Reorder buttons */}
              <div className="flex items-center px-3 py-1 gap-1">
                <span className="text-[10px] text-text-dim uppercase tracking-wider mr-auto">{t('timeline.reorder')}</span>
                <button
                  className="p-1.5 rounded hover:bg-elevated transition disabled:opacity-20"
                  disabled={idx <= 0}
                  onClick={() => moveEvent(contextMenu.eventId, -1)}
                  title={t('timeline.moveLeft')}
                >
                  <ChevronLeft size={14} className="text-text-muted" />
                </button>
                <button
                  className="p-1.5 rounded hover:bg-elevated transition disabled:opacity-20"
                  disabled={idx >= laneEvts.length - 1}
                  onClick={() => moveEvent(contextMenu.eventId, 1)}
                  title={t('timeline.moveRight')}
                >
                  <ChevronRight size={14} className="text-text-muted" />
                </button>
              </div>
              <div className="border-t border-border my-1" />
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 transition"
                onClick={() => { onDeleteEvent(contextMenu.eventId); setContextMenu(null); setSelectedEventId(null); }}>
                <Trash2 size={13} /> {t('timeline.deleteEvent')}
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Connection Context Menu */}
      <AnimatePresence>
        {connContextMenu && (() => {
          const conn = connections.find(c => c.id === connContextMenu.connId);
          if (!conn) return null;
          const srcEvt = events.find(e => e.id === conn.sourceEventId);
          const tgtEvt = events.find(e => e.id === conn.targetEventId);
          return (
            <motion.div
              className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
              style={{ left: connContextMenu.x, top: connContextMenu.y }}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
                {srcEvt?.title || '?'} → {tgtEvt?.title || '?'}
              </div>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 transition"
                onClick={() => { onDeleteConnection(connContextMenu.connId); setConnContextMenu(null); }}>
                <Trash2 size={13} /> {t('timeline.deleteConnection')}
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Add/Edit Event Modal */}
      <Modal open={showEventForm} onClose={() => { setShowEventForm(false); setEditingEvent(null); }}
        title={editingEvent ? t('timeline.editEvent') : t('timeline.newEvent')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelTitle')}</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('timeline.placeholderEventName')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus />
          </div>

          {/* Timeline selector (move between timelines) */}
          {timelines.length > 1 && (
            <div>
              <label className="block text-sm text-text-muted mb-1.5 flex items-center gap-1.5">
                <ArrowRightLeft size={13} /> {t('timeline.labelTimeline')}
              </label>
              <select
                value={form.timelineId}
                onChange={(e) => setForm({ ...form, timelineId: e.target.value })}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              >
                {timelines.map(tl => (
                  <option key={tl.id} value={tl.id}>{tl.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Event Type */}
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelEventType')}</label>
            <div className="flex items-center gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
              {(['point', 'range', 'milestone'] as const).map(type => (
                <button key={type} onClick={() => setForm({ ...form, eventType: type })}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${
                    form.eventType === type
                      ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                      : 'text-text-muted hover:text-text-primary'
                  }`}>
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Date Mode Toggle + Inputs */}
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelDate')}</label>
            <div className="flex items-center gap-1 mb-2 p-0.5 bg-elevated rounded-lg border border-border w-fit">
              <button onClick={() => setForm({ ...form, dateMode: 'text' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  form.dateMode === 'text' ? 'bg-accent-gold/20 text-accent-gold font-semibold' : 'text-text-muted hover:text-text-primary'
                }`}>
                <Type size={12} /> {t('timeline.freeText')}
              </button>
              <button onClick={() => setForm({ ...form, dateMode: 'calendar' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  form.dateMode === 'calendar' ? 'bg-accent-gold/20 text-accent-gold font-semibold' : 'text-text-muted hover:text-text-primary'
                }`}>
                <Calendar size={12} /> {t('timeline.calendar')}
              </button>
            </div>

            {form.dateMode === 'text' ? (
              <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                placeholder={t('timeline.placeholderFreeDateAlt')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition" />
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">{t('timeline.startDate')}</label>
                  <input type="date" value={form.realDate}
                    onChange={(e) => setForm({ ...form, realDate: e.target.value })}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">{t('timeline.endDate')} <span className="text-text-dim">{t('timeline.endDateOptional')}</span></label>
                  <input type="date" value={form.realDateEnd}
                    onChange={(e) => setForm({ ...form, realDateEnd: e.target.value })}
                    min={form.realDate || undefined}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition [color-scheme:dark]" />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelDescription')}</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('timeline.placeholderDescription')} rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none" />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelColor')}</label>
            <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} size="sm" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition">
              {editingEvent ? t('timeline.save') : t('timeline.create')}
            </button>
            <button onClick={() => { setShowEventForm(false); setEditingEvent(null); }}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              {t('timeline.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
