import { useRef, useState, type CSSProperties } from 'react';
import type { ReaderPresentation } from '../readerPresentationTypes';
import { readerInk, readerRaster } from '../readerPresentation';
import { READER_PRESENTATION_CSS } from '../readerPresentationStyle';
export default function ReaderBookCover({ title, artwork, cover, locale }: { title: string; artwork?: string; cover: ReaderPresentation['cover']; locale: 'es' | 'en' }) {
  const [angle, setAngle] = useState(-25); const drag = useRef<{ x: number; angle: number } | null>(null);
  const depth = cover.style === 'hardcover' ? 24 : cover.style === 'paperback' ? 12 : 3;
  return <div className="wh-reader-cover" style={{ '--book-color': cover.color, '--book-ink': readerInk(cover.color), '--book-depth': `${depth}px`, '--book-half': `${depth / 2}px` } as CSSProperties}>
    <style>{READER_PRESENTATION_CSS}</style>
    <div className="wh-reader-cover-stage" onPointerDown={event => { drag.current = { x: event.clientX, angle }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) setAngle(Math.max(-65, Math.min(65, drag.current.angle + (event.clientX - drag.current.x) / 3))); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div role="img" aria-label={`${locale === 'es' ? 'Portada 3D' : '3D cover'} · ${title}`} data-cover-style={cover.style} className="wh-reader-book" style={{ transform: `rotateX(8deg) rotateY(${angle}deg)` }}>
        <div className="wh-reader-book-back" /><div className="wh-reader-book-pages" /><div className="wh-reader-book-spine"><span>{title}</span></div>
        <div className="wh-reader-book-front" data-texture={cover.texture}>{cover.artwork && readerRaster(artwork) ? <img src={artwork} alt="" draggable={false} /> : <span>{title}</span>}</div>
      </div>
    </div>
    <label className="mx-auto flex max-w-64 items-center gap-3 text-xs text-text-muted">{locale === 'es' ? 'Girar portada' : 'Rotate cover'}<input type="range" min={-65} max={65} value={angle} onChange={event => setAngle(Number(event.target.value))} className="min-w-0 flex-1 accent-accent-gold" /></label>
  </div>;
}
