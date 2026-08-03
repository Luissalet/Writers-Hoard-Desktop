/**
 * The one camera.
 *
 * Every view — satellite 2D, 3D, Carta — looks at the same ground through the
 * same `WorldViewport { u, v, spanKm }`, and every conversion between that
 * contract and a view's private camera lives HERE, so two views can never
 * disagree about how wide a kilometre is.
 *
 * EARTH_KM is the VIEW-SIDE circumference only. The regional generator keeps
 * its own constant (2π·6371 in `region/terrain.ts`) deliberately: that number
 * is baked into the noise frequencies of every world ever generated, and
 * "fixing" it would quietly regenerate different countryside everywhere. The
 * camera contract has always been 40 075 (Map2D and World3D both used it), so
 * that is the one this module owns.
 */
import type { WorldViewport } from '../types';
import type { CartoView } from '../cartography/render';

export const EARTH_KM = 40075;

/** The camera's hard limits. The 3D perf gate may RAISE the floor later (the
 *  agreed fallback if close-range detail cannot hold the frame budget). */
export const MIN_SPAN_KM = 3;
export const MAX_SPAN_KM = EARTH_KM;

/** One double-click divides the span by this. */
export const DOUBLE_CLICK_ZOOM = 2.4;
/** Ground a double-click flight should not zoom past, until the canon tiles
 *  give the close range something honest to show. */
export const DOUBLE_CLICK_FLOOR_KM = 24;
export const FLIGHT_MS = 520;

/**
 * A one-shot flight request. `token` makes each request distinct so a view can
 * key an effect on it — the same pattern World3D's fly-to has always used.
 */
export interface FlyTarget { u: number; v: number; spanKm?: number; token: number }

export function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

export function clampSpanKm(spanKm: number): number {
  return Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, spanKm));
}

export function clampViewport(vp: WorldViewport): WorldViewport {
  return { ...vp, u: wrapU(vp.u), v: Math.min(1, Math.max(0, vp.v)), spanKm: clampSpanKm(vp.spanKm) };
}

/** Are two viewports the same place for all practical purposes? Used to break
 *  echo loops between a view reporting out and the same value arriving back. */
export function sameViewport(a: WorldViewport | null | undefined, b: WorldViewport | null | undefined): boolean {
  if (!a || !b) return false;
  const du = Math.abs(a.u - b.u);
  return Math.min(du, 1 - du) < 1e-4
    && Math.abs(a.v - b.v) < 1e-4
    && Math.abs(Math.log(a.spanKm / b.spanKm)) < 1e-3;
}

// ---- carta conversions ------------------------------------------------------

/** The carta camera: zoom is world-height / view-height, centre is normalized. */
export interface CartaCamera { zoom: number; cu: number; cv: number }

export function viewportToCartaCamera(
  vp: WorldViewport, world: { width: number; height: number },
  canvasW: number, canvasH: number, minZoom: number, maxZoom: number,
): CartaCamera {
  const aspect = canvasW > 0 && canvasH > 0 ? canvasW / canvasH : 2;
  const vw = (clampSpanKm(vp.spanKm) / EARTH_KM) * world.width;
  const vh = vw / aspect;
  const zoom = Math.min(maxZoom, Math.max(minZoom, world.height / Math.max(1e-6, vh)));
  return { zoom, cu: wrapU(vp.u), cv: Math.min(1, Math.max(0, vp.v)) };
}

export function cartaViewToViewport(view: CartoView, world: { width: number; height: number }): WorldViewport {
  return {
    u: wrapU((view.x + view.w / 2) / world.width),
    v: Math.min(1, Math.max(0, (view.y + view.h / 2) / world.height)),
    spanKm: clampSpanKm((view.w / world.width) * EARTH_KM),
  };
}

// ---- flight -----------------------------------------------------------------

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * One point along a camera flight, Google-Maps style: positions take the short
 * way around the seam, the span moves in LOG space (a zoom feels linear that
 * way), and when the target is far relative to both spans the flight bows out —
 * pull back, travel, dive — instead of panning at full magnification.
 */
export function flightAt(from: WorldViewport, to: WorldViewport, t: number): WorldViewport {
  const k = easeInOutCubic(Math.min(1, Math.max(0, t)));
  let du = to.u - from.u;
  if (du > 0.5) du -= 1;
  if (du < -0.5) du += 1;
  const u = wrapU(from.u + du * k);
  const v = from.v + (to.v - from.v) * k;
  const travelKm = Math.hypot(du, to.v - from.v) * EARTH_KM;
  // The span the flight would need at its midpoint to keep the journey on
  // screen. Never higher than a full zoom-out, never engaged for short hops.
  const bow = Math.min(MAX_SPAN_KM, Math.max(from.spanKm, to.spanKm, travelKm * 1.25));
  const lf = Math.log(from.spanKm), lt = Math.log(to.spanKm), lb = Math.log(bow);
  const direct = lf + (lt - lf) * k;
  // Parabolic bump that is 0 at both ends and 1 mid-flight.
  const bump = 4 * k * (1 - k);
  const span = Math.exp(direct + Math.max(0, lb - Math.max(lf, lt)) * bump * (travelKm > to.spanKm ? 1 : 0));
  return { u, v, spanKm: clampSpanKm(span) };
}

/** The viewport a double-click should fly to. */
export function doubleClickTarget(current: WorldViewport, u: number, v: number): WorldViewport {
  return clampViewport({
    u, v,
    spanKm: Math.max(DOUBLE_CLICK_FLOOR_KM, clampSpanKm(current.spanKm) / DOUBLE_CLICK_ZOOM),
  });
}
