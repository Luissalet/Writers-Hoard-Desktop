import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { StrokePoint } from '../freehand';
import { freehandCopy } from '../freehandCopy';

interface Props { color: string; width: number; onColor: (color: string) => void; onWidth: (width: number) => void; onDone: () => void; onStroke: (points: StrokePoint[], zoom: number) => void; disabled?: boolean }

export default function FreehandOverlay({ color, width, onColor, onWidth, onDone, onStroke, disabled }: Props) {
  const { locale } = useTranslation(); const copy = freehandCopy(locale); const flow = useReactFlow();
  const [preview, setPreview] = useState<StrokePoint[]>([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const session = useRef<{ pointerId: number; screen: StrokePoint[]; world: StrokePoint[]; zoom: number } | null>(null);
  const screenPoint = (event: { clientX: number; clientY: number }, target: SVGSVGElement) => { const rect = target.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  return <>
    <svg className="absolute inset-0 h-full w-full" style={{ zIndex: 4, cursor: disabled ? 'not-allowed' : 'crosshair', touchAction: 'none' }} data-testid="board-freehand-canvas" aria-label={copy.title}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={event => { if (disabled || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const screen = screenPoint(event, event.currentTarget), zoom = flow.getZoom(); session.current = { pointerId: event.pointerId, screen: [screen], world: [flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false })], zoom }; setPreviewZoom(zoom); setPreview([screen]); }}
      onPointerMove={event => { const current = session.current; if (!current || current.pointerId !== event.pointerId) return; event.stopPropagation(); const samples = event.nativeEvent.getCoalescedEvents?.() ?? []; for (const sample of samples.length ? samples : [event]) { const point = screenPoint(sample, event.currentTarget), last = current.screen[current.screen.length - 1]; if (Math.hypot(point.x - last.x, point.y - last.y) < .7) continue; current.screen.push(point); current.world.push(flow.screenToFlowPosition({ x: sample.clientX, y: sample.clientY }, { snapToGrid: false })); } setPreview([...current.screen]); }}
      onPointerUp={event => { const current = session.current; if (!current || current.pointerId !== event.pointerId) return; event.stopPropagation(); const final = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false }); current.world.push(final); event.currentTarget.releasePointerCapture(event.pointerId); session.current = null; setPreview([]); onStroke(current.world, current.zoom); }}
      onPointerCancel={() => { session.current = null; setPreview([]); }}>
      {preview.length > 0 && <polyline points={preview.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={width * previewZoom} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
    </svg>
    <div className="board-chrome absolute bottom-4 left-1/2 z-10 flex w-[min(80%,620px)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-accent-gold/50 bg-surface/95 px-4 py-3 shadow-lg" data-testid="board-freehand-controls"><p className="w-full text-xs text-text-muted">{disabled ? copy.locked : copy.help}</p><label className="flex items-center gap-2 text-xs text-text-muted">{copy.color}<input type="color" value={color} onChange={event => onColor(event.target.value)} aria-label={copy.color} className="h-8 w-10 rounded border border-border bg-elevated p-0.5" /></label><label className="flex items-center gap-2 text-xs text-text-muted">{copy.width}<input type="range" min="1" max="16" value={width} onChange={event => onWidth(Number(event.target.value))} aria-label={copy.width} className="w-24 accent-accent-gold" />{width}</label><button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-gold px-3 py-2 text-xs font-semibold text-deep" data-testid="board-freehand-done"><Check size={14} />{copy.done}</button></div>
  </>;
}
