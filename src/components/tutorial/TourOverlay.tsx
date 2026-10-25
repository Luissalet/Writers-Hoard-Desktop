// The spotlight and its popover: the screen is dimmed except around the
// element a step points at; the popover says what it is. Both follow the
// element when the window resizes, the page scrolls or the layout moves.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n/useTranslation';
import { activeTourDefinition, activeTourRoot, manualTourStep, backStep, closeTour, finishTour, findAnchor, nextStep } from './tourController';
import { tourCopy, fill } from './tourCopy';
import { dimStrips, placePopover, spotlightBox, usableRect, type Box } from './tourGeometry';
import { useTourStore } from './tourStore';

const DIM = 'rgba(8, 8, 12, 0.62)';

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export default function TourOverlay() {
  const { locale } = useTranslation();
  const words = tourCopy[locale];
  const active = useTourStore(state => state.active);
  const resolving = useTourStore(state => state.resolving);
  const tour = activeTourDefinition(active);
  const step = tour && active ? tour.steps[active.index] : undefined;
  const visible = !!active && active.shown > 0 && !!tour && !!step;
  const anchor = visible ? active.anchor : undefined;
  const root=activeTourRoot(active),manual=manualTourStep(active);

  const [target, setTarget] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState({ width: 340, height: 190 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const measure = useCallback(() => {
    setViewport(previous => (previous.width === window.innerWidth && previous.height === window.innerHeight ? previous : { width: window.innerWidth, height: window.innerHeight }));
    const element = anchor ? findAnchor(anchor,root) : null;
    const rect = element?.getBoundingClientRect();
    const next = rect && usableRect(rect) ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    setTarget(previous => (sameBox(previous, next) ? previous : next));
    const popover = popoverRef.current?.getBoundingClientRect();
    if (popover && popover.width > 0) {
      setSize(previous => (previous.width === popover.width && previous.height === popover.height ? previous : { width: popover.width, height: popover.height }));
    }
  }, [anchor,root]);

  // Bring the element into view, then measure on the next frame.
  useLayoutEffect(() => {
    if (!visible) return;
    if (anchor) findAnchor(anchor,root)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [visible, anchor, active?.index, measure,root]);

  // Follow the element: resize, any scroll (capture, so inner scrollers count),
  // the element's own size, and a slow tick for layout changes nothing announces.
  useEffect(() => {
    if (!visible) return;
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const element = anchor ? findAnchor(anchor,root) : null;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onMove);
    if (element) observer?.observe(element);
    const tick = window.setInterval(onMove, 250);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      observer?.disconnect();
      window.clearInterval(tick);
    };
  }, [visible, anchor, active?.index, measure,root]);

  // Keyboard focus lands on the primary button of each step.
  useEffect(() => {
    if (visible) primaryRef.current?.focus({ preventScroll: true });
  }, [visible, active?.index]);

  if (!visible || !tour || !step) return null;
  const last = active.index === tour.steps.length - 1;
  const hole = target ? spotlightBox(target, viewport) : null;
  const place = placePopover(hole, size, viewport);
  const goNext = () => { void (last ? finishTour() : nextStep()); };

  return createPortal(
    <div data-testid="tour-overlay" className="fixed inset-0 z-[80]" style={{ pointerEvents: 'none' }}>
      {hole ? (
        <>
          {/* Four strips, not one mask: the hole stays clickable, the rest swallows clicks. */}
          {dimStrips(hole, viewport).map((strip, index) => (
            <div
              key={index}
              data-testid="tour-dim"
              style={{ position: 'fixed', left: strip.left, top: strip.top, width: strip.width, height: strip.height, background: DIM, pointerEvents: 'auto' }}
            />
          ))}
          <div
            data-testid="tour-spotlight"
            data-tour-target={anchor}
            style={{ position: 'fixed', left: hole.left, top: hole.top, width: hole.width, height: hole.height, borderRadius: 8, boxShadow: '0 0 0 2px var(--color-accent-gold, #d4a937)', pointerEvents: 'none' }}
          />
        </>
      ) : (
        <div data-testid="tour-dim" style={{ position: 'fixed', inset: 0, background: DIM, pointerEvents: 'auto' }} />
      )}
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-label={words.dialogLabel}
        aria-labelledby="tour-popover-title"
        data-testid="tour-popover"
        data-tour-side={place.side}
        style={{ position: 'fixed', left: place.left, top: place.top, width: 'min(340px, calc(100vw - 24px))', pointerEvents: 'auto' }}
        className="rounded-xl border border-accent-gold/50 bg-surface p-4 text-text-primary shadow-2xl"
      >
        <p data-testid="tour-step-counter" className="mb-1 text-[11px] uppercase tracking-wide text-text-dim">
          {fill(words.stepOf, { step: active.index + 1, total: tour.steps.length })} · {tour.title[locale]}
        </p>
        <h2 id="tour-popover-title" data-testid="tour-title" className="mb-1 font-serif text-base font-semibold text-accent-gold">{step.title[locale]}</h2>
        <p data-testid="tour-text" aria-live="polite" className="text-sm leading-relaxed text-text-muted">{step.text[locale]}</p>
        <div className="mt-4 flex items-center gap-2">
          <button ref={manual?undefined:primaryRef} type="button" data-testid="tour-skip" onClick={closeTour} className="rounded-lg px-2 py-1.5 text-xs text-text-dim hover:text-text-primary hover:bg-elevated">
            {words.skip}
          </button>
          <span className="ml-auto" />
          <button
            type="button"
            data-testid="tour-back"
            disabled={active.index === 0 || resolving}
            onClick={() => { void backStep(); }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-elevated disabled:opacity-40"
          >
            {words.back}
          </button>
          {manual&&<button
            ref={primaryRef}
            type="button"
            data-testid={last ? 'tour-finish' : 'tour-next'}
            disabled={resolving}
            onClick={goNext}
            className="rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-semibold text-deep hover:brightness-110 disabled:opacity-60"
          >
            {last ? words.finish : words.next}
          </button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
