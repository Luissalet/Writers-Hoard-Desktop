import { useRef } from 'react';
import type { MapPoint } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { formatKm, scaleBar } from './mapScale';

interface Props {
  aspect: number;
  widthKm?: number;
  measure: MapPoint[] | null;
  outline: { rings: MapPoint[][]; center: MapPoint } | null;
  /** Picture percent under a screen point. */
  toPicture: (clientX: number, clientY: number) => MapPoint | null;
  onMoveOutline: (center: MapPoint) => void;
  onDragOutline: (dragging: boolean) => void;
}

/** Scale bar, the measuring line and a real place's outline, drawn over a classic map. */
export default function MapScaleOverlay({ aspect, widthKm, measure, outline, toPicture, onMoveOutline, onDragOutline }: Props) {
  const { locale } = useTranslation();
  const grab = useRef<{ pointer: number; from: MapPoint; center: MapPoint } | null>(null);
  const bar = widthKm ? scaleBar(widthKm) : null;
  const h = 100 * aspect;
  const at = (p: MapPoint) => `${p.x},${p.y * aspect}`;
  return <>
    {/* While measuring, a clear sheet over shapes and pins takes the clicks, so every click marks a point. */}
    {measure && <div className="absolute inset-0" style={{ cursor: 'crosshair' }} data-testid="map-measure-capture" />}
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} data-testid="map-scale-overlay">
      {outline && <g data-testid="map-real-outline" style={{ pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={event => { const from = toPicture(event.clientX, event.clientY); if (!from) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); grab.current = { pointer: event.pointerId, from, center: outline.center }; onDragOutline(true); }}
        onPointerMove={event => { const held = grab.current; if (!held || held.pointer !== event.pointerId) return; const now = toPicture(event.clientX, event.clientY); if (!now) return; onMoveOutline({ x: held.center.x + now.x - held.from.x, y: held.center.y + now.y - held.from.y }); }}
        onPointerUp={event => { if (grab.current?.pointer !== event.pointerId) return; grab.current = null; onDragOutline(false); }}
        onPointerCancel={() => { grab.current = null; onDragOutline(false); }}
        onClick={event => event.stopPropagation()}>
        {outline.rings.map((ring, i) => <polygon key={i} points={ring.map(at).join(' ')} fill="#e8c76a" fillOpacity={.18} stroke="#e8c76a" strokeWidth={1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />)}
      </g>}
      {measure && measure.length > 0 && <g data-testid="map-measure-line">
        <polyline points={measure.map(at).join(' ')} fill="none" stroke="#17191a" strokeWidth={4} vectorEffect="non-scaling-stroke" />
        <polyline points={measure.map(at).join(' ')} fill="none" stroke="#f3e2a9" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        {measure.map((p, i) => <circle key={i} cx={p.x} cy={p.y * aspect} r={.45} fill="#f3e2a9" stroke="#17191a" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      </g>}
    </svg>
    {bar && <div className="pointer-events-none absolute bottom-[3%] left-[3%] text-[15px] font-semibold text-[#f3eedf] [text-shadow:0_0_3px_#000,0_0_2px_#000]" style={{ width: `${bar.fraction * 100}%` }} data-testid="map-scale-bar" data-km={bar.km}>
      <div className="h-2 border-x-[3px] border-b-[3px] border-[#f3eedf] shadow-[0_1px_2px_#000]" />
      <div className="mt-0.5 text-center">{formatKm(bar.km, locale)}</div>
    </div>}
  </>;
}
