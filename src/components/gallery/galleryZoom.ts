// Pan and zoom arithmetic for the gallery lightbox, kept apart from the
// component so it can be reasoned about (and tested) without a DOM.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;
export const PAN_STEP = 60;

export interface View { zoom: number; x: number; y: number }
export const FIT: View = { zoom: 1, x: 0, y: 0 };

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : MIN_ZOOM));

/** The picture cannot be dragged further than its own edge past the middle of the window. */
export function clampView(view: View, box: { width: number; height: number }): View {
  const zoom = clampZoom(view.zoom);
  if (zoom === MIN_ZOOM) return FIT;
  const limitX = (box.width * zoom) / 2, limitY = (box.height * zoom) / 2;
  return { zoom, x: Math.min(limitX, Math.max(-limitX, view.x)), y: Math.min(limitY, Math.max(-limitY, view.y)) };
}

/**
 * Change the zoom keeping the point under `focus` (relative to the window
 * centre) where it is, so the wheel zooms toward the pointer.
 */
export function zoomTo(view: View, nextZoom: number, focus: { x: number; y: number }, box: { width: number; height: number }): View {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / view.zoom;
  return clampView({ zoom, x: focus.x - (focus.x - view.x) * ratio, y: focus.y - (focus.y - view.y) * ratio }, box);
}
