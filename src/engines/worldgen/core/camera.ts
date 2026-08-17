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

/**
 * The camera's hard limits.
 *
 * The floor was 3 km, chosen when three kilometres was as close as anything had
 * to show. The satellite pyramid now bottoms out at z18 — one canon cell per
 * 256-pixel tile, about 0,6 m per pixel — which on a thousand-pixel canvas is a
 * span of roughly 0,43 km. Every path that REBUILDS a camera from a viewport
 * (`fit`, `applyViewport`, every flight) clamps through this constant, so a
 * floor of 3 made the three deepest levels of the pyramid unrepresentable: you
 * could wheel down to them, but switching view, changing projection or starting
 * any flight threw you back out to 3 km, and the shared viewport reported 3 km
 * to everyone else while the screen showed hedgerows.
 *
 * A quarter of a kilometre clears the deepest level on any canvas anyone is
 * likely to have. The 3D perf gate may still RAISE the effective floor (the
 * agreed fallback if close-range detail cannot hold the frame budget); that is
 * a decision for that view, not a limit on the contract.
 */
export const MIN_SPAN_KM = 0.25;

// ── La historia de ese suelo, traída de `components/World3D.tsx` ──
/**
 * Hasta dónde deja acercarse esta vista, en kilómetros de suelo a lo ancho.
 *
 * Una celda de mundo son ~19,5 km, así que esto es el punto donde una celda
 * mide una decena de píxeles en pantalla. Más abajo no queda NADA que
 * enseñar: sólo un téxel magnificado, y todo rasgo del tamaño de una celda
 * —el ruido natural del fondo marino, el borde de un bioma— se lee como un
 * cuadrado. Ese vacío es justamente lo que el parche regional venía a tapar,
 * y ahora vive donde le corresponde, en el 2D. Así que el 3D se planta aquí,
 * con honradez, y el que quiera bajar más pasa al mapa.
 *
 * A 1200 km caben los Alpes cuatro veces: es un encuadre de cordillera, que
 * es exactamente lo que esta vista existe para enseñar.
 */
// 150, Y AHORA EL CÓDIGO Y EL COMENTARIO DICEN LO MISMO.
//
// Aquí había un párrafo que anunciaba una vuelta a 1200 que nunca se aplicó al
// número, y llevaba razón en su día por dos motivos, de los cuales hoy queda
// medio:
//
//   · «De cerca sólo hay grano»: cierto para el TERRENO y sigue siéndolo — una
//     celda son 19,5 km y acercarse no revela nada que el generador haya
//     calculado. Pero ya no es lo único que se ve. Con un cielo y un mar de
//     verdad, la cámara baja deja de mirar una manta de bultos verdes y pasa a
//     mirar una COSTA: horizonte, orilla con espuma, el reguero del sol sobre
//     el oleaje. La estampa de `harness/out/sky-water/1-atardecer.png` es una
//     cámara a 1,4 unidades sobre el agua; a 1200 km de suelo esa cámara no
//     puede existir (el suelo se traduce a ~7,4 unidades de distancia mínima) y
//     con 150 sí (~0,92). Lo que se gana ahí no lo pinta el relieve: lo pintan
//     el agua y el cielo.
//   · «Abrir con el morro en la hierba»: eso ya NO depende de este número. Es
//     ADOPT_MIN_SPAN_KM, justo debajo, que se separó precisamente porque
//     confundir las dos cosas fue lo que obligó a revertir la bajada. Acercarse
//     a mirar es una decisión del lector; que le dejen caer ahí, no.
//
// 25, POR DECISIÓN DE LUIS (2026-08-11): «puedes hacer zoom sin necesidad de
// hacer esa teselación exagerada — el terreno es bastante llano». La regla
// antigua («el suelo sólo baja cuando el relieve tenga algo debajo») queda
// REVOCADA: el suelo de cerca es la interpolación LISA del campo del mundo, a
// propósito — nada de relieve inventado, que fue lo que dio picos y poros y
// obligó a revertir el intento anterior. Lo que sí gana nitidez al bajar es la
// PIEL: bajo «consume», un encuadre de 25 km pide teselas z14 (~10 m/px) y
// donde el 2D ya generó ese canon el 3D las entinta gratis — tejados y mancha
// urbana incluidos. Frío, se queda en el respaldo z8: borroso pero liso.
// …y 10 desde el 2026-08-12 (Luis: quiere llegar a VER la ciudad — «que las
// ciudades estén ahí literalmente»). A 10 km de vano el plan pide z15–z16
// (2,4–5 m/px): los planos de ciudad de las teselas se leen calle a calle.
// Sigue siendo interpolación lisa del campo del mundo — el relieve no se
// inventa — y bajo «consume» la piel honda sale gratis de la residencia o del
// canon persistido (pasada 8); fría, se queda en el respaldo liso de siempre.

