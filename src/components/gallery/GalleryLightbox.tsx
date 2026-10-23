// ============================================
// GalleryLightbox — fullscreen image viewer with linked-entity chips
// ============================================
//
// Extracted from `InspirationGallery` (previously ~40 LOC of inline JSX).
// Renders a dismissible fullscreen image with optional chips for the codex
// entries the image is linked to. Kept deliberately dumb — it knows nothing
// about the gallery's state, just how to show one image (and, when the host
// wires `onEditNotes`, let the author caption it: `InspirationImage.notes`
// was displayed and searched everywhere but no input ever wrote it).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { InspirationImage, CodexEntry } from '@/types';
import { codexTypeIcons, codexTypeColors } from '@/components/codex/codexTypeMeta';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import { clampView, FIT, PAN_STEP, ZOOM_STEP, zoomTo, type View } from './galleryZoom';

interface GalleryLightboxProps {
  image: InspirationImage;
  linkedEntries: CodexEntry[];
  onClose: () => void;
  /** Persist a new caption for this image. Omit to render read-only. */
  onEditNotes?: (notes: string) => void;
  /** Hand the image to the Image Studio as an img2img reference. Omit to hide the action. */
  onUseAsReference?: () => void;
}

export default function GalleryLightbox({ image, linkedEntries, onClose, onEditNotes, onUseAsReference }: GalleryLightboxProps) {
  const { t } = useTranslation();
  const [draftNotes, setDraftNotes] = useState(image.notes);
  const [view, setView] = useState<View>(FIT);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; origin: View } | null>(null);

  const boxOf = useCallback(() => {
    const rect = viewport?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, [viewport]);
  const zoomBy = useCallback((factor: number, focus = { x: 0, y: 0 }) => {
    setView(current => zoomTo(current, current.zoom * factor, focus, boxOf()));
  }, [boxOf]);

  // The wheel needs preventDefault, which React's passive wheel handler refuses.
  useEffect(() => {
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const focus = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, focus);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [viewport, zoomBy]);

  // Keyboard: + / - zoom, 0 fits, arrows pan while zoomed. Typing in the caption is left alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const pan = (dx: number, dy: number) => { event.preventDefault(); setView(current => current.zoom > 1 ? clampView({ ...current, x: current.x + dx, y: current.y + dy }, boxOf()) : current); };
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(ZOOM_STEP); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(1 / ZOOM_STEP); }
      else if (event.key === '0') { event.preventDefault(); setView(FIT); }
      else if (event.key === 'ArrowLeft') pan(PAN_STEP, 0);
      else if (event.key === 'ArrowRight') pan(-PAN_STEP, 0);
      else if (event.key === 'ArrowUp') pan(0, PAN_STEP);
      else if (event.key === 'ArrowDown') pan(0, -PAN_STEP);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boxOf, zoomBy]);

  const commitNotes = () => {
    const next = draftNotes.trim();
    if (onEditNotes && next !== image.notes) onEditNotes(next);
  };

  return (
    <Modal open onClose={onClose} ariaLabel={t('gallery.lightbox.title')} fullscreen>
      <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-3 px-12 py-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X size={24} className="text-white" aria-hidden="true" />
        </button>
        <div
          ref={setViewport}
          data-testid="lightbox-viewport"
          className="flex max-h-[80vh] max-w-[90vw] items-center justify-center overflow-hidden rounded-lg"
          style={{ touchAction: 'none', cursor: view.zoom > 1 ? 'grab' : 'zoom-in' }}
          onDoubleClick={() => setView(FIT)}
          onPointerDown={(event) => {
            if (view.zoom <= 1) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, origin: view };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            setView(clampView({ ...start.origin, x: start.origin.x + event.clientX - start.x, y: start.origin.y + event.clientY - start.y }, boxOf()));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        >
          <img
            src={image.imageData}
            alt={image.notes || t('gallery.lightbox.imageAlt')}
            data-testid="lightbox-image"
            draggable={false}
            className="max-w-[90vw] max-h-[80vh] select-none shadow-2xl"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: 'center center' }}
          />
        </div>
        <div className="flex items-center gap-2" role="group" aria-label={t('gallery.lightbox.zoomGroup')}>
          <button type="button" data-testid="lightbox-zoom-out" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={view.zoom <= 1} aria-label={t('gallery.lightbox.zoomOut')} title={t('gallery.lightbox.zoomOut')} className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-40">
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <span data-testid="lightbox-zoom-level" className="w-12 text-center text-xs text-white/70">{Math.round(view.zoom * 100)}%</span>
          <button type="button" data-testid="lightbox-zoom-in" onClick={() => zoomBy(ZOOM_STEP)} aria-label={t('gallery.lightbox.zoomIn')} title={t('gallery.lightbox.zoomIn')} className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20">
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button type="button" data-testid="lightbox-zoom-reset" onClick={() => setView(FIT)} disabled={view.zoom === 1 && view.x === 0 && view.y === 0} aria-label={t('gallery.lightbox.zoomReset')} title={t('gallery.lightbox.zoomReset')} className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-40">
            <Maximize size={14} aria-hidden="true" />
          </button>
        </div>
        {onEditNotes ? (
          <input
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder={t('gallery.imageNotes')}
            className="w-[min(90vw,28rem)] px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder-white/40 text-center outline-none focus:border-accent-gold transition"
          />
        ) : (
          image.notes && <p className="text-sm text-white/80 max-w-[90vw] text-center">{image.notes}</p>
        )}
        {onUseAsReference && (
          <button
            type="button"
            onClick={onUseAsReference}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/10 text-white/90 hover:bg-accent-gold/30 hover:text-white transition"
          >
            <ImagePlus size={12} />
            {t('gallery.useAsReference')}
          </button>
        )}
        {linkedEntries.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-center">
            {linkedEntries.map((entry) => {
              const Icon = codexTypeIcons[entry.type];
              const color = codexTypeColors[entry.type];
              return (
                <span
                  key={entry.id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: `${color}30`, color }}
                >
                  <Icon size={12} />
                  {entry.title}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
