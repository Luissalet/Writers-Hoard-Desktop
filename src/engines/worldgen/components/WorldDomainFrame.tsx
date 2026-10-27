import { useLayoutEffect, useRef, useState } from 'react';
import { MoveDiagonal, MoveDiagonal2, MoveHorizontal, MoveVertical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DomainAnchor, DomainBounds } from '../core/worldDomain';

export interface DomainDraft { width: string; height: string; anchor: DomainAnchor; fill: 'sea' | 'land' }
const handles = [
  ['north', 'south', 0, -1], ['north-east', 'south-west', 1, -1],
  ['east', 'west', 1, 0], ['south-east', 'north-west', 1, 1],
  ['south', 'north', 0, 1], ['south-west', 'north-east', -1, 1],
  ['west', 'east', -1, 0], ['north-west', 'south-east', -1, -1],
] as const;
type Side = typeof handles[number];

/** Preview geometry only. Pointer coordinates never become journal edits here. */
export default function WorldDomainFrame({ saved, bounds, cellKm, draft, onChange }: {
  saved: DomainBounds; bounds: DomainBounds; cellKm: number;
  draft: DomainDraft; onChange: (draft: DomainDraft) => void;
}) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null), host = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ original: DomainDraft; side: Side; x: number; y: number; width: number; height: number; scale: number; pointerId?: number }>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const left = Math.min(saved.x, bounds.x), top = Math.min(saved.y, bounds.y);
  const right = Math.max(saved.x + saved.width, bounds.x + bounds.width), bottom = Math.max(saved.y + saved.height, bounds.y + bounds.height);
  const padding = Math.max(right - left, bottom - top) * .12;
  const view = { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
  const scale = Math.min(size.width / view.width, size.height / view.height) || 1;
  const offset = { x: (size.width - view.width * scale) / 2, y: (size.height - view.height * scale) / 2 };
  const retained = { x: Math.max(saved.x, bounds.x), y: Math.max(saved.y, bounds.y), width: Math.max(0, Math.min(saved.x + saved.width, bounds.x + bounds.width) - Math.max(saved.x, bounds.x)), height: Math.max(0, Math.min(saved.y + saved.height, bounds.y + bounds.height) - Math.max(saved.y, bounds.y)) };
  const begin = (side: Side, x: number, y: number, pointerId?: number) => {
    gesture.current = { original: { ...draft }, side, x, y, width: bounds.width, height: bounds.height, scale: Math.abs(svg.current?.getScreenCTM()?.a ?? scale) || 1, pointerId };
    // Opposite anchor always belongs to SAVED bounds, including a previously centered draft.
    onChange({ ...draft, anchor: side[1] });
  };
  const move = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    const width = Math.max(1, g.width + Math.round((x - g.x) / g.scale) * g.side[2]);
    const height = Math.max(1, g.height + Math.round((y - g.y) / g.scale) * g.side[3]);
    onChange({ ...g.original, anchor: g.side[1], width: String(width * cellKm), height: String(height * cellKm) });
  };
  const escape = () => { if (gesture.current) { onChange(gesture.current.original); gesture.current = undefined; } };
  return <>
    <div ref={host} className="relative my-5 h-60 min-w-0 w-full">
      <svg ref={svg} width="100%" height="100%" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" aria-label={t('worldgen.domain.preview')}>
        <rect {...{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }} className="fill-accent-gold/10 stroke-accent-gold" vectorEffect="non-scaling-stroke" />
        <rect {...saved} className="fill-none stroke-text-muted" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <rect {...retained} className="fill-accent-gold/20" />
      </svg>
      {handles.map(side => {
        const x = bounds.x + bounds.width * (side[2] + 1) / 2, y = bounds.y + bounds.height * (side[3] + 1) / 2;
        const Icon = !side[2] ? MoveVertical : !side[3] ? MoveHorizontal : side[2] === side[3] ? MoveDiagonal2 : MoveDiagonal;
        return <button key={side[0]} type="button" aria-label={t(`worldgen.domain.handle.${side[0]}`)}
          className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-lg border border-accent-gold bg-elevated text-accent-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold"
          style={{ left: offset.x + (x - view.x) * scale, top: offset.y + (y - view.y) * scale }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus();
            begin(side, event.clientX, event.clientY, event.pointerId);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture may already be lost; delivered pointer events remain usable. */ }
          }}
          onPointerMove={event => { if (gesture.current?.pointerId === event.pointerId) move(event.clientX, event.clientY); }}
          onPointerUp={event => { if (gesture.current?.pointerId === event.pointerId) gesture.current = undefined; }}
          onPointerCancel={escape}
          onLostPointerCapture={() => { gesture.current = undefined; }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); escape(); return; }
            if (event.key === 'Enter') { gesture.current = undefined; return; }
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!delta) return;
            event.preventDefault();
            if (!gesture.current) begin(side, 0, 0);
            const g = gesture.current!;
            g.width = Math.max(1, g.width + delta[0] * side[2]); g.height = Math.max(1, g.height + delta[1] * side[3]);
            move(g.x, g.y);
          }}
          onBlur={() => { gesture.current = undefined; }}
        ><Icon size={18} aria-hidden="true" /></button>;
      })}
    </div>
    <p className="text-sm leading-relaxed text-text-muted">{t('worldgen.domain.frameHint')}</p>
  </>;
}