/**
 * Y EL SUELO DE LA VISTA 3D, que es otra cosa y vive aquí para poder medirlo.
 *
 * El párrafo de arriba lo dice: el 3D puede SUBIR el suelo efectivo, y lo hace
 * — primero 1200 km, luego 150, luego 25, luego 10, y desde el 2026-08-15 dos.
 * Los dos números que mandan, en orden:
 *
 *  · LAS CALLES. El plano de ciudad de las teselas se dibuja a partir de 5
 *    m/px (`PLAN_MAX_METRES_PER_PX`, en `region/townPlan.ts`). Medido con
 *    `planZoomSkin` de verdad (banco `descent-3d`), la piel del 3D da:
 *        vano 25 km → z13 → 19,11 m/px      vano 4 km → z16 → 2,39 m/px
 *        vano 20 km → z14 →  9,55 m/px      vano 2 km → z17 → 1,19 m/px
 *        vano 10 km → z15 →  4,78 m/px      vano 1 km → z18 → 0,60 m/px
 *    Con el suelo en 10 km el plano SÍ entraba… sobre el papel: `MIN_UV_WINDOW`
 *    recortaba la ventana de la piel a 20 km y la dejaba en 9,55 m/px, o sea
 *    justo al otro lado del umbral. Dos kilómetros dan 1,19 m/px: cuatro veces
 *    por debajo, con margen para que no lo tumbe el siguiente redondeo.
 *
 *  · Y POR QUÉ SE QUEDÓ EN 2 UN DÍA, Y YA NO. El vértice calculaba su punto del
 *    mundo con `w = uUVMin + uv * uUVSize` en `highp float`, y cerca de u = 0,5
 *    el escalón de un float32 es 2⁻²⁴ ≈ 6e-8 — que en este mundo son **2,4
 *    metros**. Mientras el escalón sea menor que un píxel no se ve: a 2 km de
 *    vano son 2,0 px, a 1 km 4,0 px y a 0,25 km 15 px, y ahí el ráster de la
 *    piel se parte en bandas porque muchos vértices seguidos caen en la misma
 *    uv. Y detrás había un SEGUNDO escalón del mismo tamaño: `modelViewMatrix *
 *    p` restaba dos números de ~96 unidades de escena para dar ~1e-3, con un
 *    escalón de 1,3 m.
 *
 *    El 2026-08-16 se pasó el vértice a un MARCO LOCAL —posición relativa al
 *    centro de la ventana, que es un número pequeño y por tanto exacto— y la
 *    resta grande se subió a la CPU, que la hace en doble precisión: la malla
 *    vive en el centro de su ventana (`Surface.setWindow` mueve `mesh.position`)
 *    y `uZoomRel` trae ya restada la esquina de la piel. La uv absoluta se queda
 *    sólo para MUESTREAR, donde un téxel son veinte kilómetros y 2,4 m de error
 *    es 1e-4 de téxel. Medido en `harness/descent-precision.ts`: a 0,25 km de
 *    vano el escalón pasa de 2,4 m a menos de un milímetro, o sea de 15 px a
 *    0,000. Por eso este número es ahora el del contrato compartido.
 *
 * Sigue siendo interpolación LISA del campo del mundo — el relieve no se
 * inventa, doctrina «CERCA = LISO» (Luis, 2026-08-11) — y bajo «consume» la
 * piel honda sale de la residencia o del canon persistido; fría, del respaldo
 * liso de siempre. Lo que trae la calle es la PIEL, y a 0,25 km la pirámide da
 * z18 ≈ 0,60 m/px, ocho veces por debajo de los 5 m/px que necesita el plano.
 */
export const MIN_3D_SPAN_KM = MIN_SPAN_KM;
export const MAX_SPAN_KM = EARTH_KM;

/** One double-click divides the span by this. */
export const DOUBLE_CLICK_ZOOM = 2.4;
/**
 * Ground a double-click flight should not zoom past.
 *
 * This was 24 km, with a comment saying it stood "until the canon tiles give
 * the close range something honest to show". They do, and it stayed — so below
 * about 58 km of span a double-click, whose entire contract is "go closer",
 * flew the camera BACKWARDS. `zoomToPoint` also guards against that
 * independently now, because a floor that can exceed the current span is a
 * gesture that reverses, whatever the number happens to be.
 */
export const DOUBLE_CLICK_FLOOR_KM = 0.5;
export const FLIGHT_MS = 520;

/**
 * Where a double-click should take the camera, from where it is.
 *
 * Lives here, and is a function rather than an expression at the call site, so
 * that the one property it must have can be MEASURED: the result is never
 * greater than the input. A gesture whose whole meaning is "closer" must not be
 * able to move outward for any span, at any floor.
 */
export function doubleClickSpanKm(spanKm: number): number {
  const now = clampSpanKm(spanKm);
  return Math.min(now, Math.max(DOUBLE_CLICK_FLOOR_KM, now / DOUBLE_CLICK_ZOOM));
}

/**
 * A one-shot flight request. `token` makes each request distinct so a view can
 * key an effect on it — the same pattern World3D's fly-to has always used.
 */
export interface FlyTarget { u: number; v: number; spanKm?: number; token: number }

/**
 * La chincheta de llegada: dónde aterrizó la cámara y cómo se llama el sitio.
 *
 * Vuela con el vuelo pero no ES el vuelo, y por eso es un tipo aparte:
 * `FlyTarget` se consume (una vez, con su ficha, y se acabó) mientras que la
 * chincheta se QUEDA. Volar a un sitio y no marcarlo dejaba al lector mirando
 * un valle igual que todos los demás valles preguntándose si había llegado; la
 * marca es la respuesta, y dura hasta que se vaya de allí.
 *
 * En CELDAS de mundo, como el atlas —que es de donde sale el nombre—, y no en
 * normalizado como el vuelo: convertir una vez en el sitio que ya tiene las dos
 * cifras evita que cada vista se invente su propio redondeo.
 */
export interface FlyMark { x: number; y: number; name: string }

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
