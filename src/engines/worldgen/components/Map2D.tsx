// ============================================
// World Generator — 2D atlas map (canvas)
// ============================================
// Pan/zoom canvas with pluggable map projections. The equirect render is
// reprojected through a cached pixel index map; overlays (rivers baked into
// their own layer, landmarks, waypoints, graticule) are forward-projected,
// and pointer interactions are inverse-projected. Cylindrical projections
// wrap seamlessly east–west; the others pan as a single sheet.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BiomeId, LandmarkType, WorldData, ViewMode } from '../core/types';
import { BIOME_COLORS, renderAtlasWindow, renderBase, renderRivers, updateAtlasCells } from '../core/render';
import { SculptGesture } from '../sculpt/ops';
import {
  PROJECTIONS, reprojectRgba, type Projection, type ProjectionSpec,
} from '../core/projections';
import {
  commitPaintStroke, commitRefusal, isWaypointTool, negativeOf, pickGeneratedAt, restriction,
  type PaintSpec,
} from '../core/paintCommit';
import type { EditTarget, Pt, Stroke, WorldEdit } from '../core/edits';
import { editKey, filterFor } from '../core/edits';
import { strokeMask } from '../sculpt/ops';
import { Biome } from '../core/types';
import { settlementCellCenter, type HumanGeography, type Road, type Settlement } from '../core/settlements';
import type { SavedWorldRegion, WorldViewport, WorldWaypoint } from '../types';
import { drawAnnotations, type CartoAnnotations } from '../cartography/annotations';
import { tipOf, tipOutline } from '../sculpt/ops';
import type { PaintTool } from './PaintPanel';
import {
  resolveWorldLandmarks,
  type WorldSpatialEntity,
} from '../core/spatialEntities';
import { biomeName } from '../core/gazetteer';
import { biomeLocaleKey } from '../core/biomeKeys';
import {
  declutterLabels, nextSemanticTier, profileForTier, semanticTier,
  type SemanticZoomTier,
} from '../core/semanticZoom';
import { DisplayTileStore } from '../cartography/tileStore';
import { map2DLayerPlan, map2DVectorRiverFallback } from '../cartography/map2dLayers';
import { levelFor, tileCountX, tileId, TILE_PX, type TileKey } from '../cartography/tiles';
import { drawRoadNetwork, unwrapRoad } from '../cartography/roadOverlay';
import { drawRealmBorders, realmBorders, realmTint } from '../cartography/realmOverlay';
import {
  drawWorldRivers, MAX_SAT_TILE_Z, SAT_DEEP_Z, satelliteDeepSupported,
} from '../region/satelliteTile';
import { drawTownWaterfrontStructures, PLAN_MAX_METRES_PER_PX } from '../region/townPlan';
import { kmPerWorldCell } from '../region/terrain';
import { regionClient, tileStats, oldestInFlightMs, traceTiles } from '../region/client';
import { serveTile, tileServiceStats } from '../region/tileService';
import { mapSourceKey } from '../region/contentIdentity';
import { forgeAvailable, forgeDegraded } from '../forge/bridge';
import { canonWorldBound } from '../canonSnapshots';
import type { TilePlace } from '../region/deepTile';
import { COVER_LABEL_ES } from '../region/types';
import type { RegionData } from '../region/types';
import { regionVisibleRect } from '../region/coordinates';
import {
  EARTH_KM, MAX_SPAN_KM, MIN_SPAN_KM, clampViewport, flightAt, FLIGHT_MS, sameViewport,
  type FlyTarget,
} from '../core/camera';

// La tabla completa vive en `core/biomeKeys.ts` (44 entradas): la copia local
// se quedó en 17 cuando la revisión ecológica llevó `Biome` a 43 y el
// sobrevuelo caía al castellano del gazetteer en los biomas nuevos.

/**
 * The ends of the brush-size track, in kilometres of ground.
 *
 * Copied from `PaintPanel`'s slider, which is where the same two numbers live
 * (`BRUSH_MIN_KM` / `BRUSH_MAX_KM`) and which owns the tool this view is only
 * borrowing. Keep them in step: a radius the wheel can reach and the slider
 * cannot is a control that jumps the moment the reader touches it.
 */
const BRUSH_MIN_KM = 0.15;
const BRUSH_MAX_KM = 2500;

/** HUD de depuración del suelo (TEMPORAL — lo pidió Luis el 2026-08-12 para
 *  cazar por qué el zoom se queda borroso en su máquina; quitar cuando el
 *  diagnóstico esté hecho: poner a false y borrar los bloques que lo leen). */
const DEBUG_HUD = true;

/**
 * MEDIA CELDA AL SUR-ESTE, resuelta en la raíz (B6, cicatriz).
 *
 * `stampDisc` medía `dx = gx - cx` contra el ÍNDICE de la celda, cuando la
 * celda k es el suelo de k a k+1 con su centro en k+0,5 — así que toda
 * pincelada caía media celda al sur-este del puntero (centroide medido:
 * +0,500, +0,500 exactas para radios 1–25). Esta vista lo compensaba
 * desplazando el anillo y la previsualización (`STAMP_OFFSET_CELLS = 0.5`);
 * el 3D no compensaba, y el canon re-rasterizaba el mismo trazo media celda
 * de MUNDO más allá de donde lo puso la malla del mundo, porque el desfase
 * era de media celda DE QUIEN SELLARA.
 *
 * En la pasada 8 la fórmula pasó a medir centros (`gx + 0,5 − cx`) en
 * `sculpt/ops.ts`, la constante se fue, y las listas guardadas se migran al
 * deserializar (v1 → puntos +0,5) para que el suelo de un mundo pintado no se
 * mueva ni una celda. El banco `harness/stamp-convention.ts` guarda la
 * igualdad bit a bit de esa migración y el centrado del convenio nuevo.
 */

interface Map2DProps {
  world: WorldData;
  viewMode: ViewMode;
  projection: Projection;
  showRivers: boolean;
  showLandmarks: boolean;
  showWaypoints: boolean;
  showGrid: boolean;
  waypoints: WorldWaypoint[];
  selectedWaypointId: string | null;
  selectedSpatialKey?: string | null;
  regionalEntities?: WorldSpatialEntity[];
  regionDetail?: RegionData | null;
  /** Placing a pin is the Punto tool with Chincheta selected, not a mode of
   *  its own. Both take normalized coordinates, which is how a pin is stored. */
  onPlaceWaypoint?: (u: number, v: number) => void;
  onRemoveWaypoint?: (id: string) => void;
  /**
   * Una chincheta arrastrada a otro sitio.
   *
   * Separado de `onEdit` porque una chincheta no es una edición del mundo: no
   * entra en la lista, no la deshace Ctrl+Z y sobrevive a regenerar. Ver
   * `isWaypointTool`.
   */
  onMoveWaypoint?: (id: string, u: number, v: number) => void;
  onSelectWaypoint: (id: string | null) => void;
  onSelectSpatialEntity?: (entity: WorldSpatialEntity | null) => void;
  /**
   * Everything below turns this from a picture of the world into one of the two
   * places it can be edited. The satellite map is the flat, undistorted view —
   * the one where a coastline is a coastline and not a coastline seen at an
   * angle — so it carries the same brush the 3D view does, and the same click
   * into a town.
   */
  geography?: HumanGeography | null;
  showSettlements?: boolean;
  /**
   * The road network, drawn as vectors over the ground.
   *
   * Not a decoration: the Camino brush lays roads BETWEEN the ones that are
   * already there, and until this layer existed the 2D map was the only view
   * that carried the brush and did not show its work.
   */
  showRoads?: boolean;
  /** Realm boundaries. Same switch the Carta uses, so one map cannot claim a
   *  frontier the other denies. */
  showBorders?: boolean;
  /**
   * Named geography and ruins — the seas, ranges, plains and abandoned places
   * the generator sited. The Carta has always drawn them; this view, where they
   * can be renamed and deleted, never did.
   */
  showFeatures?: boolean;
  /**
   * The first town of a road being laid, waiting for its second click. Drawn
   * as a ring so the gesture has a visible half-way state instead of only a
   * line of text under the map.
   */
  roadFrom?: Settlement | null;
  tool?: PaintTool;
  onEdit?: (edit: WorldEdit) => void;
  onPickSettlement?: (s: Settlement) => void;
  /** Double-click: descend a league toward that ground (the parent flies). */
  onZoomTo?: (x: number, y: number) => void;
  /** Shared camera state, used when switching between 2D, 3D, and regions. */
  viewport?: WorldViewport;
  onViewportChange?: (viewport: WorldViewport) => void;
  /** One-shot animated flight request (double-click, "volar aquí"). */
  flyTarget?: FlyTarget | null;
  /** Bumped when an edit changed the world under us, so the raster is rebuilt. */
  revision?: number;
  /**
   * The PRISTINE world plus its serialized strokes.
   *
   * Deep tiles regenerate the canon countryside at 153 m and re-apply the
   * strokes at that resolution; handing them the already-edited world would
   * bake every stroke twice, once as a world-grid smudge and once properly.
   * Absent, the pyramid stops at the levels the world raster can serve.
   */
  canonWorld?: WorldData;
  canonEdits?: string;
  /** Set by the parent; this view assigns a renderer to it. `scale` multiplies
   *  the on-screen resolution. Returns null if there is nothing to draw. */
  exportRef?: { current: ((scale: number) => Promise<Blob | null>) | null };
  /**
   * Change the brush the panel owns. The wheel resizes it and Alt picks a
   * biome up off the ground; without this the only way to set either is the
   * panel, which is on the other side of the screen from the stroke.
   */
  onTool?: (patch: Partial<PaintTool>) => void;
  /**
   * LAS COMARCAS QUE EL LECTOR HA GUARDADO.
   *
   * Guardar una comarca la metía en un panel y en ningún sitio más: el lector
   * archivaba «el Valle de Ivrén» y al volver al mapa no había manera de saber
   * dónde estaba, ni de ver que las tres que tiene guardadas se solapan. Una
   * comarca es un TROZO DE MUNDO, y un trozo de mundo se dibuja donde está.
   */
  savedRegions?: SavedWorldRegion[];
  /** La que está abierta ahora mismo, si hay alguna: se dibuja encendida. */
  activeRegionId?: string | null;
  /** Un clic en el marco de una comarca la abre. */
  onOpenSavedRegion?: (id: string) => void;
  /**
   * Las marcas del lector que NO son cartografía: la ruta planificada, las dos
   * puntas de un viaje, los sitios de los que habla el manuscrito.
   *
   * Sólo llegaban a `CartoMap`, así que abrir el Índice o planear un Viaje
   * echaba al lector del 2D a la lámina dibujada — y con él el pincel, la
   * pirámide de satélite y todo lo que sólo existe aquí. Son puntos y una
   * polilínea en celdas del mundo: esta vista sabe proyectar las dos cosas.
   */
  annotations?: CartoAnnotations;
}

interface ViewState {
  scale: number; // screen px per projected-map px
  ox: number;    // screen offset of map X=0
  oy: number;
}

/**
 * One thing the last frame put on screen, and how close a pointer has to be.
 *
 * Screen pixels, one entry per east–west copy, so nothing downstream has to
 * redo the wrap arithmetic the drawing already did.
 */
interface Hit {
  /** `realmVertex` is the FIRST corner of a frontier being drawn — the handle a
   *  click on closes the ring. It answers a click and nothing else, which is why
   *  the other corners are drawn and not registered. */
  kind: 'settlement' | 'entity' | 'waypoint' | 'place' | 'note' | 'realmVertex';
  x: number;
  y: number;
  reach: number;
  settlement?: Settlement;
  entity?: WorldSpatialEntity;
  waypointId?: string;
  place?: TilePlace;
  /** For `note`: what the readout says. Ruins, named geography and the reader's
   *  own labels are drawn but have no first-class identity in this view yet, so
   *  they answer the hover and nothing else. */
  note?: string;
  /** Para el marco de una comarca guardada: cuál, para poder abrirla. */
  regionId?: string;
  /** Ties are broken toward the more important thing, not the nearer one. */
  bias?: number;
  /**
   * QUÉ SE PUEDE COGER Y ARRASTRAR, y bajo qué llave se guarda el traslado.
   *
   * La llave es siempre la de la posición GENERADA — es lo que
   * `resolveWorldSpatialEntity` promete y lo que hace que un enlace del
   * manuscrito y un renombrado posteriores sigan apuntando al mismo objeto
   * después de moverlo. Por eso se deriva de `sourceX/sourceY`, nunca de dónde
   * está el objeto ahora mismo: si la llave siguiera al objeto, el segundo
   * arrastre escribiría un `move` distinto y el primero quedaría huérfano en la
   * lista de ediciones para siempre.
   *
   * Las chinchetas no lo llevan: no son ediciones del mundo sino notas pegadas
   * al cristal, viven en su propia tabla y se mueven por `onMoveWaypoint`.
   */
  mover?: { target: EditTarget; key: string; label: string };
}

/**
 * A number that identifies a WORLD OBJECT, not a seed.
 *
 * Every cache key in this view was `${seed}:${revision}`. Re-forging with the
 * same seed — a parameter tweak, which is the normal way to iterate on a world
 * — keeps the seed by design, and a world with no strokes has revision 0. So
 * two different planets produced byte-identical keys: `setGeneration` was a
 * no-op, the whole 320-tile pyramid of the OLD continents kept drawing, and the
 * settled sharp window of the old terrain was blitted over the new base raster
 * until the reader happened to pan.
 */
const WORLD_IDS = new WeakMap<object, number>();
let nextWorldId = 1;
function worldId(w: object): number {
  let id = WORLD_IDS.get(w);
  if (id === undefined) { id = nextWorldId++; WORLD_IDS.set(w, id); }
  return id;
}

/** A cell a realm actually holds, and how much ground it holds in all. */
interface RealmAnchor {
  x: number;
  y: number;
  /** Cells claimed, which is what decides whether the name fits on screen. */
  cells: number;
}

/**
 * Where each realm's name goes, worked out ONCE per geography.
 *
 * Finding it costs two passes over the whole grid — two million lookups on a
 * 2048-wide world — which is affordable once and ruinous on every frame of a
 * pan. Keyed on `realmOf`, exactly like the border extraction in
 * `cartography/realmOverlay`: that array is what changes when the political map
 * changes, and a geography rebuilt after a stroke brings a new one.
 */
const REALM_ANCHORS = new WeakMap<Int32Array, Array<RealmAnchor | null>>();

function realmAnchors(W: number, H: number, geo: HumanGeography): Array<RealmAnchor | null> {
  const cached = REALM_ANCHORS.get(geo.realmOf);
  if (cached) return cached;
  const of = geo.realmOf;
  const n = geo.realms.length;
  // Longitude is averaged as an ANGLE. A realm that straddles the antimeridian
  // has columns near 0 and near W, and the plain mean of those puts its capital
  // on the far side of the planet.
  const cosCol = new Float64Array(W), sinCol = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const a = (x / W) * Math.PI * 2;
    cosCol[x] = Math.cos(a); sinCol[x] = Math.sin(a);
  }
  const cos = new Float64Array(n), sin = new Float64Array(n);
  const sumY = new Float64Array(n), count = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = of[y * W + x];
      if (r < 0 || r >= n) continue;
      cos[r] += cosCol[x]; sin[r] += sinCol[x];
      sumY[r] += y; count[r]++;
    }
  }
  const cx = new Float64Array(n), cy = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    cx[r] = ((Math.atan2(sin[r], cos[r]) / (Math.PI * 2)) * W % W + W) % W;
    cy[r] = count[r] ? sumY[r] / count[r] : 0;
  }
  // Second pass: the nearest cell the realm actually HOLDS. A centroid falls in
  // open sea whenever the country curls round a bay and inside the neighbour
  // whenever it is two halves either side of one — and a name lettered over
  // someone else's ground is worse than no name at all.
  const best = new Float64Array(n).fill(Infinity);
  const out: Array<RealmAnchor | null> = new Array(n).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = of[y * W + x];
      if (r < 0 || r >= n) continue;
      let dx = x - cx[r];
      while (dx > W / 2) dx -= W;
      while (dx < -W / 2) dx += W;
      const dy = y - cy[r];
      const d2 = dx * dx + dy * dy;
      if (d2 >= best[r]) continue;
      best[r] = d2;
      out[r] = { x, y, cells: 0 };
    }
  }
  for (let r = 0; r < n; r++) {
    const a = out[r];
    if (a) a.cells = count[r];
  }
  REALM_ANCHORS.set(geo.realmOf, out);
  return out;
}

/**
 * How much ground ONE bucket click may claim, as a share of the whole grid.
 *
 * `realmFloodCells` defaults to a quarter of the planet, which is the cap that
 * stops the flood running for ever rather than one that means anything
 * politically. A click aimed at a peninsula that lands one cell inland instead
 * runs down the whole continent, and the reader's only way back is an undo they
 * have to notice they need — after the geography, the borders and the whole
 * satellite pyramid have been rebuilt around it.
 *
 * THE SHARE IS OF THE WHOLE GRID, AND THE GRID IS MOSTLY SEA. That is what the
 * old four per cent got wrong. `realmFloodCells` is four-connected over LAND —
 * the sea is always an edge — so the thing being capped is a share of the land,
 * and land is about 28 % of the cells. Four per cent of the grid is therefore
 * only about a seventh of the world's land, and a single ordinary realm is
 * routinely 5–6 % of the grid on its own. Measured at 512×256 (131 072 cells):
 * the clicked landmass came to 7 818 cells and the cap to 5 243, so the bucket
 * stopped two thirds of the way through a country the reader had aimed at
 * squarely — and it stopped it in FLOOD ORDER, which is not a coastline but
 * whatever tendril the frontier happened to be crawling down when the counter
 * ran out. A truncated fill looks like a bug in the world, not like a refusal.
 *
 * Fifteen per cent of the grid is a little over half of all the land there is.
 * No single country is that, not even a continent-spanning empire, so no honest
 * fill is ever refused; and it is still comfortably under `realmFloodCells`'
 * own quarter-of-the-planet default, so the guard this cap exists to be — the
 * click that lands one cell the wrong side of a river and runs down the whole
 * continent — still bites, and still bites before the geography, the borders
 * and the satellite pyramid are rebuilt around a mistake.
 *
 * The floor keeps small test worlds usable, where a share of a tiny grid is a
 * few hundred cells and would refuse an ordinary province.
 */
const REALM_FILL_SHARE = 0.15;
const REALM_FILL_FLOOR_CELLS = 2000;

/**
 * The colour a country is aimed at in.
 *
 * The map's own political wash uses `hue` at 55 % / 58 % (see `realmTint`), so
 * a preview drawn in the same hue lands the reader on the colour the ground
 * will actually take — a preview in a generic "selection blue" would say
 * nothing about WHICH country is being handed the ground, which is the only
 * question this tool asks.
 *
 * 55 % / 58 %, EXACTLY the wash's numbers. This used to say 60 % / 62 %, which
 * is a fourth spelling of one colour: the wash mixes 55 %/58 % (`realmTint`),
 * the border line strokes 62 %/62 % (`drawRealmBorders`, deliberately brighter
 * because a dashed hairline over photographic ground needs the lift), the
 * PaintPanel swatch fills 55 %/58 % (`components/PaintPanel.tsx`, the realm
 * row) and this preview sat between all three. The preview is the promise the
 * reader is shown before the ground changes hands, so it is the one that has
 * to match the GROUND — the swatch they picked from and the wash they will
 * get — and not the line drawn around it.
 */
function realmColor(
  geo: HumanGeography | null | undefined,
  realm: number,
  alpha: number,
): string {
  const hue = realm >= 0 ? geo?.realms[realm]?.hue : undefined;
  // Unclaimed ground has no hue: the wash leaves it bare. So the negative of
  // every frontier gesture draws in bone, which is the one colour no realm's
  // deterministic hue can collide with.
  return hue === undefined
    ? `rgba(228,222,210,${alpha})`
    : `hsl(${hue} 55% 58% / ${alpha})`;
}

/**
 * Does this tool HAVE a size at all?
 *
 * The exact rule `PaintPanel` uses to decide whether to show the size track
 * (its own `isBrush`), and it has to stay that rule: Ctrl+rueda is the same
 * control as the slider, so a chord that moves a number the panel does not show
 * is a chord with no visible effect — and, worse, one that eats the camera zoom
 * to produce it. In Río, Punto and Camino mode it did exactly that: `tool.radius`
 * changed, nothing on screen moved, and the wheel stopped zooming; the frontier
 * bucket and the two lassos had the same problem, with the ring not even drawn.
 *
 * Río has a width and Punto has a marker, and neither is `radius` — so neither
 * belongs here.
 */
function hasRadius(tool: PaintTool | null | undefined): boolean {
  if (!tool) return false;
  return tool.mode === 'terrain' || tool.mode === 'land' || tool.mode === 'biome'
    || tool.mode === 'places'
    || (tool.mode === 'frontera' && tool.realmTool === 'brush');
}

/**
 * Corner cutting for the CURVED lasso's preview.
 *
 * A mirror of the `chaikinRing` that `polygonCells` runs, at the same two
 * iterations, and it has to stay in lockstep with it: that helper is private to
 * `core/edits.ts` and the open-path version in `cartography/contours` rounds a
 * closed ring's last corner differently. The preview is the only promise the
 * reader gets about where a frontier will land, so a preview cut tighter or
 * looser than the commit hands a neighbour a strip of ground the reader watched
 * themselves keep.
 */
function chaikinPreview(pts: Pt[]): Pt[] {
  let cur = pts;
  for (let it = 0; it < 2; it++) {
    if (cur.length < 3) return cur;
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

/**
 * The stroke a brush gesture stores, trimmed the way every other brush's is.
 *
 * `paintCommit` decides which head fields a stored stroke may carry — only what
 * differs from a plain disc, because a saved world IS its edit list and a field
 * written today has to be read back the same way for as long as the world
 * exists. That rule is private to `paintCommit` and this view may not add a
 * `frontera` case to it, so the trimming is BORROWED through the terrain case
 * rather than copied: a second copy here is exactly how a realm stroke would
 * quietly start storing fields no other brush does, and replay as different
 * ground on the next version of the program.
 */
function realmBrushStroke(spec: PaintSpec, pts: Pt[]): Stroke | null {
  const shaped = commitPaintStroke({ ...spec, mode: 'terrain' }, pts);
  return shaped?.kind === 'terrain' ? shaped.stroke : null;
}

/**
 * The window of WORLD CELLS one east–west copy can show.
 *
 * `drawRealmBorders` culls in CELL space — it compares this rect against
 * segment endpoints that are cell corners in [0, W] × [0, H] — and that is the
 * whole reason the layer costs a couple of milliseconds instead of projecting
 * ten thousand segments per copy per frame. So the rect it is handed has to be
 * in cells, and the rect the camera knows about is in SCREEN PIXELS OF A
 * PROJECTED SHEET, which is not the same thing and is not even the same shape.
 *
 * The old caller mixed the two: `y: -view.oy / scale, h: ch / scale`. `scale`
 * is pixels per row of the PROJECTED sheet (PH rows), and the comparison is
 * against world rows (H of them). Equirect gets away with it because PH === H
 * there; nothing else does. Measured, camera resting on a real frontier at 6×
 * zoom: 142 runs drawn in equirect, **0 in azimuthal** — where PH = W = 2H, so
 * every window below the sheet's half-way row asks for cell rows that do not
 * exist and the boundary vanishes at exactly the zoom the reader went there to
 * see it — and 63 runs in mercator, all of them at the wrong latitude.
 *
 * Two regimes, because two are all there are:
 *
 *   Cylindrical (equirect, mercator). X is longitude alone and Y is latitude
 *   alone, so the window is EXACT: u straight off X, v through the projection's
 *   own inverse, which is monotone in Y on both. Mercator's latitude window is
 *   then genuinely mercator's, not a linear guess at it.
 *
 *   Curved (robinson, mollweide, azimuthal). A screen rectangle is NOT a cell
 *   rectangle here — a rect over the azimuthal disc is an annular wedge, and
 *   the smallest cell rect containing it can be most of the world. So the
 *   window is SAMPLED (a grid of inverse solves over the rect) and then widened,
 *   which is a conservative over-estimate and is meant to be: culling too
 *   little draws a few segments that were never visible, culling too much is
 *   the missing-frontier bug above.
 */
function cellWindow(
  spec: ProjectionSpec,
  geom: { copyOx: number; oy: number; mapW: number; mapH: number; cw: number; ch: number },
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number } {
  const { copyOx, oy, mapW, mapH, cw, ch } = geom;
  // The canvas corners in the sheet's own normalized coordinates.
  const X0 = -copyOx / mapW, X1 = (cw - copyOx) / mapW;
  const Y0 = -oy / mapH, Y1 = (ch - oy) / mapH;

  if (spec.wraps) {
    const vAt = (Y: number): number => {
      // Off the top or bottom of the sheet: the nearest pole, which is the
      // right answer for a camera that has panned past the edge.
      if (Y <= 0) return 0;
      if (Y >= 1) return 1;
      return Math.min(1, Math.max(0, spec.inverse(0.5, Y)?.[1] ?? (Y < 0.5 ? 0 : 1)));
    };
    const y0 = vAt(Y0) * H, y1 = vAt(Y1) * H;
    return { x: X0 * W, y: y0, w: (X1 - X0) * W, h: y1 - y0 };
  }

  const STEPS = 9;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let j = 0; j <= STEPS; j++) {
    const Y = Y0 + ((Y1 - Y0) * j) / STEPS;
    for (let i = 0; i <= STEPS; i++) {
      const uv = spec.inverse(X0 + ((X1 - X0) * i) / STEPS, Y);
      if (!uv) continue;
      if (uv[0] < u0) u0 = uv[0];
      if (uv[0] > u1) u1 = uv[0];
      if (uv[1] < v0) v0 = uv[1];
      if (uv[1] > v1) v1 = uv[1];
    }
  }
  // Every sample fell outside the projection's shape. That is a camera looking
  // at the black margin, but a coarse grid can straddle a thin sliver of sheet
  // without landing on it, so the honest answer is the whole world: a frame
  // that projects everything is slow, a frame that culls everything is wrong.
  if (u0 > u1) return { x: 0, y: 0, w: W, h: H };

  // A quarter of the span plus four cells: the extremum can sit between two
  // samples, and the grid is coarse on purpose (100 inverse solves a frame, not
  // ten thousand). Cheap insurance against the only failure that matters.
  const padU = (u1 - u0) * 0.25 + 4 / W;
  const padV = (v1 - v0) * 0.25 + 4 / H;
  /**
   * A window WIDER THAN HALF THE WORLD does not get culled east–west at all.
   *
   * The azimuthal seam (u = 0) runs from the pole at the centre of the disc out
   * to the rim, and a rect straddling it samples longitudes just under 1 and
   * just over 0 — whose bounding box is [0.01, 0.99], which excludes precisely
   * the ground on the seam. `drawRealmBorders` takes one non-wrapping interval
   * and cannot be told "the two ends", so the answer is not to try: a straddle
   * always shows up as a span past a half, and a window that really is more
   * than half the world had almost nothing to gain from an east–west cull
   * anyway. The latitude cull, which is the one that matters on a disc, stands.
   *
   * (The cylindrical branch above has no such problem: the copies ARE the wrap,
   * and the copy one world over holds the window that contains the seam.)
   */
  /**
   * …and neither does a window that TOUCHES the antimeridian.
   *
   * `realmBorders` emits the east–west wrap as a vertical edge at x = W — the
   * boundary between the last column and the first is a real frontier, not a
   * seam — so the ground at u = 0 is described by segments numbered W, at the
   * far end of an interval that starts at 0. A window sitting on u = 0 would
   * hold the horizontal edges and drop every vertical one, which reads as a
   * frontier that goes dotted for one column at exactly the meridian the reader
   * zoomed in on. One interval cannot hold both ends, so it holds everything.
   */
  const whole = u1 - u0 > 0.5 || u0 - padU <= 0;
  return {
    x: whole ? 0 : (u0 - padU) * W,
    y: (v0 - padV) * H,
    w: whole ? W : (u1 - u0 + 2 * padU) * W,
    h: (v1 - v0 + 2 * padV) * H,
  };
}

/** Settlement ranks, for the hover readout. */
const RANK_ES: Record<string, string> = {
  capital: 'worldgen.hover.rank.capital', city: 'worldgen.hover.rank.city',
  town: 'worldgen.hover.rank.town', village: 'worldgen.hover.rank.village',
};

/** What the canon calls the things it sites, for the hover readout. */
const PLACE_KIND_ES: Record<string, string> = {
  town: 'worldgen.atlas.kind.settlement', village: 'worldgen.hover.rank.village',
  hamlet: 'worldgen.hover.kind.hamlet', farm: 'worldgen.hover.kind.farm',
  mill: 'worldgen.hover.kind.mill', abbey: 'worldgen.hover.kind.abbey',
  tower: 'worldgen.hover.kind.tower', inn: 'worldgen.hover.kind.inn',
  ruin: 'worldgen.atlas.kind.ruin', crag: 'worldgen.hover.kind.crag',
  ford: 'worldgen.hover.kind.ford', bridge: 'worldgen.hover.kind.bridge',
  quarry: 'worldgen.hover.kind.quarry', mine: 'worldgen.hover.kind.mine',
  shrine: 'worldgen.hover.kind.shrine', dock: 'worldgen.hover.kind.dock',
};

/**
 * Cómo se llama cada CLASE de accidente, para el sobrevuelo.
 *
 * `f.kind` es un identificador interno — 'strait', 'hotspring', 'marsh' — y el
 * sobrevuelo lo imprimía tal cual detrás del nombre: «Mar de Vantis · sea».
 * Media línea en inglés dentro de una lectura por lo demás traducida, en la
 * única vista donde se pueden renombrar y borrar esos accidentes.
 *
 * Las cinco clases que también son hitos (volcán, cueva, cascada, garganta,
 * termas) reutilizan las claves del inspector de lugares en vez de duplicarlas:
 * son la misma palabra para el lector, y dos catálogos para una sola cosa es
 * como se separan con el tiempo. `settlement`, `capital` y `realm` están en la
 * tabla porque `FeatureKind` los admite, aunque el generador no los archive hoy
 * como accidentes: una clase que falte aquí vuelve a imprimirse en crudo.
 */
const FEATURE_KIND_ES: Record<string, string> = {
  continent: 'worldgen.feature.kind.continent', ocean: 'worldgen.feature.kind.ocean',
  sea: 'worldgen.feature.kind.sea', bay: 'worldgen.feature.kind.bay',
  strait: 'worldgen.feature.kind.strait', isle: 'worldgen.feature.kind.isle',
  range: 'worldgen.feature.kind.range', peak: 'worldgen.feature.kind.peak',
  forest: 'worldgen.feature.kind.forest', desert: 'worldgen.feature.kind.desert',
  river: 'worldgen.feature.kind.river', lake: 'worldgen.feature.kind.lake',
  marsh: 'worldgen.feature.kind.marsh', cape: 'worldgen.feature.kind.cape',
  valley: 'worldgen.feature.kind.valley', plain: 'worldgen.feature.kind.plain',
  volcano: 'worldgen.place.icon.volcano', cave: 'worldgen.place.icon.cave',
  waterfall: 'worldgen.place.icon.waterfall', gorge: 'worldgen.place.icon.gorge',
  hotspring: 'worldgen.place.icon.hotspring',
  settlement: 'worldgen.atlas.kind.settlement', capital: 'worldgen.hover.rank.capital',
  realm: 'worldgen.atlas.kind.realm',
};

/**
 * Which of the canon's places answer to "Accidentes" rather than "Poblaciones".
 *
 * The deep tiles emit one flat list of names and the map has two switches for
 * them. Named ground and abandoned ground go with the seas, ranges and ruins
 * (`showFeatures`); everything else on the list — town, village, hamlet, farm,
 * mill, abbey, tower, inn, mine, quarry — is somewhere people live or work and
 * goes with the towns (`showSettlements`). Anything the canon starts emitting
 * that is not in here therefore lands under "Poblaciones", which is the safe
 * default: a new KIND of building is still a building.
 */
const DEEP_FEATURE_KINDS = new Set(['ruin', 'crag', 'landmark']);

/**
 * Where each road IS, in world cells, so a frame can reject one without
 * building it.
 *
 * `drawRoadNetwork` derives every road's geometry from scratch on every call:
 * `unwrapRoad` walks the cell list and allocates a `Pt` per cell, then
 * `roadScreenPath` allocates a second array of the same length and calls
 * `toScreen` for every vertex — and only THEN does its bounding box get to
 * reject the road. Called once per east–west copy, that is the whole network
 * built three times per frame before anything is culled: about 22 000 tuples
 * and 60–80 000 short-lived objects on every frame of a pan, for ~91 roads of
 * which, at any zoom worth panning at, a handful are on screen.
 *
 * The un-wrapping is COPY-INDEPENDENT — it is world-cell geometry, and the
 * copies differ only in where that geometry lands on screen — so it has no
 * business inside the copy loop, and being a pure function of the cell list it
 * has no business inside the frame either. Extracted once per road array, kept
 * on its identity, and reduced to the four numbers a cull actually needs: the
 * bounding box is 2 % of the memory of the path and answers the same question.
 *
 * `w` is stored with it because the un-wrap is a function of the world width as
 * well as the cells, and a cache that quietly answers for the wrong width would
 * hide roads on a resized world rather than crash.
 */
const ROAD_BOXES = new WeakMap<readonly Road[], { w: number; box: Float64Array }>();

function roadBoxes(roads: readonly Road[], W: number): Float64Array {
  const hit = ROAD_BOXES.get(roads);
  if (hit && hit.w === W) return hit.box;
  const box = new Float64Array(roads.length * 4);
  for (let i = 0; i < roads.length; i++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // The SAME un-wrap `drawRoadNetwork` runs, so the box is the box of the
    // path that will actually be drawn — including the negative x of a road
    // that crosses the antimeridian, which is the whole point of un-wrapping.
    for (const p of unwrapRoad(roads[i].cells, W)) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    box[i * 4] = x0; box[i * 4 + 1] = y0;
    box[i * 4 + 2] = x1; box[i * 4 + 3] = y1;
  }
  ROAD_BOXES.set(roads, { w: W, box });
  return box;
}

/**
 * The deepest level of the pyramid THIS WORLD can actually reach, or −1.
 *
 * `MAX_SAT_TILE_Z` is the floor of the scheme, not a promise every world can
 * keep. A display tile may only be drawn from canon ground where the canon
 * lattice divides the display grid exactly — `canonCellsPerTile` has to come
 * out a whole number — and on a world whose width is not a power of two it
 * stops doing so before the bottom:
 *
 *   3072 wide → `canonRefinement` 64 → width × refinement = 196 608 = 3 × 2¹⁶,
 *   so `canonCellsPerTile` is 1,5 at z17 and 0,75 at z18. Neither is an
 *   integer, `satelliteDeepSupported` is false for both, and z16 is the floor.
 *   (1536 wide lands in the same place, for the same reason.)
 *
 * The camera used to ignore that: `maxScale` reached z18 on every world, so on
 * a 3072 the reader could zoom two whole levels past anything the canon can
 * draw. What they got there was the worker's fallback — fractal amplification
 * of a 13 km world cell at about 1,2 m per pixel — which means no real
 * coastline, no roofs, no tracks, and every deep place name gone, with nothing
 * on screen to say the ground had stopped being real.
 *
 * The set of supported levels is contiguous (the divisibility only ever fails
 * going deeper), so counting down from the floor finds the true bottom.
 */
function deepestSatelliteZ(world: WorldData): number {
  for (let z = MAX_SAT_TILE_Z; z >= SAT_DEEP_Z; z--) {
    if (satelliteDeepSupported(world, z)) return z;
  }
  return -1;
}

function makeCanvas(px: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // El contexto PUEDE venir null (presión de memoria del rasterizador; medido
  // al entrar aquí desde el 3D con SwiftShader). Una tesela en blanco se
  // repinta al fotograma siguiente; el `!` convertía esto en un TypeError que
  // se comía el fotograma entero.
  c.getContext('2d')?.putImageData(new ImageData(px, w, h), 0, 0);
  return c;
}

/**
 * The political wash, on the SHEET THE GROUND IS DRAWN ON.
 *
 * `realmTint` hands back a W×H equirect canvas — one pixel per world cell, the
 * same lattice `realmOf` lives on. The base raster is not that: every
 * projection but equirect goes through `reprojectRgba`, and `baseCanvas` is
 * then a sheet of a different shape (PW×PH) that the camera draws into
 * `[ox, oy, mapW, mapH]`. Blitting the flat tint into that same rectangle
 * stretches a 2:1 rectangle over whatever shape the ground actually has:
 *
 *   · azimuthal — the ground is a polar disc, PW = PH = W, and the wash is a
 *     2:1 rectangle laid across it. The two figures have nothing in common.
 *   · mercator  — PH = 867 against H = 512 at W = 1024, so a country at 45°N
 *     is washed about 8 % of the map height (roughly 1 500 km) north of the
 *     ground it owns, and the reader is told a neighbour holds it.
 *
 * The border LINES never had this: they go through `toScreen`, which is the
 * projection. So the map contradicted itself — a dashed frontier around one
 * patch of ground and the colour of that country over a different one.
 *
 * So the wash is reprojected exactly the way the base is, through the same
 * cached index map, and — because it is static per `realmOf` — the result is
 * kept rather than rebuilt per frame. ONE slot: switching projection already
 * rebuilds the base and the rivers the same way, and holding a 2–26 MB sheet
 * per projection to save a few milliseconds on a switch nobody makes twice a
 * second is the wrong trade.
 */
const TINT_SHEETS = new WeakMap<Int32Array, { key: string; canvas: HTMLCanvasElement | null }>();

function projectedRealmTint(
  world: { width: number; height: number },
  geo: HumanGeography,
  projection: Projection,
): HTMLCanvasElement | null {
  const flat = realmTint(world, geo);
  // Equirect IS the tint's own lattice: the sheet and the wash are the same
  // shape and the blit was always right there.
  if (!flat || projection === 'equirect') return flat;
  const W = world.width, H = world.height;
  const key = `${projection}:${W}x${H}`;
  const hit = TINT_SHEETS.get(geo.realmOf);
  if (hit && hit.key === key) return hit.canvas;
  const src = flat.getContext('2d')?.getImageData(0, 0, W, H);
  let canvas: HTMLCanvasElement | null = null;
  if (src) {
    const { px, w, h } = reprojectRgba(src.data, W, H, projection);
    canvas = makeCanvas(px, w, h);
  }
  TINT_SHEETS.set(geo.realmOf, { key, canvas });
  return canvas;
}

export default function Map2D({
  world, viewMode, projection, showRivers, showLandmarks, showWaypoints, showGrid,
  waypoints, selectedWaypointId, onPlaceWaypoint, onRemoveWaypoint, onMoveWaypoint,
  onSelectWaypoint,
  selectedSpatialKey, regionalEntities = [], regionDetail, onSelectSpatialEntity,
  geography, showSettlements, showRoads = true, showBorders = false,
  showFeatures = true, roadFrom = null,
  tool, onEdit, onTool, onPickSettlement, onZoomTo,
  viewport, onViewportChange, flyTarget, revision = 0, canonWorld, canonEdits,
  exportRef, savedRegions = [], activeRegionId = null, onOpenSavedRegion, annotations,
}: Map2DProps) {
  const { t } = useTranslation();
  /**
   * Why the last gesture did nothing, in the hint bar, for a few seconds.
   *
   * The bar is already where this view explains itself, so a refusal belongs
   * there rather than in a toast: the reader's eyes are on the map, the answer
   * appears under the map, and it goes away on its own instead of needing to be
   * dismissed. Cleared on a timer AND whenever the tool changes, because a
   * complaint about the label box is nonsense once the reader has moved on.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!refusal) return;
    const id = window.setTimeout(() => setRefusal(null), 4000);
    return () => window.clearTimeout(id);
  }, [refusal]);
  useEffect(() => { setRefusal(null); }, [tool?.mode, tool?.point]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  /**
   * THIS GESTURE IS THE CAMERA, decided once at pointerdown.
   *
   * Space, Shift and the middle button all mean "move the map, do not paint",
   * and `handlePointerDown` has always armed `dragRef` for them. Nothing else
   * knew: `handlePointerMove` opened with `if (brushing) { …ring…; return; }`
   * and returned before the drag branch, so `drag.moved` was never set, the map
   * never moved, and on release the `!drag.moved` path treated the whole thing
   * as a CLICK — with Bioma out that opens a town's plan, with Camino out it
   * silently sets the road's origin. The reader asked to pan and got an edit.
   *
   * Two locale strings promise this works — `worldgen.map.paintHint` ("Espacio
   * para mover el mapa") and `worldgen.paint.dragHint.after` ("o usa el botón
   * central para mover el mapa sin pintar") — so it is not a feature to add but
   * a promise to keep.
   *
   * A ref rather than a modifier re-read per event, because the modifier can be
   * let go mid-drag: the gesture is whatever it was when the button went down,
   * the way every other gesture in this view resolves Ctrl at the press.
   */
  const panRef = useRef(false);
  const rafRef = useRef(0);
  /** Reintento pendiente tras un contexto 2D nulo — ver la guarda de `draw`. */
  const ctxRetryRef = useRef(0);
  /**
   * Non-zero while the export is rendering: the ratio `draw` must use in place
   * of the screen's own device pixel ratio.
   *
   * The export enlarges the backing store and then draws ONE frame into it. If
   * that frame kept measuring in `devicePixelRatio`, every layer would be laid
   * out for a canvas half or a quarter the size it now is and the PNG would be
   * the map in its top-left corner with black around it.
   */
  const exportScale = useRef(0);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  /** Cells the pointer has crossed this stroke, and where the ring is drawn. */
  const stroke = useRef<Pt[] | null>(null);
  /**
   * The frontier being drawn by hand: the corners so far, and which way round.
   *
   * A REF, not state, for the same reason `stroke` is one: every click, every
   * pointer move that swings the rubber band and every frame of the preview
   * would otherwise re-render the whole view, and nothing outside `draw` reads
   * it. `neg` is Ctrl AS IT WAS AT THE FIRST CORNER — a multi-click gesture has
   * no single moment to read a modifier at, so it is read once, shown in the
   * preview's colour for the rest of the shape, and honoured at the close;
   * reading it again at the close would commit a country the reader never saw.
   */
  const realmPoly = useRef<{ pts: Pt[]; neg: boolean } | null>(null);
  /**
   * Live terrain/land sculpting on the satellite: the SAME SculptGesture the
   * 3D view and the sculptor run — the world deforms under the brush, the
   * dirty window re-renders per move, and on release the gesture ROLLS BACK
   * and its edits replay through the session (rollback-then-commit, so the
   * authoritative replay can never drift from the preview).
   */
  const liveSculpt = useRef<SculptGesture | null>(null);
  /**
   * Live BIOME painting on the satellite. No gesture class here: each move
   * restores the touched cells and re-stamps the whole stroke — the stamp is
   * the SAME mask/dither/guard `applyEdits` runs on replay (kept in lockstep
   * below), so preview and commit agree cell for cell. The eraser stays on
   * the polyline preview: taking paint off needs the pre-overlay biome, and
   * only the session knows that.
   */
  const liveBiome = useRef<{ saved: Map<number, number> } | null>(null);
  /** Where the ring is drawn (screen) and what cell it is over (world), because
   *  a ragged rim is a function of the ground it sits on. */
  const brushAt = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  /** Ctrl at the moment the gesture started: the negative of whatever is out. */
  const negRef = useRef(false);
  /** Where the brush gesture started, in screen pixels. A brush stroke has no
   *  `dragRef` to ask, and the Camino tool needs to tell a click from a drag. */
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  /**
   * EL OBJETO QUE VA EN LA MANO, mientras dura el arrastre.
   *
   * `AppliedEdits.moves` existía en el vocabulario desde el principio y no había
   * ningún gesto que lo produjera: el lector colocaba un pueblo y, para
   * correrlo dos leguas, tenía que borrarlo y volver a ponerlo — perdiendo su
   * nombre, sus habitantes y todo lo que el manuscrito colgara de su llave.
   *
   * `live` separa el clic del arrastre: hasta que el puntero no se ha ido a
   * cuatro píxeles esto no es una mudanza, y soltar ahí sigue siendo el clic de
   * siempre (abrir el plano de la ciudad, seleccionar el hito). Sin ese umbral,
   * cada clic en un pueblo escribiría un `move` de cero leguas: un paso de
   * deshacer y una línea en el fichero por no haber hecho nada.
   *
   * Un REF y no estado: se escribe en cada `pointermove` y sólo lo lee `draw`.
   */
  const moveRef = useRef<{
    hit: Hit;
    /** Dónde estaba DIBUJADO al cogerlo — el otro extremo de la línea, y el
     *  origen del desfase: el objeto conserva su posición relativa bajo la
     *  mano en vez de saltar al puntero en cuanto se pasa el umbral. */
    fromX: number;
    fromY: number;
    /** Dónde apretó el lector, en pantalla. El umbral se mide contra esto y no
     *  contra el objeto: el impacto llega a diez píxeles, así que apretar en el
     *  borde de un pueblo ya habría contado como haberlo arrastrado. */
    pressX: number;
    pressY: number;
    /** Dónde está el puntero ahora, en pantalla. */
    x: number;
    y: number;
    live: boolean;
  } | null>(null);
  /**
   * WHAT WAS ACTUALLY DRAWN, in screen pixels, as of the last frame.
   *
   * The hit-tests used to walk the MODEL while `draw` walked a filtered subset
   * of it, and the two filters were never the same. Every disagreement was a
   * bug in one direction or the other: a click on open ocean at world zoom
   * opened the plan of a village too small to be drawn (the town search was a
   * flat 14 px over all 160 settlements, which at full extent is 560 km of
   * ground); pins you had switched off stayed clickable and deletable; the
   * hamlets and mills the deep tiles name were drawn and completely inert; and
   * regional entities were drawn at `x/W` but searched at `(x+0.5)/W`, half a
   * cell — about 88 screen pixels at the only zoom where they exist — so they
   * could never be hit at all.
   *
   * One list, filled by the layer that draws each thing, consumed by every
   * pointer question. Dividing them again is how they drift again.
   */
  const painted = useRef<Hit[]>([]);
  /** The tier the view is currently in, advanced with a dead band. Seeded from
   *  the first camera it is given so the opening frame is not a transition. */
  const tierRef = useRef<SemanticZoomTier>(semanticTier(viewport?.spanKm ?? 40075));
  const spaceRef = useRef(false);
  const brushing = !!tool && tool.mode !== 'off' && !!onEdit;
  // `onTool` rides along here rather than in the wheel effect's dependency
  // list: the parent hands it down as a fresh closure every render, so a
  // dependency would tear down and re-add the non-passive wheel listener on
  // every keystroke anywhere in the panel.
  const brushRef = useRef({ tool, onEdit, onTool, geography, brushing });
  brushRef.current = { tool, onEdit, onTool, geography, brushing };

  const W = world.width, H = world.height;
  const spec = PROJECTIONS[projection];
  const wraps = spec.wraps;
  const landmarks = useMemo(
    () => resolveWorldLandmarks(world),
    // The edit pipeline mutates the same world object and bumps revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, revision],
  );
  // (The union of landmarks and regional entities used to live here, for the
  // hit-test to walk. It walks `painted` now — what the frame actually drew —
  // so the two lists cannot fall out of step again.)

  /**
   * La clase de un accidente o de un hito, en el idioma del lector.
   *
   * Con reserva a la cadena cruda: una clase nueva en el generador saldría en
   * inglés, que es feo, pero saldría — mejor que un hueco o una clave sin
   * resolver donde el lector espera «bahía».
   */
  const kindLabel = (kind: string): string =>
    (FEATURE_KIND_ES[kind] ? t(FEATURE_KIND_ES[kind]) : kind);

  // ---- layers -------------------------------------------------------------
  // `revision` is in the dependency list on purpose: painting MUTATES the world
  // in place, so its object identity is unchanged and a memo keyed on the object
  // alone would keep serving the raster from before the stroke.
  const basePixels = useMemo(
    () => renderBase(world, viewMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, viewMode, revision],
  );
  const riverPixels = useMemo(
    () => renderRivers(world),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, revision],
  );
  /** Palette source for the satellite WINDOW renderer (per-pixel shading needs
   *  the colours unshaded). Only the atlas mode pays for it. */
  const unshadedAtlas = useMemo(
    () => (viewMode === 'atlas' && projection === 'equirect'
      ? renderBase(world, 'atlas', { shade: false }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, viewMode, projection, revision],
  );
  /**
   * The settled satellite window: one canvas rendered at SCREEN resolution for
   * the current view, per-pixel shaded, sub-cell coastline. During a gesture it
   * blits shifted/scaled like every settled layer; 170 ms of stillness renders
   * a fresh one. This is what replaces "magnify 1 px per cell by 28×".
   */
  const sharpSat = useRef<{
    canvas: HTMLCanvasElement; vx: number; vy: number; vw: number; vh: number; key: string;
  } | null>(null);
  const sharpTimer = useRef(0);

  // ---- the satellite pyramid ------------------------------------------------
  // The 2D stops being a magnified picture of the world raster here. Tiles come
  // from the same worker (or Forge process) the Carta and the regional sheets
  // use: above the hand-over level they are the world amplified per pixel,
  // below it they are the canon countryside inked as ground. Everything the
  // gesture needs — ancestor fall-back, LRU, in-flight dedup — lives in
  // DisplayTileStore, which the Carta has been using since the pyramid was
  // built. This view simply asks it for a different paint.
  const tileProps = useRef({ world, geography, canonWorld, canonEdits, showRivers });
  tileProps.current = { world, geography, canonWorld, canonEdits, showRivers };
  const deepPlaces = useRef(new Map<string, TilePlace[]>());
  const requestDrawRef = useRef<() => void>(() => undefined);
  const tileGeneration = useRef('');
  const tileStore = useRef<DisplayTileStore | null>(null);
  useEffect(() => {
    // The store is an external resource and must be created by the effect that
    // owns it. StrictMode runs setup -> cleanup -> setup; the old memoized store
    // survived that probe as disposed and closed every later bitmap (0/N).
    const store = new DisplayTileStore((key: TileKey) => {
      const q = tileProps.current;
      if (!q.geography) return Promise.resolve(null);
      // `places` is an intermediate geography snapshot. Persistent deep tiles
      // are valid only once roads and the inhabited context are complete.
      const deep = key.z >= SAT_DEEP_Z && !!q.canonWorld && q.geography.depth === 'full';
      // The generation this request belongs to, captured NOW.
      const bornAt = tileGeneration.current;
      // The REQUEST, not just its promise. `DisplayTileStore` cancels tiles that
      // leave the wanted set, and it can only do that if the loader hands the
      // handle back — otherwise a one-second pan still queues every tile it
      // crossed and the one the reader stopped on waits behind all of them.
      //
      // POR EL SERVICIO, no por el pool a pelo (ARQUITECTURA-TESELAS §3.1):
      // el servicio sirve del almacén de entintadas primero (revisitas en
      // milisegundos, también entre sesiones), mantiene la cola corta y
      // descartable delante del pool, y comparte el render con cualquier
      // otra vista que quiera la misma tesela.
      const req = serveTile(
        deep ? q.canonWorld! : q.world,
        q.geography,
        key,
        {
          ink: 'satellite',
          themeId: 'satellite',
          // Tiles own terrain and water. Roads and principal city marks are
          // authoritative screen-space overlays and cannot disappear on misses.
          layers: map2DLayerPlan(q.showRivers).tileLayers,
          density: 1,
          reliefAmount: 1,
          // `?? ''`: un mundo SIN ediciones también es suelo hondo con
          // identidad de contenido — con `undefined` el servicio lo trataba
          // como somero (clave por revisión, sin almacén de entintadas): el
          // `s:r3` del log de Luis del 2026-08-13, disco 0/0 y guardadas 0
          // en el mundo recién abierto.
          edits: deep ? (q.canonEdits ?? '') : undefined,
        },
      );
      const promise = req.promise.then((res) => {
        if (!res) return null;
        // The store guards the BITMAP against a stale generation; nothing
        // guarded the places, so a stroke's `clear()` was immediately undone by
        // the pre-stroke requests landing, and hamlet names from the previous
        // country were lettered over the new ground indefinitely.
        if (res.places?.length && bornAt === tileGeneration.current) {
          const places = deepPlaces.current;
          const id = tileId(key);
          // LRU, and big enough to outlast the bitmap cache it shadows: a FIFO
          // of 256 against a 320-tile LRU store meant names were evicted while
          // their tile was still resident, and `fetch` returns early for a
          // cached tile — so they never came back.
          places.delete(id);
          places.set(id, res.places);
          while (places.size > 400) {
            const oldest = places.keys().next().value;
            if (oldest === undefined) break;
            places.delete(oldest);
          }
        }
        return res.bitmap;
      }).catch(() => null);
      return { promise, cancel: req.cancel };
      },
      () => requestDrawRef.current(),
    /**
     * 224, no 512. Aquella subida (2026-08-13) compraba «volver sobre tus
     * pasos sin pagar la cola» a cambio de ~134 MB de RGBA 256² EN EL HILO
     * PRINCIPAL — y ese apilamiento acabó en «RangeError: Array buffer
     * allocation failed» en la máquina de Luis (2026-08-14). Desde F1 volver
     * sobre tus pasos ya no paga la cola: lo paga el ALMACÉN DE ENTINTADAS,
     * en milisegundos y desde el disco. 224 teselas son ~59 MB y cubren dos
     * pantallas del nivel vigente más sus padres.
     */
      224,
    );
    tileStore.current = store;
    traceTiles('almacén-pantalla', 'montado');
    return () => {
      traceTiles('almacén-pantalla', 'DESMONTADO (pirámide fuera)');
      if (tileStore.current === store) tileStore.current = null;
      store.dispose();
    };
  }, []);
  /** Level the pyramid is drawing at, for the parts of the UI outside draw(). */
  const tileLevel = useRef(-1);
  /** The generation, level and (rounded) window the store was last asked to
   *  BUILD for. See where it is used: asking is not free. */
  const lastWant = useRef({ z: -1, key: '' });

  /**
   * The canon under the cursor.
   *
   * The hover readout has always answered from the WORLD cell, which is twenty
   * to forty kilometres of ground averaged into one number — a fair answer when
   * that was all the view could show, and a useless one now that the same
   * screen draws a hedge. At canon depth the reading comes from the 153 m
   * ground instead: the real height here, what is growing on it, how steep it
   * is, whether it is wet.
   *
   * The probe never GENERATES. If the canon under the cursor is not resident it
   * says nothing and the world reading stands — which costs nothing and cannot
   * turn a hover into a nine-second stall.
   */
  const probe = useRef<{
    key: string;
    data: import('../region/workerProtocol').RegionProbe | null;
  } | null>(null);
  const probeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(probeTimer.current), []);

  /**
   * The deepest this camera may go, in screen pixels per world cell.
   *
   * Not a constant. The old `Math.min(28, …)` pinned the view at roughly a
   * kilometre of ground per screen — twenty-eight screen pixels for one
   * twenty-kilometre cell, which is the porridge this whole change exists to
   * remove. The honest ceiling is whatever the deepest AVAILABLE tile level
   * carries: with the canon behind it that is z18 on a power-of-two world, one
   * canon cell per 256-pixel tile, about 0,6 m per pixel. Half a level of slack
   * on top so the last level can be magnified a little rather than stopping
   * dead.
   *
   * AVAILABLE, not nominal — see `deepestSatelliteZ`. A 3072-wide world tops
   * out at z16, and letting the camera reach z18 there bought two levels of
   * fractal porridge dressed up as canon ground.
   */
  const satTopZ = useMemo(
    () => (canonWorld && geography ? deepestSatelliteZ(world) : -1),
    [canonWorld, geography, world],
  );
  /** The floor to hand `levelFor`, in tile levels: the canon's own bottom where
   *  there is a canon, the world raster's otherwise. */
  const topZ = satTopZ >= SAT_DEEP_Z ? satTopZ : 12;
  const maxScaleRef = useRef(28);
  const maxScale = useMemo(() => {
    const usable = viewMode === 'atlas' && projection === 'equirect' && !!geography;
    if (!usable) return 28;
    return (TILE_PX * Math.pow(2, topZ) / world.width) * 1.4;
  }, [topZ, geography, viewMode, projection, world.width]);
  maxScaleRef.current = maxScale;

  /** Refresh the palette AND the sharp window over a freshly sculpted rect —
   *  the whole cost of a live brush move, a few hundred cells' worth. */
  const patchLive = useCallback((d: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!unshadedAtlas || d.x1 < d.x0 || d.y1 < d.y0) return;
    updateAtlasCells(world, unshadedAtlas, d.x0 - 1, d.y0 - 1, d.x1 + 1, d.y1 + 1);
    const sh = sharpSat.current;
    if (sh && sh.key === `${worldId(world)}:${revision}`) {
      const ppcX = sh.canvas.width / sh.vw, ppcY = sh.canvas.height / sh.vh;
      // Half-open pixel rect covering the dirty cells plus a blending skirt.
      const x0 = Math.max(sh.vx, d.x0 - 2), x1 = Math.min(sh.vx + sh.vw, d.x1 + 2);
      const y0 = Math.max(sh.vy, d.y0 - 2), y1 = Math.min(sh.vy + sh.vh, d.y1 + 2);
      if (x1 > x0 && y1 > y0) {
        const px0 = Math.max(0, Math.floor((x0 - sh.vx) * ppcX));
        const py0 = Math.max(0, Math.floor((y0 - sh.vy) * ppcY));
        const px1 = Math.min(sh.canvas.width, Math.ceil((x1 - sh.vx) * ppcX));
        const py1 = Math.min(sh.canvas.height, Math.ceil((y1 - sh.vy) * ppcY));
        const OW = px1 - px0, OH = py1 - py0;
        if (OW > 0 && OH > 0) {
          const buf = new Uint8ClampedArray(OW * OH * 4);
          // The subwindow sits on the SAME sample lattice as the full window
          // (origin at an integer pixel offset), so the patch is seamless.
          renderAtlasWindow(world, unshadedAtlas, buf, OW, OH, {
            x: sh.vx + px0 / ppcX, y: sh.vy + py0 / ppcY, w: OW / ppcX, h: OH / ppcY,
          });
          const tctx = sh.canvas.getContext('2d');
          if (tctx) {
            const img = tctx.createImageData(OW, OH);
            img.data.set(buf);
            tctx.putImageData(img, px0, py0);
          }
        }
      }
    }
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, revision, unshadedAtlas]);

  /** Restore-then-restamp the in-flight biome stroke. KEEP THE STAMP IN
   *  LOCKSTEP with applyEdits' biome overlay (core/edits.ts §3): same dither
   *  hash, same threshold, same sea guard — that agreement is the contract
   *  that lets the release replay authoritatively. */
  const applyLiveBiome = useCallback(() => {
    const lb = liveBiome.current;
    const pts = stroke.current;
    const { tool: bt } = brushRef.current;
    if (!lb || !pts || !bt || bt.mode !== 'biome') return;
    const { elevation, biome } = world;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [i, v] of lb.saved) {
      biome[i] = v;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const st: Stroke = {
      pts, radius: bt.radius, strength: bt.strength, softness: bt.softness,
      curve: bt.curve, tip: bt.tip, angle: bt.angle, jitter: bt.jitter,
      aspect: bt.aspect, taper: bt.taper,
    };
    const mask = strokeMask(st, W, H);
    if (mask) {
      const only = restriction(bt.only);
      const allow = only ? filterFor(only, elevation, W, H) : null;
      mask.each((i, c) => {
        if (allow && !allow(i)) return;
        const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
        const jitter = (hsh - Math.floor(hsh)) * 0.45;
        if (c * st.strength <= 0.35 + jitter * 0.4) return;
        if (elevation[i] <= 0 && bt.biome !== Biome.Ocean && bt.biome !== Biome.Lake) return;
        if (!lb.saved.has(i)) lb.saved.set(i, biome[i]);
        biome[i] = bt.biome;
        const x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      });
    }
    if (x1 >= x0) patchLive({ x0, y0, x1, y1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, patchLive]);

  /** Live paths only arm when they can actually SHOW their work: a fresh
   *  sharp window at satellite depth. Anywhere else the classic preview and
   *  commit-on-release remain exactly as they were. */
  const sharpReady = useCallback((): boolean => {
    const sh = sharpSat.current;
    const v = viewRef.current;
    return !!sh && !!v && v.scale >= 2.5 && sh.key === `${worldId(world)}:${revision}`;
  }, [world, revision]);

  /**
   * A live stroke belongs to ONE world object.
   *
   * `liveSculpt` and `liveBiome` mutate `world.elevation`/`world.biome` in
   * place, and the only rollbacks were on pointerup and pointercancel. Two ways
   * that lost: unmounting mid-stroke (switching view, or the world going null
   * for a render) left the uncommitted deformation baked into the shared world,
   * visible in the 3D and the carta until some other edit forced a replay; and a
   * world SWAP mid-stroke made `rollbackLiveBiome` write the old world's saved
   * biome values into the new world's array at the same flat indices, which is
   * not a stale preview but corruption.
   */
  const liveWorld = useRef<WorldData | null>(null);
  const abandonLive = useCallback(() => {
    const g = liveSculpt.current;
    const lb = liveBiome.current;
    const owner = liveWorld.current;
    liveSculpt.current = null;
    liveBiome.current = null;
    stroke.current = null;
    liveWorld.current = null;
    g?.rollback();
    // The BIOME half too. Nulling `liveBiome` throws away the only record of the
    // pre-stroke values — the first version of this did exactly that, so a world
    // swap or an unmount mid-stroke left painted cells in `world.biome` that
    // were in no edit list and undoable by nothing. Written back only into the
    // world the stroke started on.
    if (lb && owner) for (const [i, v] of lb.saved) owner.biome[i] = v;
  }, []);
  useEffect(() => {
    // On unmount, and whenever the world underneath us is replaced.
    if (liveWorld.current && liveWorld.current !== world) abandonLive();
    return abandonLive;
  }, [world, abandonLive]);

  /** Roll a live biome stroke back to the pre-stroke ground. */
  const rollbackLiveBiome = useCallback(() => {
    // Never against a different world than the one the stroke started on.
    if (liveWorld.current && liveWorld.current !== world) { liveBiome.current = null; return; }
    const lb = liveBiome.current;
    if (!lb) return;
    liveBiome.current = null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [i, v] of lb.saved) {
      world.biome[i] = v;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 >= x0) patchLive({ x0, y0, x1, y1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, patchLive]);

  const baseCanvas = useMemo(() => {
    if (projection === 'equirect') return makeCanvas(basePixels, W, H);
    const { px, w, h } = reprojectRgba(basePixels, W, H, projection);
    return makeCanvas(px, w, h);
  }, [basePixels, projection, W, H]);

  const riverCanvas = useMemo(() => {
    if (projection === 'equirect') return makeCanvas(riverPixels, W, H);
    const { px, w, h } = reprojectRgba(riverPixels, W, H, projection);
    return makeCanvas(px, w, h);
  }, [riverPixels, projection, W, H]);

  const regionalCanvas = useMemo(
    () => regionDetail ? makeRegionalTerrainCanvas(regionDetail) : null,
    [regionDetail],
  );

  const PW = baseCanvas.width, PH = baseCanvas.height;

  const computeViewport = useCallback((): WorldViewport | null => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mapW = PW * view.scale;
    const mapH = PH * view.scale;
    let X = (rect.width * 0.5 - view.ox) / mapW;
    if (wraps) X = ((X % 1) + 1) % 1;
    const Y = (rect.height * 0.5 - view.oy) / mapH;
    const uv = spec.inverse(X, Math.min(1, Math.max(0, Y)));
    if (!uv) return null;
    return {
      u: ((uv[0] % 1) + 1) % 1,
      v: Math.min(1, Math.max(0, uv[1])),
      spanKm: Math.min(EARTH_KM, Math.max(MIN_SPAN_KM, EARTH_KM * rect.width / Math.max(1, mapW))),
    };
  }, [PH, PW, spec, wraps]);

  /** The last camera this view told the parent about — so an echo of our own
   *  report is not mistaken for someone else moving the camera. */
  const lastReported = useRef<WorldViewport | null>(null);
  const reportViewport = useCallback(() => {
    if (!onViewportChange) return;
    const vp = computeViewport();
    if (vp) { lastReported.current = vp; onViewportChange(vp); }
  }, [computeViewport, onViewportChange]);

  // ---- drawing --------------------------------------------------------------
  const draw = () => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return;
    // SIN `!`: al entrar desde el 3D el contexto llegó null (huele a presión
    // de memoria de SwiftShader, no a este fichero) y el TypeError dentro del
    // bucle de dibujo dejaba el mapa en blanco (0,8 % de tinta medido por el
    // banco de arranque) y la consola en rojo. Saltarse el fotograma no basta:
    // nadie vuelve a pedir otro sin un gesto del lector, así que la guarda
    // deja UN reintento armado — cuando el rasterizador vuelva, el mapa
    // aparece solo. Reproducción: views-smoke-run.mjs world3d-globo map2d.
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (!ctxRetryRef.current) {
        ctxRetryRef.current = window.setTimeout(() => {
          ctxRetryRef.current = 0;
          scheduleDraw();
        }, 120);
      }
      return;
    }
    // The export owns this ratio while it renders — see `exportScale`. Every
    // other frame is a screen frame and uses the screen's.
    const dpr = exportScale.current || Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07070d';
    ctx.fillRect(0, 0, cw, ch);
    // Set ONCE, at the top, for the whole frame. It used to be set as a side
    // effect inside the settlement block, so when towns were off (or on the
    // first frame) every decluttered label rendered about half a line below the
    // box the collision test had reserved for it.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const { scale } = view;
    const mapW = PW * scale, mapH = PH * scale;
    // Through the HYSTERESIS, not straight from the span. A camera resting near
    // 520, 2 600 or 11 000 km used to flip tier on trackpad jitter, and each
    // flip took a whole layer of names — and, worse, re-issued a full regional
    // worker generation, because `regionalResolution` is a dependency of that
    // effect. `nextSemanticTier` has provided a 14 % dead band since it was
    // written and no caller had ever used it.
    const spanKm = 40075 * cw / Math.max(1, mapW);
    // To a FIXED POINT, not one step per frame. `nextSemanticTier` moves at most
    // one position, and `applyViewport` schedules exactly one frame — so a jump
    // from the fitted planetary view to a saved comarca rendered (and therefore
    // hit-tested) two tiers stale, and the towns you had just flown to were
    // neither drawn nor clickable until something else forced a redraw.
    for (let guard = 0; guard < 4; guard++) {
      const next = nextSemanticTier(tierRef.current, spanKm);
      if (next === tierRef.current) break;
      tierRef.current = next;
    }
    const semantic = profileForTier(tierRef.current);
    // Filled as each layer draws; swapped in at the end so a half-built frame
    // can never be what the pointer is tested against.
    const hits: Hit[] = [];
    /**
     * LAS MUDANZAS DEL LECTOR ya vienen aplicadas en `geography`.
     *
     * `buildHumanGeography` y `patchGeography` honran `moves` desde la pasada
     * 7, así que poblaciones, ruinas y accidentes llegan aquí YA movidos y no
     * deben corregirse otra vez: la doble corrección de antes convertía el
     * segundo arrastre de un objeto en una CADENA de llaves ({origen→d1,
     * d1→d2}) que sólo esta vista sabía seguir — la Carta, el globo y el
     * atlas se quedaban en d1. Hoy la cadena se colapsa donde se construye el
     * estado (`applyEdits`), la llave del hit puede ser la del dibujo, y la
     * única lista que sigue necesitando su mudanza local son los RÓTULOS
     * pintados, que no pasan por la geografía.
     */
    const moves = world.painted?.moves;
    const movedAt = (key: string): Pt | undefined => moves?.[key];
    const mapLabels: Array<{
      value: { text: string; color: string; size: number; weight: number };
      x: number;
      y: number;
      width: number;
      height: number;
      priority: number;
    }> = [];
    const queueLabel = (
      text: string,
      x: number,
      y: number,
      color: string,
      size: number,
      weight: number,
      priority: number,
    ) => {
      ctx.font = `${weight} ${size}px "Source Sans 3", sans-serif`;
      mapLabels.push({
        value: { text, color, size, weight },
        x,
        y,
        width: ctx.measureText(text).width,
        height: size * 1.4,
        priority,
      });
    };

    // Copies for wrap-around; single sheet otherwise.
    let firstOx = view.ox;
    let lastOx = view.ox;
    if (wraps) {
      firstOx = view.ox % mapW;
      if (firstOx > 0) firstOx -= mapW;
      lastOx = cw;
    }

    // The satellite mode goes through the WINDOW renderer past this scale —
    // under it, everything stays smoothed (crisp cell blocks remain the
    // deliberate look of the analytic modes only).
    const sharpEligible = viewMode === 'atlas' && projection === 'equirect'
      && scale >= 2.5 && !!unshadedAtlas;
    ctx.imageSmoothingEnabled = scale < 3 || sharpEligible;
    ctx.imageSmoothingQuality = 'high';

    /**
     * The sharp window, blitted in every east–west copy.
     *
     * Pulled out because WHERE it goes depends on whether a live gesture is in
     * flight. It is the only surface `patchLive` updates, so while the ground is
     * deforming under the brush it has to go ON TOP of the pyramid; the rest of
     * the time the pyramid is the sharper of the two and goes on top of it.
     */
    const live = !!liveSculpt.current || !!liveBiome.current;
    const blitSharp = () => {
      if (!sharpEligible || !sharpSat.current) return;
      if (sharpSat.current.key !== `${worldId(world)}:${revision}`) return;
      const sh = sharpSat.current;
      for (let ox = firstOx; ox <= lastOx; ox += mapW) {
        ctx.drawImage(sh.canvas, ox + sh.vx * scale, view.oy + sh.vy * scale, sh.vw * scale, sh.vh * scale);
        if (!wraps) break;
      }
    };

    const layerPlan = map2DLayerPlan(showRivers);
    const blitRivers = () => {
      if (!layerPlan.riverFallback || viewMode === 'plates' || viewMode === 'flow') return;
      if (map2DVectorRiverFallback(showRivers, viewMode, projection)) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        ctx.clip();
        for (let ox = firstOx; ox <= lastOx; ox += mapW) {
          drawWorldRivers(world, ctx, {
            x: -ox / scale,
            y: -view.oy / scale,
            w: cw / scale,
            h: ch / scale,
          }, cw, false);
          if (!wraps) break;
        }
        ctx.restore();
        return;
      }
      for (let ox = firstOx; ox <= lastOx; ox += mapW) {
        ctx.drawImage(riverCanvas, ox, view.oy, mapW, mapH);
        if (!wraps) break;
      }
    };

    for (let ox = firstOx; ox <= lastOx; ox += mapW) {
      ctx.drawImage(baseCanvas, ox, view.oy, mapW, mapH);
      if (!wraps) break;
    }
    // `!tilesEligible` matters: the second call below lives INSIDE the pyramid
    // block, which needs `geography` — and `geography` is null for the first
    // second and a half of every world. Without this term, starting a stroke in
    // that window left the reader painting against the 39 km raster with nothing
    // but the ring, which is the failure the conditional order exists to prevent.
    const pyramidHere = viewMode === 'atlas' && projection === 'equirect' && !!geography;
    if (!live || !pyramidHere) blitSharp();
    // ---- the satellite pyramid ---------------------------------------------
    // Drawn OVER the world raster, never instead of it. The raster is the
    // fallback that is always there and always current — including mid-stroke,
    // when the brush has changed the ground under the reader's hand and no
    // tile can know it yet — and the pyramid covers it wherever a tile, or an
    // ancestor's quarter, is resident. Blurry then sharp, never blank.
    // NOT `&& !stroke.current`. That term deleted the entire satellite pyramid
    // for the duration of a gesture — so at the depth the satellite exists for,
    // pressing the brush replaced photographic ground with a 20 km/cell wash
    // and the reader painted blind until they let go.
    //
    // But simply removing it was WORSE, and the first draft of this comment was
    // wrong about why: the pyramid draws AFTER the sharp window, so it covered
    // the only surface the live brush updates and the reader saw nothing but the
    // ring. The order is now conditional — see `blitSharp` above.
    const displayTiles = tileStore.current;
    const tilesEligible = pyramidHere && !!displayTiles;
    let tileZ = -1;
    /** Cobertura exacta del plan vigente. Sólo diagnostica la convergencia:
     *  carreteras, ríos de respaldo y ciudades principales siguen siendo
     *  entidades de pantalla aunque falte una tesela. */
    let tilePlanDebug: { needed: number; exact: number } | null = null;
    if (!tilesEligible) tileLevel.current = -1;
    if (tilesEligible && displayTiles) {
      // A painted stroke is a different country: bumping the generation empties
      // the store rather than showing tiles of the world as it was.
      // Keyed on what the tiles actually INK, not on object identity. Keying on
      // `worldId(geography)` looked right and was a disaster: the two-pass
      // geography produces a new object per pass, so the deep half landing
      // (seconds later, once per world) threw the entire pyramid away, closed
      // every bitmap and re-configured the worker session — the reader watched
      // the ground go blurry a second time for no change they could see. The
      // counts move exactly when a road, a town or a ruin appears or goes.
      const gen = geography
        ? `${mapSourceKey(world, geography, canonEdits ?? '')}`
          + `:rivers${showRivers ? 1 : 0}:canon${canonWorld ? worldId(canonWorld) : 0}`
        : `${worldId(world)}:${revision}:pending`;
      if (gen !== tileGeneration.current) {
        // DEBUG (caza de olas, 2026-08-13): el log de Luis enseñó olas
        // completas de re-pedidos (+208.0 y +209.5) sin causa visible — esta
        // traza nombra QUÉ componente de la generación se movió. Quitar con
        // el resto del DEBUG cuando la caza cierre.
        traceTiles('generación', `«${tileGeneration.current}» → «${gen}»`);
        tileGeneration.current = gen;
        deepPlaces.current.clear();
      }
      displayTiles.setGeneration(gen);
      // `topZ`, not `MAX_SAT_TILE_Z`: the camera stops half a level past the
      // deepest level this world supports, and `levelFor` rounds UP — so a bare
      // `MAX_SAT_TILE_Z` here would still ask for the level above the floor at
      // full zoom, which on a 3072-wide world is a level the canon cannot draw.
      tileZ = levelFor(world, scale, topZ);
      const tv = { x: -view.ox / scale, y: -view.oy / scale, w: cw / scale, h: ch / scale };
      tileLevel.current = tileZ;
      /**
       * ASK for tiles only when the asking buys something.
       *
       * `want` QUEUES A BUILD for every tile of the window, and a pan crosses a
       * new window on every frame — so a one-second drag queued hundreds of
       * tiles of ground the reader had already scrolled past, and the tiles
       * under the cursor when they let go arrived last, behind all of it.
       *
       * Still view: ask. Level changed: ask even mid-drag, because a wheel tick
       * switches the whole pyramid and waiting for the hand to stop would leave
       * the reader staring at an ancestor's blur. Same window as last time:
       * there is nothing new to ask for. `draw` below still runs every frame —
       * what IS resident keeps being composited, dragging or not.
       */
      // Keyed on TILE INDICES, not on world cells. `tv` is in cells and the
      // camera now reaches ~92 000 px per cell, so at deep zoom a whole
      // screenful is less than one cell: `Math.round(tv.w)` was 0 and a full
      // screen-width pan left the key unchanged — the ground you panned onto was
      // never requested at all, for ever, because the post-drag redraw found the
      // same key. Tile indices move exactly when the wanted SET moves.
      const cellsPerTile = W / tileCountX(tileZ);
      const wantKey = `${gen}|${tileZ}|${Math.floor(tv.x / cellsPerTile)},${Math.floor(tv.y / cellsPerTile)}`
        + `,${Math.ceil((tv.x + tv.w) / cellsPerTile)},${Math.ceil((tv.y + tv.h) / cellsPerTile)}`;
      if ((!dragRef.current || tileZ !== lastWant.current.z) && wantKey !== lastWant.current.key) {
        lastWant.current = { z: tileZ, key: wantKey };
        // EL CALENTADOR VA DELANTE DEL PEDIDO. En suelo hondo y frío, cada
        // supertesela del plan se genera en su propia sesión de la Forja — en
        // PARALELO — y las teselas llegan detrás por residencia o siembra.
        // Antes, la afinidad de sesión convertía el primer paseo en una fila
        // india: EN VUELO 1 con quince cores parados (captura de Luis,
        // 2026-08-12). Deduplicado dentro del cliente; fuera de suelo hondo
        // no hace nada.

        // (El calentador de canon vivía aquí; la granja + el servicio + el
        // almacén de entintadas lo jubilaron el 2026-08-14 — ver client.ts.)
        displayTiles.want(world, tileZ, tv);
      }
      const got = displayTiles.draw(ctx, world, tileZ, tv, { x: 0, y: 0, w: cw, h: ch });
      tilePlanDebug = got;
      // The live ground goes back on top: `patchLive` writes the deforming
      // cells into the sharp window and nowhere else, so under the tiles it is
      // invisible and the reader paints by ring alone.
      if (live) {
        blitSharp();
      }
      // Say so when the ground under the reader is still an ancestor's blur.
      // A stroke empties the store — the canon has to be rebuilt with it — and
      // without a word of warning that reads as "the paint did nothing".
      // Something is still missing. Drop the guard so the NEXT frame asks again:
      // a tile that resolved null (worker error, or cancelled by a level flip)
      // clears its in-flight marker and is simply never re-requested otherwise,
      // and the reader is left looking at a blurry square on a still map.
      if (got.exact < got.needed) lastWant.current = { z: -1, key: '' };
      // ...but never bake the progress chip into an export.
      if (got.exact < got.needed && !exportScale.current) {
        const msg = t('worldgen.map.terrainTiles')
          .replace('{exact}', String(got.exact))
          .replace('{needed}', String(got.needed));
        ctx.font = '500 11px "Source Sans 3", sans-serif';
        const tw = ctx.measureText(msg).width;
        ctx.fillStyle = 'rgba(7,7,13,0.62)';
        ctx.beginPath();
        ctx.roundRect(10, ch - 26, tw + 16, 18, 5);
        ctx.fill();
        ctx.fillStyle = '#d8d2c6';
        ctx.fillText(msg, 18, ch - 13);
      }
    }

    // The stable river fallback stays visible over every terrain source while
    // the pyramid converges. At ordinary map scales roads are composited later
    // so their bridges remain legible without street-plan detail.
    blitRivers();

    /** Principal settlements are an authoritative screen-space layer. Deep
     * tiles add buildings and minor places, but never take ownership of city
     * identity or labels; a cache miss therefore cannot hide a city. */
    const deepMarks = !layerPlan.principalSettlements;

    // Book a fresh window once the view rests. Booked from draw() so any
    // gesture reschedules it; rendered synchronously after 170 ms of quiet,
    // which is the same "still, then real" contract the other views keep.
    if (sharpEligible) {
      const want = {
        x: -view.ox / scale, y: -view.oy / scale, w: cw / scale, h: ch / scale,
      };
      const cur = sharpSat.current;
      const key = `${worldId(world)}:${revision}`;
      // `vh` too. Omitting it meant a HEIGHT-only resize — opening a side panel,
      // dragging the window taller — left `x`, `y` and `w` bit-identical, so the
      // window was judged fresh, the 170 ms settle never re-booked, and the strip
      // of viewport that had just appeared kept the coarse raster permanently.
      const stale = !cur || cur.key !== key
        || Math.abs(cur.vx - want.x) > 1e-6 || Math.abs(cur.vy - want.y) > 1e-6
        || Math.abs(cur.vw - want.w) > 1e-6 || Math.abs(cur.vh - want.h) > 1e-6;
      if (stale) {
        window.clearTimeout(sharpTimer.current);
        sharpTimer.current = window.setTimeout(() => {
          const v2 = viewRef.current;
          const c2 = canvasRef.current;
          if (!v2 || !c2 || !unshadedAtlas) return;
          const dpr2 = Math.min(window.devicePixelRatio || 1, 2);
          const cw2 = c2.width / dpr2, ch2 = c2.height / dpr2;
          // Screen-resolution budget: css pixels, capped so a huge monitor
          // still settles in ~one carto-quick-pass worth of time.
          const budget = 900_000;
          const pxCount = cw2 * ch2;
          const f = pxCount > budget ? Math.sqrt(budget / pxCount) : 1;
          const OW = Math.max(64, Math.round(cw2 * f));
          const OH = Math.max(64, Math.round(ch2 * f));
          const rect = {
            x: -v2.ox / v2.scale, y: -v2.oy / v2.scale,
            w: cw2 / v2.scale, h: ch2 / v2.scale,
          };
          const buf = new Uint8ClampedArray(OW * OH * 4);
          renderAtlasWindow(world, unshadedAtlas, buf, OW, OH, rect);
          let target = sharpSat.current?.canvas;
          if (!target) target = document.createElement('canvas');
          if (target.width !== OW || target.height !== OH) {
            target.width = OW; target.height = OH;
          }
          const tctx = target.getContext('2d');
          if (!tctx) return;
          const img = tctx.createImageData(OW, OH);
          img.data.set(buf);
          tctx.putImageData(img, 0, 0);
          sharpSat.current = { canvas: target, ...{ vx: rect.x, vy: rect.y, vw: rect.w, vh: rect.h }, key };
          scheduleDraw();
        }, 170);
      }
    }

    // Screen position for a map point in a given copy.
    const toScreen = (u: number, v: number, copyOx: number): [number, number] => {
      const [X, Y] = spec.forward(u, v);
      return [copyOx + X * mapW, view.oy + Y * mapH];
    };

    const copies: number[] = [];
    if (wraps) {
      for (let ox = firstOx; ox <= lastOx; ox += mapW) copies.push(ox);
    } else {
      copies.push(view.ox);
    }

    // The regional composite: a single 1024-cell window over the ground the
    // reader is looking at, painted over the world raster once semantic zoom
    // reaches its scale. It predates the pyramid and is now the LOWER of the
    // two — so where tiles are drawing it must stay out of the way, or it
    // would paint a coarse wash straight over the sharp ground at exactly the
    // zoom levels this change exists to fix. Its places still feed the
    // regional entity overlay, which is why it is still requested.
    // `viewMode === 'atlas'` is not optional: the composite's pixels are BIOME
    // colours (`makeRegionalTerrainCanvas` reads `BIOME_COLORS`), and the only
    // reason it ever drew in the elevation/temperature/precipitation/plates/flow
    // modes is that `tilesEligible` is false in exactly those modes. So a green
    // forest and a tan desert were being pasted over the middle of a temperature
    // map, at alpha 0.82–0.96.
    if (regionalCanvas && regionDetail && semantic.showRegionalTerrain
      && !tilesEligible && viewMode === 'atlas' && projection === 'equirect') {
      const visible = regionVisibleRect(regionDetail);
      const worldX0 = regionDetail.originX + visible.x * regionDetail.worldPerCellX;
      const worldY0 = regionDetail.originY + visible.y * regionDetail.worldPerCellY;
      const worldX1 = worldX0 + visible.width * regionDetail.worldPerCellX;
      const worldY1 = worldY0 + visible.height * regionDetail.worldPerCellY;
      const u0 = ((worldX0 / W) % 1 + 1) % 1;
      const u1 = ((worldX1 / W) % 1 + 1) % 1;
      const v0 = Math.min(1, Math.max(0, worldY0 / H));
      const v1 = Math.min(1, Math.max(0, worldY1 / H));
      ctx.save();
      ctx.globalAlpha = semantic.tier === 'local' ? 0.96 : 0.82;
      for (const copyOx of copies) {
        const [x0, y0] = toScreen(u0, v0, copyOx);
        const [projectedX1, bottom] = toScreen(u1, v1, copyOx);
        let x1 = projectedX1;
        if (wraps) {
          while (x1 - x0 > mapW / 2) x1 -= mapW;
          while (x1 - x0 < -mapW / 2) x1 += mapW;
        }
        const left = Math.min(x0, x1);
        const top = Math.min(y0, bottom);
        const width = Math.abs(x1 - x0);
        const height = Math.abs(bottom - y0);
        if (width > 1 && height > 1
            && left < cw + 20 && left + width > -20
            && top < ch + 20 && top + height > -20) {
          ctx.drawImage(regionalCanvas, left, top, width, height);
        }
      }
      ctx.restore();
    }

    // Graticule — sampled polylines so curved projections curve.
    //
    // The step follows the zoom. It was a hard 30° lattice, which meant that
    // below about three thousand kilometres of span the "malla" switch was on
    // and NOTHING was on screen: the nearest parallel and the nearest meridian
    // were both off the edge.
    if (showGrid) {
      const stepDeg = semantic.tier === 'planetary' ? 30
        : semantic.tier === 'continental' ? 10
          : semantic.tier === 'regional' ? 2 : 0.5;
      ctx.lineWidth = 1;
      for (const copyOx of copies) {
        for (let lat = -90 + stepDeg; lat <= 90 - stepDeg / 2; lat += stepDeg) {
          const v = 0.5 - lat / 180;
          if (v < 0 || v > 1) continue;
          // Cheap reject: a parallel entirely off the top or bottom costs
          // nothing to skip and 120 forward projections to draw.
          const [, probeY] = toScreen(0.5, v, copyOx);
          if (probeY < -40 || probeY > ch + 40) continue;
          const major = Math.abs(lat) < 1e-6;
          ctx.strokeStyle = major ? 'rgba(232,229,224,0.28)' : 'rgba(232,229,224,0.14)';
          ctx.setLineDash(major ? [] : [4, 4]);
          ctx.beginPath();
          for (let k = 0; k <= 120; k++) {
            const [sx, sy] = toScreen(k / 120, v, copyOx);
            if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(232,229,224,0.14)';
        ctx.setLineDash([4, 4]);
        for (let lon = -180; lon < 180; lon += stepDeg) {
          const u = 0.5 + lon / 360;
          const [probeX] = toScreen(u, 0.5, copyOx);
          if (probeX < -40 || probeX > cw + 40) continue;
          ctx.beginPath();
          for (let k = 0; k <= 60; k++) {
            const [sx, sy] = toScreen(u, k / 60, copyOx);
            if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // ---- realm boundaries ---------------------------------------------------
    // Under the roads and everything else human: a frontier is a fact about the
    // ground, and a road crosses it rather than the other way round.
    // (This used to say "lines only, no political wash". It has drawn the wash
    // since the frontier tool arrived — a hue with no name and no fill told the
    // reader that ground was claimed and never by whom — and a comment denying
    // the layer under it is worse than none.)
    if (showBorders && geography && geography.realms.length) {
      // The wash first, then the ink: a frontier is drawn ON the country, and
      // the border must not be washed over by the colour it belongs to.
      // REPROJECTED, into the same sheet the ground is drawn on — see
      // `projectedRealmTint` for what the flat blit did to every projection but
      // equirect, and why the border lines never showed it.
      const tint = projectedRealmTint(world, geography, projection);
      if (tint) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.imageSmoothingEnabled = true;
        for (let ox = firstOx; ox <= lastOx; ox += mapW) {
          ctx.drawImage(tint, ox, view.oy, mapW, mapH);
          if (!wraps) break;
        }
        ctx.restore();
      }
      const segs = realmBorders(world, geography);
      const pxPerCell = (PW * scale) / W;
      for (const copyOx of copies) {
        drawRealmBorders(ctx, segs, {
          worldWidth: W,
          worldHeight: H,
          toScreen: (u, v) => toScreen(u, v, copyOx),
          width: cw,
          height: ch,
          pxPerCell,
          // THIS copy's window, in its own CELL coordinates — see `cellWindow`,
          // which is where the projected-sheet rows this used to hand over (and
          // the frontier that therefore vanished in azimuthal) are converted.
          // One shared window meant the fitted view projected every segment
          // three times over, so it stays per copy.
          view: cellWindow(
            spec,
            { copyOx, oy: view.oy, mapW, mapH, cw, ch },
            W,
            H,
          ),
          // The projection is affine here, so the endpoints need no closure and
          // no tuple per point. Only equirect: every other projection curves.
          linear: projection === 'equirect'
            ? { ox: copyOx, oy: view.oy, scale: pxPerCell }
            : undefined,
          alpha: 0.72,
        });
      }

      // ---- and whose they are -----------------------------------------------
      // Borders were drawn and no realm was ever named, so the political layer
      // was a set of coloured lines around nothing: the reader could see that
      // the world was divided and not into what. The anchor is cached on
      // `realmOf` (see `realmAnchors`), so a pan costs one projection and one
      // measurement per realm.
      const anchors = realmAnchors(W, H, geography);
      for (let r = 0; r < geography.realms.length; r++) {
        const anchor = anchors[r];
        const realm = geography.realms[r];
        if (!anchor || !realm?.name) continue;
        // How wide the country is on screen, as the side of a square of the
        // same area. Under ~120 px the name comes out wider than the thing it
        // names, which is the classic way a generated map lies about its own
        // political geography.
        const across = Math.sqrt(anchor.cells) * pxPerCell;
        if (across < 120) continue;
        const size = Math.max(10, Math.min(18, 9 + across / 90));
        // Letter-spaced caps, the way an atlas letters a country — with REAL
        // spaces, because `measureText` is what reserves the box the
        // declutterer reasons about and canvas letter-spacing is not in it.
        const text = [...realm.name.toUpperCase()].join(' ');
        ctx.font = `600 ${size}px "Source Sans 3", sans-serif`;
        const half = ctx.measureText(text).width / 2;
        for (const copyOx of copies) {
          const [sx, sy] = toScreen((anchor.x + 0.5) / W, (anchor.y + 0.5) / H, copyOx);
          if (sx < -160 || sx > cw + 160 || sy < -30 || sy > ch + 30) continue;
          queueLabel(
            // Centred: `queueLabel` places from the LEFT edge, and a country
            // name hung off its own centroid drifts into the neighbour.
            text, sx - half, sy,
            `hsl(${realm.hue} 55% 78%)`, size, 600,
            // Above the towns, which top out at 100: with the political layer
            // switched on, the country is the thing the reader switched it on
            // to see. Below the seas, which only letter where they have room.
            110,
          );
        }
      }
    }

    // ---- the roads ----------------------------------------------------------
    // Over the ground, under everything that is a mark rather than a place: a
    // road runs THROUGH the country and the towns sit ON it, so a dot must
    // never end up hidden under a calzada.
    //
    // Roads are an authoritative screen-space layer at every zoom. Deep terrain
    // tiles deliberately do not bake them, so loading state cannot hide them.
    if (showRoads && geography && geography.roads.length) {
      const alpha = layerPlan.roadAlpha;
      if (alpha > 0.01) {
        const pxPerCell = (PW * scale) / W;
        // Once per road array, ever — see `roadBoxes`. This is the un-wrap that
        // used to run per copy, per frame, in front of the cull that needed it.
        const boxes = roadBoxes(geography.roads, W);
        // The same 24-pixel skirt `roadScreenPath` culls with, expressed in
        // cells, plus one: the two tests have to agree, and this one has to be
        // the more generous of them or it would reject roads the layer would
        // have drawn.
        const pad = 24 / pxPerCell + 1;
        for (const copyOx of copies) {
          const win = cellWindow(spec, { copyOx, oy: view.oy, mapW, mapH, cw, ch }, W, H);
          const x0 = win.x - pad, x1 = win.x + win.w + pad;
          const y0 = win.y - pad, y1 = win.y + win.h + pad;
          /**
           * THIS copy's roads, chosen in cell space before anything is built.
           *
           * Testing the road's own un-wrapped coordinates against this copy's
           * own window is exactly right and needs no modulo. A copy draws cell
           * x at `ox + x·pxPerCell`, and consecutive copies' windows are one
           * world apart in exactly the same coordinates — so a road that
           * `unwrapRoad` carried past the antimeridian (x ≥ W, or x < 0) falls
           * inside the window of the neighbouring copy, which is the copy that
           * puts it on screen. Every visible road is accepted by exactly the
           * copy that draws it; fuzzed against the screen-space test the layer
           * already does, over both cylindrical projections and five zooms,
           * nothing that used to be drawn is rejected here.
           */
          const here: Road[] = [];
          for (let i = 0; i < geography.roads.length; i++) {
            if (boxes[i * 4 + 2] < x0 || boxes[i * 4] > x1) continue;
            if (boxes[i * 4 + 3] < y0 || boxes[i * 4 + 1] > y1) continue;
            here.push(geography.roads[i]);
          }
          if (!here.length) continue;
          drawRoadNetwork(ctx, here, {
            worldWidth: W,
            worldHeight: H,
            toScreen: (u, v) => toScreen(u, v, copyOx),
            width: cw,
            height: ch,
            pxPerCell,
            alpha,
            // La misma vía afín que la capa de fronteras, con la misma
            // condición: sólo equirect es afín; todo lo demás curva.
            linear: projection === 'equirect'
              ? { ox: copyOx, oy: view.oy, scale: pxPerCell }
              : undefined,
          });
        }
      }
    }

    const cityLayerPxPerCell = (PW * scale) / W;
    const cityLayerMetresPerWorldCell = kmPerWorldCell(world) * 1000;
    const streetScaleVisible = geography && pyramidHere
      && cityLayerMetresPerWorldCell / cityLayerPxPerCell <= PLAN_MAX_METRES_PER_PX;
    if (streetScaleVisible) {
      // At street-plan scale the physical river masks every ordinary road and
      // urban stroke, including while exact terrain is still arriving. The
      // dedicated pass below restores real decks/piers once the city itself is
      // resident; loading may omit a bridge briefly, never invent a causeway.
      blitRivers();
    }

    const cityLayerVisible = streetScaleVisible && tilePlanDebug
      && tilePlanDebug.needed > 0 && tilePlanDebug.exact === tilePlanDebug.needed;

    // Bridges and piers are the only urban objects that belong above water.
    // The deep tile owns the town body, while the authoritative world river
    // and road overlays are composited later; restore only these structures
    // once the exact ground is resident, never the whole town over the river.
    if (cityLayerVisible && geography) {
      const pxPerCell = cityLayerPxPerCell;
      const metresPerWorldCell = cityLayerMetresPerWorldCell;
      for (const copyOx of copies) {
        drawTownWaterfrontStructures(world, geography, ctx, {
          originWorldX: -copyOx / pxPerCell,
          originWorldY: -view.oy / pxPerCell,
          widthPx: cw,
          heightPx: ch,
          metresPerPx: metresPerWorldCell / pxPerCell,
          metresPerWorldCell,
        });
      }
    }

    // Landmarks
    if (showLandmarks) {
      for (const copyOx of copies) {
        for (const lm of landmarks) {
          if (!semantic.showMinorLandmarks && lm.importance < 0.26) continue;
          const [sx, sy] = toScreen((lm.x + 0.5) / W, (lm.y + 0.5) / H, copyOx);
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
          hits.push({
            kind: 'entity', x: sx, y: sy, entity: lm,
            reach: 9 * Math.max(0.75, lm.style.size ?? 1), bias: 0.9,
            // Ya viene movido — `resolveWorldLandmarks` aplica `moves` — así
            // que aquí sólo hace falta la llave para escribir el siguiente.
            mover: { target: 'landmark', key: lm.key, label: lm.name },
          });
          drawLandmark(ctx, lm, sx, sy, lm.key === selectedSpatialKey);
          if ((lm.style.labelVisible ?? false)
              || lm.key === selectedSpatialKey
              || semantic.tier === 'local') {
            queueLabel(
              lm.name,
              sx + 8,
              sy,
              lm.style.color ?? '#f6efe0',
              10,
              600,
              65 + lm.importance * 20,
            );
          }
        }
      }
    }

    /**
     * The regional sheet's own places — and NOT once the tiles have their own.
     *
     * The composite RASTER above already stands down for `tilesEligible`; its
     * places did not, and drew straight through every level the deep tiles
     * letter. Two failures, one on each side of the hand-over:
     *
     *   Below ~100 km both lists come from the same canon, so every hamlet got
     *   two marks, two identical names into the declutterer (where they fight
     *   each other for a box neither can win) and two `hits` entries with
     *   different biases — so which of the two a click landed on depended on
     *   the order the arrays happened to be in.
     *
     *   Between ~100 and ~700 km they do not even agree: the regional layer is
     *   the freeform sheet and the tiles are the canon, so the reader sees two
     *   different sets of places, with different names, over the same ground.
     *   The canon exists to abolish exactly that disagreement.
     *
     * So the Carta's rule, `settlements: wantMarks && !deep`, applied here —
     * to the INHABITED half only. Volcanoes, caves, waterfalls, gorges and hot
     * springs are the landmark layer; the tiles do not re-emit those, and
     * dropping them would take named geography off the map for nothing.
     */
    if (regionalEntities.length && semantic.showRegionalTerrain) {
      ctx.font = '600 10px "Source Sans 3", sans-serif';
      for (const copyOx of copies) {
        for (const entity of regionalEntities) {
          if (entity.hidden) continue;
          const natural = entity.type === 'volcano' || entity.type === 'cave'
            || entity.type === 'waterfall' || entity.type === 'gorge'
            || entity.type === 'hotspring' || entity.kind === 'landmark';
          if (natural ? !showLandmarks : (!showSettlements || deepMarks)) continue;
          const [sx, sy] = toScreen(
            ((entity.x / W) % 1 + 1) % 1,
            Math.min(1, Math.max(0, entity.y / H)),
            copyOx,
          );
          if (sx < -30 || sx > cw + 30 || sy < -20 || sy > ch + 20) continue;
          hits.push({
            kind: 'entity', x: sx, y: sy, entity,
            reach: 9 * Math.max(0.75, entity.style.size ?? 1), bias: 0.85,
            // Resuelto contra `data.painted` en el padre, igual que los hitos.
            mover: { target: entity.kind, key: entity.key, label: entity.name },
          });
          drawRegionalEntity(ctx, entity, sx, sy, entity.key === selectedSpatialKey);
          if (semantic.tier === 'local' || entity.importance > 0.55
              || entity.style.labelVisible || entity.key === selectedSpatialKey) {
            queueLabel(
              entity.name,
              sx + 7,
              sy,
              entity.style.color ?? '#f6efe0',
              10,
              600,
              30 + entity.importance * 30,
            );
          }
        }
      }
    }

    // ---- ruins --------------------------------------------------------------
    // Before the towns, so a living place always wins the space fight: a ruin
    // crowding out a city is the wrong way round. Below the regional tier they
    // are clutter rather than information, which is the Carta's rule too.
    if (showFeatures && geography && geography.ruins.length
      && (semantic.tier === 'regional' || semantic.tier === 'local')) {
      ctx.save();
      ctx.globalAlpha = 0.82;
      for (const copyOx of copies) {
        for (const ru of geography.ruins) {
          // `ru` llega ya mudada por la geografía; la llave del dibujo la
          // redirige `applyEdits` al origen si el lector vuelve a arrastrar.
          const ruKey = editKey('ruin', ru.x, ru.y);
          const [sx, sy] = toScreen((ru.x + 0.5) / W, (ru.y + 0.5) / H, copyOx);
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
          const r = ru.kind === 'city' ? 4.2 : ru.kind === 'fort' ? 3.8 : 3.2;
          // A broken square: the universal "this was a building and is not any
          // more", and legible at four pixels where a drawn ruin symbol is mud.
          ctx.strokeStyle = 'rgba(226,214,190,0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx - r, sy + r); ctx.lineTo(sx - r, sy - r); ctx.lineTo(sx, sy - r);
          ctx.moveTo(sx + r, sy - r * 0.2); ctx.lineTo(sx + r, sy + r); ctx.lineTo(sx + r * 0.1, sy + r);
          ctx.stroke();
          hits.push({
            kind: 'note', x: sx, y: sy, reach: r + 7, bias: 1.2,
            note: `${ru.name} · ${t('worldgen.atlas.kind.ruin')}`,
            mover: { target: 'ruin', key: ruKey, label: ru.name },
          });
          if (semantic.tier === 'local') {
            queueLabel(ru.name, sx + r + 4, sy, '#ddd2ba', 9.5, 500, 20 + ru.importance * 20);
          }
        }
      }
      ctx.restore();
    }

    // ---- named geography ----------------------------------------------------
    // The seas, ranges, plains and capes the generator named. No mark, only
    // type: a named sea IS its extent, and a dot in the middle of it would be a
    // lie about where it is. Sized by importance, gated on the feature actually
    // being big enough on screen to carry its own name — the classic way a
    // generated map betrays itself is a continent label wider than its continent.
    if (showFeatures && geography && geography.features.length) {
      for (const copyOx of copies) {
        for (const f of geography.features) {
          if (f.kind === 'peak') continue;
          /**
           * Rivers ARE named here now.
           *
           * The river is the most-used label on a working map and the generator
           * has named them since it existed; this block skipped them because a
           * river wants its name set along its course, and that machinery lives
           * in `cartography/overlay` — where it can afford a settled sheet and a
           * path solve. A straight label at the anchor is not that drawing. It
           * is the NAME, which nothing in this view showed at all: the reader
           * could see the blue line and had to open the carta to learn what it
           * was called.
           *
           * Only from the regional tier down. `x, y` is one point 55 % along the
           * course, so at planetary zoom the name of every watercourse in the
           * world would pile up on the coasts and fight the seas for the space.
           */
          const river = f.kind === 'river';
          if (river && semantic.tier !== 'regional' && semantic.tier !== 'local') continue;
          // The size gate is about AREA and a river has none — its `extent` is
          // the length of its course, which would let a creek through and stop
          // nothing.
          if (!river && f.extent * ((PW * scale) / W) < 46) continue;
          // Un accidente NO es un punto: lo que se mueve es dónde va su NOMBRE.
          // El mar sigue donde estaba; el rótulo se aparta de la costa que
          // tapaba. Es el mismo `move` — la posición del accidente es su ancla
          // de rótulo y nada más (ver `NamedFeature.x`).
          // `f` llega ya mudado por la geografía (el ancla del rótulo es lo
          // que se muda); `applyEdits` redirige la llave si se arrastra otra vez.
          const fKey = editKey('feature', f.x, f.y, `${f.kind}:`);
          const [sx, sy] = toScreen((f.x + 0.5) / W, (f.y + 0.5) / H, copyOx);
          if (sx < -80 || sx > cw + 80 || sy < -30 || sy > ch + 30) continue;
          const water = river || f.kind === 'sea' || f.kind === 'bay' || f.kind === 'strait'
            || f.kind === 'ocean' || f.kind === 'lake' || f.kind === 'marsh';
          // Reach follows the FEATURE, not the type: a sea answers over the sea.
          hits.push({
            kind: 'note', x: sx, y: sy, bias: 1.6,
            // Except a river, whose anchor is a point ON a line: sized from its
            // course length it would answer the hover over a disc a hundred
            // kilometres wide and shadow the ground on both banks.
            reach: river ? 16 : Math.max(14, Math.min(140, f.extent * ((PW * scale) / W) * 0.45)),
            // A generated river is named "Río X" — the kind is already in the
            // name, so appending it reads as a stutter.
            note: river ? f.name : `${f.name} · ${kindLabel(f.kind)}`,
            mover: { target: 'feature', key: fKey, label: f.name },
          });
          queueLabel(
            f.name.toUpperCase(),
            sx, sy,
            water ? 'rgba(178,214,236,0.92)' : 'rgba(238,228,205,0.9)',
            river
              ? Math.max(9, Math.min(12, 8 + f.importance * 5))
              : Math.max(9, Math.min(17, 10 + f.importance * 7)),
            600,
            // Above the towns: at the zoom where a sea has room for its name,
            // the sea is what you are looking at. A river goes just over the
            // towns too (they top out at 100) and under the realms and the
            // seas, which name more ground than it does.
            river ? 96 + f.importance * 12 : 120 + f.importance * 30,
          );
        }
      }
    }

    // ---- the names the reader typed -----------------------------------------
    // `painted.labels` had exactly one consumer in the whole tree — the Carta.
    // The Rótulo tool is only usable in THIS view and in the 3D, so every label
    // anyone has ever placed was invisible at the moment of placing it.
    if (world.painted?.labels?.length) {
      for (const copyOx of copies) {
        for (const pl of world.painted.labels) {
          // Identidad para el arrastre: la llave es la posición de ORIGEN
          // (`label:x,y`, como todo lo demás) y el dibujo sigue a la mudanza.
          // Sin `mover`, el rótulo era lo único del mapa que respondía al
          // puntero pero no al gesto de mover.
          const plKey = editKey('label', pl.x, pl.y);
          const plAt = movedAt(plKey);
          const [sx, sy] = toScreen(
            ((plAt?.x ?? pl.x) + 0.5) / W, ((plAt?.y ?? pl.y) + 0.5) / H, copyOx,
          );
          if (sx < -100 || sx > cw + 100 || sy < -30 || sy > ch + 30) continue;
          hits.push({
            kind: 'note', x: sx, y: sy, reach: 22, bias: 0.9,
            note: `${pl.text} · ${t('worldgen.hover.yourLabel')}`,
            mover: { target: 'label', key: plKey, label: pl.text },
          });
          queueLabel(
            pl.style === 'region' || pl.style === 'range' ? pl.text.toUpperCase() : pl.text,
            sx, sy,
            pl.style === 'water' ? 'rgba(178,214,236,0.96)' : '#ffe9c2',
            Math.max(9, Math.min(22, pl.size ?? 12)),
            600,
            // Highest band there is: the reader wrote it, so it outranks
            // anything the generator came up with.
            400,
          );
        }
      }
    }

    // Towns are authoritative screen entities, drawn before waypoints so a pin
    // the reader placed is never hidden behind a generated dot. Canon tiles may
    // carry buildings and minor places, but loading or changing tile level must
    // never remove a principal city, its label, or its hit target.
    if (showSettlements && geography) {
      // Only as much of the gazetteer as the zoom can carry: every village at
      // full extent is a grey smear along every coast.
      const maxRank = semantic.settlementRank;
      const order: Record<string, number> = { capital: 0, city: 1, town: 2, village: 3 };
      ctx.font = '600 11px "Source Sans 3", sans-serif';
      ctx.textBaseline = 'middle';
      for (const copyOx of copies) {
        for (const s of geography.settlements) {
          const rank = order[s.rank] ?? 3;
          // The town a road is being laid FROM always draws, whatever the zoom
          // says about its rank: half a gesture with an invisible first end is
          // the reader wondering whether the click registered at all.
          const pending = roadFrom?.id === s.id;
          if (rank > maxRank && !pending) continue;
          // `s` llega ya mudado por la geografía; la llave del dibujo la
          // redirige `applyEdits` al origen si el lector vuelve a arrastrar.
          const sKey = editKey('settlement', s.x, s.y);
          const centre = settlementCellCenter(s);
          const [sx, sy] = toScreen(centre.x / W, centre.y / H, copyOx);
          if (sx < -40 || sx > cw + 40 || sy < -20 || sy > ch + 20) continue;
          const r = rank === 0 ? 5 : rank === 1 ? 4 : rank === 2 ? 3 : 2.2;
          // The reach is the DOT plus a finger's worth, not a flat 14 px over
          // every town in the world — see the note on `painted`.
          hits.push({
            kind: 'settlement', x: sx, y: sy, settlement: s,
            reach: r + 9, bias: [0.45, 0.65, 0.85, 1][rank] ?? 1,
            mover: { target: 'settlement', key: sKey, label: s.name },
          });
          if (pending) {
            ctx.beginPath();
            ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,214,120,0.95)';
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // From here down is the authoritative principal mark. `deepMarks`
          // remains in the branch so alternate layer contracts can opt into
          // tile-owned marks without changing hit testing.
          if (deepMarks && tileZ >= SAT_DEEP_Z + 2) continue;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = pending ? '#ffd479' : rank === 0 ? '#ffd479' : '#f4ead4';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(6,8,13,0.92)';
          ctx.stroke();
          if (!deepMarks && (rank === 0
              || (rank <= 1 && semantic.tier !== 'planetary')
              || (rank <= 2 && (semantic.tier === 'regional' || semantic.tier === 'local'))
              || semantic.tier === 'local')) {
            // El rótulo CRECE con el zoom (Luis, 2026-08-12: «que siga
            // apareciendo bien grande»): de lejos el tamaño de siempre; de
            // cerca hasta 19 px, que una capital a cuarenta kilómetros de
            // vano no puede anunciarse en letra de nota al pie.
            const boost = Math.max(0, Math.min(8, (Math.log2((PW * scale) / W) - 1) * 2));
            queueLabel(
              s.name,
              sx + r + 5,
              sy,
              '#f6efe0',
              Math.round((rank <= 1 ? 11 : 10) + boost),
              rank <= 1 ? 600 : 500,
              100 - rank * 15,
            );
          }
        }
      }
    }

    // Names the deep tiles found. Hamlets, farms, mills and named crags exist
    // only in the canon, so nothing above knows about them; they are lettered
    // live here, like every other label, because a name baked into a tile is
    // pinned to the wrong pixels the moment the view moves.
    // THE LAYER SWITCHES REACH DOWN HERE TOO.
    //
    // This block was gated on the pyramid alone, so "Poblaciones" and
    // "Accidentes" off left the deep tiles' names — and their hits — on the
    // map: the reader turns the towns off to look at bare ground and every
    // hamlet, farm and mill is still lettered across it. A switch that clears
    // the world raster's marks and not the canon's is a switch that stopped
    // working at exactly the zoom where there is most to clear.
    //
    // Split the way the two props are documented: `showFeatures` is named
    // geography and abandoned places, `showSettlements` is where people live
    // and work. Nothing here belongs to `showLandmarks` — the canon's own
    // landmarks come up as `landmark`/`crag` and read as geography.
    if (tilesEligible && tileZ >= SAT_DEEP_Z && (showSettlements || showFeatures)) {
      const prefix = `${tileZ}/`;
      // Deep tiles re-emit nearby towns for consumers that have no world
      // gazetteer. This view does have it, so keep those towns in the principal
      // layer and use tile places only for genuinely additional local detail.
      const principalNames = new Set(
        geography?.settlements.map((s) => s.name.trim().toLocaleLowerCase()) ?? [],
      );
      /**
       * LA ESCALERA DE IMPORTANCIA, o el mapa se ahoga en nombres.
       *
       * El canon emite TODO — cada casa, venta, vado, granja y majada — y este
       * bloque lo rotulaba todo en cuanto las teselas hondas entraban (z9):
       * a escala comarcal eso son cientos de rótulos de 9,5 px a la vez, y la
       * ciudad que buscas desaparece entre ellos. Es la captura de Luis del
       * 2026-08-11 («aparecen mil mierdas»). Un mapa real deja entrar los
       * nombres por tamaño según te acercas.
       *
       * El suelo por nivel sigue las importancias que `places.ts` asigna:
       * pueblo 0,6+ · aldea 0,34 · abadía 0,4 · caserío 0,2 · torre 0,24 ·
       * molino 0,14 · venta 0,15 · granja 0,1. El PUNTO entra un escalón antes
       * que el NOMBRE (el campo se ve habitado sin leerse), y el sobrevuelo
       * (`hits`) va con el punto, así que lo que se ve se puede preguntar.
       */
      const placeFloor = tileZ >= 14 ? 0 : tileZ >= 13 ? 0.09 : tileZ >= 12 ? 0.13
        : tileZ >= 11 ? 0.19 : 0.32;
      for (const [id, places] of deepPlaces.current) {
        if (!id.startsWith(prefix)) continue;
        for (const p of places) {
          if ((p.kind === 'town' || p.kind === 'village')
            && principalNames.has(p.name.trim().toLocaleLowerCase())) continue;
          const geographic = DEEP_FEATURE_KINDS.has(p.kind);
          if (geographic ? !showFeatures : !showSettlements) continue;
          if (p.importance < placeFloor) continue;
          const labeled = tileZ >= 14 || p.importance >= placeFloor * 1.7;
          for (const copyOx of copies) {
            const [sx, sy] = toScreen(p.worldX / W, p.worldY / H, copyOx);
            if (sx < -80 || sx > cw + 80 || sy < -30 || sy > ch + 30) continue;
            const big = p.kind === 'town' || p.kind === 'village';
            hits.push({ kind: 'place', x: sx, y: sy, place: p, reach: big ? 10 : 8, bias: 1.1 });
            ctx.beginPath();
            ctx.arc(sx, sy, big ? 3 : 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(20,18,14,0.75)';
            ctx.fill();
            if (labeled) {
              // La misma regla que el rótulo del mundo: crece con el zoom.
              const boost = Math.max(0, Math.min(8, (Math.log2((PW * scale) / W) - 1) * 2));
              queueLabel(
                p.name, sx + 5, sy, '#f2ecdd',
                Math.round((big ? 11 : 9.5) + (big ? boost : boost * 0.75)),
                big ? 600 : 500,
                40 + p.importance * 30,
              );
            }
          }
        }
      }
    }

    // ---- la ruta, el viaje y lo que nombra el manuscrito ---------------------
    /**
     * LAS MARCAS DEL LECTOR, aquí también, para que el Índice y el Viaje dejen
     * de expulsarle a la Carta.
     *
     * `drawAnnotations` pide el mapa como dos funciones separadas — `sx(wx)` y
     * `sy(wy)` — y eso sólo se puede cumplir en una proyección CILÍNDRICA, que
     * son exactamente las que envuelven: en equirect `forward` es la identidad
     * y en mercator la X depende sólo de la longitud. En las tres curvas
     * (acimutal, Mollweide, Winkel) la horizontal de un punto depende también
     * de su latitud, así que no hay ningún par de funciones de un argumento que
     * las describa y esta capa no se puede dibujar ahí sin reescribirla. No se
     * dibuja, y no se dibuja mal: el satélite, el pincel y la pirámide sólo
     * existen en equirect, que es donde el lector está cuando planea un viaje.
     *
     * SIN EL PALEO, y eso es deliberado: es un barrido de la retícula entera —
     * dos millones de celdas en un mundo de 2048 — y esta función corre en cada
     * fotograma de un desplazamiento, no sobre una lámina asentada como la
     * Carta. Es la misma trampa que costó 15 ms por fotograma a las fronteras.
     * El nivel del mar antiguo sigue teniendo su vista y su interruptor.
     */
    if (annotations && wraps) {
      const marks: CartoAnnotations = {
        pins: annotations.pins,
        route: annotations.route,
        linked: annotations.linked,
      };
      if (marks.pins?.length || marks.route || marks.linked?.length) {
        for (const copyOx of copies) {
          // Un límite conocido: el salto de la costura se compara dentro de
          // `drawAnnotations` contra `ctx.canvas.width`, que es el búfer y no
          // los píxeles CSS en los que medimos aquí. Con dpr 2 el umbral queda
          // al doble, así que una ruta que cruce el antimeridiano puede dibujar
          // el tramo de vuelta en vez de levantar el lápiz. Una ruta planeada
          // entre dos poblaciones casi nunca lo cruza; arreglarlo de verdad es
          // un parámetro más en esa función, que no es de esta vista.
          drawAnnotations(
            ctx, marks, world,
            (wx) => toScreen(wx / W, 0, copyOx)[0],
            (wy) => toScreen(0, wy / H, copyOx)[1],
            (PW * scale) / W,
          );
        }
        // `drawAnnotations` deja la línea base en 'middle' y la fuente puesta;
        // el resto del fotograma da por hecho lo primero (se fija una vez
        // arriba) y vuelve a poner lo segundo por capa.
        ctx.textBaseline = 'middle';
      }
    }

    // ---- las comarcas guardadas ---------------------------------------------
    /**
     * Una comarca guardada es un SITIO, no una entrada de lista.
     *
     * Se dibuja el trozo de mundo que abarca — anchura `spanKm`, altura la que
     * le da su propia relación de aspecto, la misma con la que se generó la
     * hoja — y su nombre encima. Con eso, tres comarcas guardadas dejan de ser
     * tres líneas iguales en un panel y pasan a ser tres recuadros que el
     * lector reconoce de un vistazo, y que se ve si se solapan.
     *
     * El marco se mide en la métrica de la LÁMINA (píxeles por celda), no
     * proyectando las cuatro esquinas: en equirect — que es donde vive el
     * satélite y donde se guardan las comarcas — las dos cosas son idénticas, y
     * en una proyección curva un recuadro de referencia con un pequeño error de
     * forma sigue diciendo dónde está la comarca, que es lo que se le pide.
     */
    if (savedRegions.length) {
      const ppcX = (PW * scale) / W;
      const ppcY = (PH * scale) / H;
      ctx.save();
      ctx.font = '600 10px "Source Sans 3", sans-serif';
      for (const copyOx of copies) {
        for (const rg of savedRegions) {
          const halfW = ((rg.spanKm / EARTH_KM) * W * ppcX) / 2;
          const halfH = halfW / Math.max(0.25, rg.params?.aspect || 1.55) * (ppcY / ppcX);
          const [rx, ry] = toScreen(
            ((rg.x / W) % 1 + 1) % 1,
            Math.min(1, Math.max(0, rg.y / H)),
            copyOx,
          );
          if (rx + halfW < -30 || rx - halfW > cw + 30
            || ry + halfH < -20 || ry - halfH > ch + 20) continue;
          const active = rg.id === activeRegionId;
          // Por debajo de seis píxeles el recuadro es un punto sucio: a escala
          // planetaria una comarca de 200 km es medio píxel, y lo que el lector
          // quiere ver ahí es DÓNDE la tiene guardada, no su forma exacta.
          const tiny = halfW < 3 || halfH < 3;
          ctx.setLineDash(active ? [] : [6, 4]);
          ctx.lineWidth = active ? 2 : 1.4;
          ctx.strokeStyle = active ? 'rgba(255,212,121,0.95)' : 'rgba(226,214,190,0.65)';
          if (tiny) {
            ctx.beginPath();
            ctx.moveTo(rx, ry - 5); ctx.lineTo(rx + 5, ry);
            ctx.lineTo(rx, ry + 5); ctx.lineTo(rx - 5, ry);
            ctx.closePath();
            ctx.stroke();
          } else {
            // Suelo guardado, no una caja perdida: lavado sutil del interior
            // y soportes de esquina sólidos — el lenguaje de un plano — sobre
            // el marco a trazos de siempre. La Carta hace la misma marca con
            // su propia tinta (`annotations.ts`), así que bajar del satélite
            // a la carta no cambia qué significa el recuadro.
            ctx.fillStyle = active ? 'rgba(255,212,121,0.07)' : 'rgba(226,214,190,0.045)';
            ctx.fillRect(rx - halfW, ry - halfH, halfW * 2, halfH * 2);
            ctx.strokeRect(rx - halfW, ry - halfH, halfW * 2, halfH * 2);
            ctx.setLineDash([]);
            const arm = Math.min(14, Math.min(halfW, halfH) * 0.34);
            ctx.lineWidth = active ? 2.6 : 2;
            ctx.beginPath();
            for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
              const px = rx + dx * halfW, py = ry + dy * halfH;
              ctx.moveTo(px + (dx < 0 ? arm : -arm), py);
              ctx.lineTo(px, py);
              ctx.lineTo(px, py + (dy < 0 ? arm : -arm));
            }
            ctx.stroke();
          }
          ctx.setLineDash([]);
          // El nombre va en el borde superior del marco, no en el centro: el
          // centro de una comarca es justo donde está lo que se ha ido a mirar.
          const labelY = tiny ? ry - 11 : ry - halfH - 7;
          hits.push({
            kind: 'note', x: rx, y: Math.max(6, labelY), reach: tiny ? 12 : 16, bias: 1.4,
            note: `${rg.title} · ${t('worldgen.map.savedRegion')}`,
            regionId: rg.id,
          });
          queueLabel(
            rg.title, rx + 8, Math.max(6, labelY),
            active ? '#ffd479' : 'rgba(236,226,206,0.9)', 10, 600,
            // Justo por debajo de los rótulos que el lector ha escrito a mano:
            // es suyo también, pero es un marco de trabajo, no parte del mapa.
            360,
          );
        }
      }
      ctx.restore();
    }

    // Waypoints
    if (showWaypoints) {
      ctx.font = '600 11px "Source Sans 3", sans-serif';
      for (const copyOx of copies) {
        for (const wp of waypoints) {
          const [sx, sy] = toScreen(wp.u, wp.v, copyOx);
          if (sx < -60 || sx > cw + 60 || sy < -30 || sy > ch + 30) continue;
          const selected = wp.id === selectedWaypointId;
          // A pin the reader put down outranks everything the generator placed.
          hits.push({ kind: 'waypoint', x: sx, y: sy, waypointId: wp.id, reach: 11, bias: 0.35 });
          ctx.beginPath();
          ctx.arc(sx, sy, selected ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = wp.color;
          ctx.fill();
          ctx.lineWidth = selected ? 2 : 1.25;
          ctx.strokeStyle = selected ? '#e8e5e0' : 'rgba(7,7,13,0.85)';
          ctx.stroke();
          // Through the declutterer like every other name. Drawn directly, pin
          // labels overlapped each other and everything else, and were not
          // counted against the label budget — so a cluster of pins was a pile
          // of unreadable pills on top of the map's own type.
          queueLabel(
            wp.name, sx + (selected ? 9 : 8), sy,
            selected ? '#e4a853' : '#e8e5e0', 11, 600,
            // Highest band: the reader put this here on purpose.
            500,
          );
        }
      }
    }

    for (const candidate of declutterLabels(mapLabels, semantic.labelBudget, 3)) {
      const item = candidate.value;
      ctx.font = `${item.weight} ${item.size}px "Source Sans 3", sans-serif`;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,8,13,0.88)';
      ctx.strokeText(item.text, candidate.x, candidate.y);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, candidate.x, candidate.y);
    }

    // The stroke IN FLIGHT, before the ring. Nothing painted until release was
    // the single most-hated thing about these brushes: the committed result
    // costs half a second of derivation, but showing WHERE the paint will land
    // costs one translucent polyline. Round caps and joins make a stroked path
    // exactly the coverage of a round head; other heads read close enough for
    // a preview, and the cursor outline already tells the truth about the rim.
    {
      const pts0 = stroke.current;
      const bt0 = brushRef.current.tool;
      const anchor = brushAt.current;
      // When the ground itself is deforming live (satellite sculpt), the tint
      // trail would just smear over real terrain — the cursor ring suffices.
      if (pts0 && pts0.length > 0 && bt0 && anchor && !liveSculpt.current) {
        const pxPerCell = (PW * scale) / W;
        const tint = bt0.mode === 'biome'
          ? `rgba(${(BIOME_COLORS[bt0.biome] ?? [120, 160, 90]).join(',')},0.5)`
          : bt0.mode === 'places'
            // Ámbar de asentamiento: la zona que la pincelada abre (o vacía,
            // con Ctrl) para el sembrado de lugares.
            ? (negRef.current ? 'rgba(120,72,52,0.4)' : 'rgba(214,168,90,0.4)')
            : bt0.mode === 'river'
            ? 'rgba(64,124,196,0.55)'
            : bt0.mode === 'land'
              ? (bt0.landOp === 'sea' ? 'rgba(38,74,128,0.45)' : 'rgba(196,176,128,0.5)')
              : bt0.mode === 'terrain'
                ? (bt0.terrainOp === 'lower' ? 'rgba(30,34,44,0.4)' : 'rgba(255,255,255,0.35)')
                // The frontier BRUSH only. The bucket and the two lassos are
                // not strokes: a trail of colour under a click that floods, or
                // under a click that only drops a corner, tells the reader the
                // drag painted something when nothing was painted at all.
                : bt0.mode === 'frontera' && bt0.realmTool === 'brush'
                  ? realmColor(geography, negRef.current ? -1 : bt0.realm, 0.5)
                  : null;
        if (tint) {
          // Screen position through the RING'S anchor, so the preview stays on
          // the copy of the world the pointer is actually over when the map
          // wraps — the same trick the cursor outline uses. Sin corrección de
          // media celda: `stampDisc` mide centros de celda desde la pasada 8
          // (ver la nota B6), así que la máscara cae donde el puntero dice.
          const px = (p: Pt) => {
            let dx = p.x - anchor.cx;
            while (dx > W / 2) dx -= W;
            while (dx < -W / 2) dx += W;
            return anchor.x + dx * pxPerCell;
          };
          const py = (p: Pt) => anchor.y + (p.y - anchor.cy) * pxPerCell;
          const wCells = bt0.mode === 'river' ? Math.max(0.8, bt0.riverWidth) : bt0.radius * 2;
          ctx.save();
          ctx.beginPath();
          for (let k = 0; k < pts0.length; k++) {
            if (k === 0) ctx.moveTo(px(pts0[k]), py(pts0[k])); else ctx.lineTo(px(pts0[k]), py(pts0[k]));
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, wCells * pxPerCell);
          ctx.strokeStyle = tint;
          ctx.stroke();
          if (pts0.length === 1) {
            // A press with no movement yet: a dot, not an invisible zero-length line.
            ctx.beginPath();
            ctx.fillStyle = tint;
            ctx.arc(px(pts0[0]), py(pts0[0]), Math.max(1.5, (wCells / 2) * pxPerCell), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    // ---- the frontier being drawn by hand ------------------------------------
    // A shape that exists only as an edit the moment it closes is a shape drawn
    // blind: the reader has to hold five clicks' worth of outline in their head
    // and finds out where it really landed after the world has already changed
    // under it. Corners as handles, edges as a line, the CLOSING edge included
    // — the ring is what `polygonCells` fills, so hiding it would understate the
    // claim by one whole side — and, for the curved lasso, the ROUNDED ring
    // rather than the polygon, because the rounded ring is the ground that
    // changes hands.
    {
      const open = realmPoly.current;
      const bt1 = brushRef.current.tool;
      if (open && open.pts.length && bt1 && bt1.mode === 'frontera') {
        const pxPerCell = (PW * scale) / W;
        const own = open.neg ? -1 : bt1.realm;
        const ink = realmColor(geography, own, 0.95);
        const wash = realmColor(geography, own, 0.22);
        // Un-wrapped exactly the way `polygonCells` un-wraps it, so a province
        // drawn across the antimeridian previews as one shape instead of two
        // touching the opposite edges — and so the corner cutting below sees a
        // continuous ring rather than a jump of one whole world width.
        const ring: Pt[] = [];
        let prevX = open.pts[0].x;
        for (const p of open.pts) {
          let x = p.x;
          while (x - prevX > W / 2) x -= W;
          while (x - prevX < -W / 2) x += W;
          prevX = x;
          ring.push({ x, y: p.y });
        }
        const shape = bt1.realmTool === 'curve' && ring.length >= 3
          ? chaikinPreview(ring) : ring;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of shape) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const ox0 = ring[0].x, oy0 = ring[0].y;
        for (const copyOx of copies) {
          const [ax, ay] = toScreen(
            ((ox0 / W) % 1 + 1) % 1,
            Math.min(1, Math.max(0, oy0 / H)),
            copyOx,
          );
          // A copy the shape cannot reach costs nothing to skip and a full
          // stroked path plus a handle per corner to draw.
          if (ax + (maxX - ox0) * pxPerCell < -40 || ax + (minX - ox0) * pxPerCell > cw + 40
            || ay + (maxY - oy0) * pxPerCell < -40 || ay + (minY - oy0) * pxPerCell > ch + 40) {
            continue;
          }
          const px = (p: Pt) => ax + (p.x - ox0) * pxPerCell;
          const py = (p: Pt) => ay + (p.y - oy0) * pxPerCell;
          ctx.save();
          ctx.beginPath();
          for (let k = 0; k < shape.length; k++) {
            if (k === 0) ctx.moveTo(px(shape[k]), py(shape[k]));
            else ctx.lineTo(px(shape[k]), py(shape[k]));
          }
          if (shape.length >= 3) {
            ctx.closePath();
            ctx.fillStyle = wash;
            ctx.fill();
          }
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(8,10,16,0.7)';
          ctx.stroke();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = ink;
          ctx.stroke();
          // The handles are the CORNERS the reader put down, never the smoothed
          // samples: a handle on a Chaikin point is a handle on something nobody
          // clicked and nothing can take back.
          for (let k = 0; k < ring.length; k++) {
            const hx = px(ring[k]), hy = py(ring[k]);
            const first = k === 0;
            ctx.beginPath();
            ctx.arc(hx, hy, first ? 5.2 : 3.2, 0, Math.PI * 2);
            ctx.fillStyle = first ? ink : 'rgba(10,12,18,0.85)';
            ctx.fill();
            ctx.lineWidth = first ? 2 : 1.4;
            ctx.strokeStyle = first ? 'rgba(8,10,16,0.85)' : ink;
            ctx.stroke();
            // Through the registry like every other pointer question in this
            // view — see the note on `painted`. Only once the ring is a shape:
            // offering "close here" over two corners would answer a click with
            // an edit `polygonCells` fills with nothing.
            if (first && ring.length >= 3) {
              hits.push({ kind: 'realmVertex', x: hx, y: hy, reach: 11, bias: 0.3 });
            }
          }
          ctx.restore();
        }
        // The rubber band, ONCE and only in the copy the pointer is in: drawn
        // per copy it would run to the same screen point from every one of them,
        // which is a line to a cursor that is not there.
        const at1 = brushAt.current;
        if (at1) {
          const tail = ring[ring.length - 1];
          let dx = tail.x - at1.cx;
          while (dx > W / 2) dx -= W;
          while (dx < -W / 2) dx += W;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(at1.x + dx * pxPerCell, at1.y + (tail.y - at1.cy) * pxPerCell);
          ctx.lineTo(at1.x, at1.y);
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = ink;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // The frame is complete: what it drew is now what the pointer answers to.
    // LAST, after the frontier handles: the lasso's first corner is drawn over
    // the labels and is the only thing in this frame that a click can close.
    painted.current = hits;

    // ---- scale bar ----------------------------------------------------------
    // The 2D had no scale of any kind: nothing on screen said whether you were
    // looking at five hundred kilometres of ground or five. The Carta has had a
    // scale bar since it existed. A round number of ground units, drawn to the
    // width they actually occupy.
    {
      const kmPerPx = spanKm / cw;
      const want = kmPerPx * 150;                       // aim for ~150 px
      const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, want))));
      const nice = [1, 2, 5, 10].find((f) => f * pow >= want) ?? 10;
      const barKm = nice * pow;
      const barPx = barKm / kmPerPx;
      const label = barKm >= 1
        ? t('worldgen.paint.units.km')
          .replace('{n}', String(barKm >= 1000 ? Math.round(barKm) : barKm))
        : t('worldgen.paint.units.m').replace('{n}', String(Math.round(barKm * 1000)));
      const bx = 12, by = ch - 34;
      ctx.save();
      ctx.font = '600 10px "Source Sans 3", sans-serif';
      ctx.textBaseline = 'alphabetic';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(7,7,13,0.55)';
      ctx.beginPath();
      ctx.roundRect(bx - 5, by - 13, Math.max(barPx, tw) + 12, 24, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,236,228,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 2); ctx.lineTo(bx + barPx, by + 2);
      ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = '#f0ece4';
      ctx.fillText(label, bx, by - 6);
      ctx.restore();
      ctx.textBaseline = 'middle';
    }

    // ---- el localizador ------------------------------------------------------
    /**
     * DÓNDE ESTÁ ESTO, en el mundo entero.
     *
     * Un recuadro de ciento y pico píxeles con la lámina del planeta y el marco
     * de lo que se está mirando. Cuesta un `drawImage` de una imagen que ya está
     * construida (`baseCanvas`, la misma que dibuja el fondo) y dos trazos: al
     * lado de la pirámide de teselas, nada.
     *
     * Sólo cuando hay algo que localizar. Con el mundo entero en pantalla el
     * recuadro repetiría el mapa a escala de sello y taparía una esquina de él
     * para no decir nada; por debajo de la mitad de la anchura del mundo — un
     * continente — es cuando el lector deja de saber dónde está.
     *
     * Nunca en una exportación: es un mando de la vista, como el chivato de las
     * teselas, no parte del mapa.
     */
    {
      const X0 = -view.ox / mapW, Y0 = -view.oy / mapH;
      const fw = Math.min(1, cw / mapW), fh = Math.min(1, ch / mapH);
      if (!exportScale.current && fw < 0.5) {
        const iw = Math.max(76, Math.min(148, cw * 0.2));
        const ih = iw * (PH / PW);
        const ix = cw - iw - 10, iy = 10;
        ctx.save();
        ctx.fillStyle = 'rgba(7,7,13,0.72)';
        ctx.beginPath();
        ctx.roundRect(ix - 3, iy - 3, iw + 6, ih + 6, 4);
        ctx.fill();
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(baseCanvas, ix, iy, iw, ih);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(240,236,228,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ix - 0.5, iy - 0.5, iw + 1, ih + 1);
        // La ventana. En una proyección que envuelve, la fracción puede caer
        // fuera de [0,1) y asomar por el otro lado del sello: se dibujan las dos
        // mitades, que es lo que el lector ve en el mapa grande.
        const rx = wraps ? ((X0 % 1) + 1) % 1 : Math.max(0, Math.min(1 - fw, X0));
        const ry = Math.max(0, Math.min(1 - fh, Y0));
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 1.6;
        const box = (fx: number, fwPart: number) => {
          // Con un mínimo visible: a 400 m de vano la ventana es una millonésima
          // del planeta, y un rectángulo de cero píxeles no marca nada.
          const w = Math.max(3, fwPart * iw), h = Math.max(3, fh * ih);
          ctx.strokeRect(ix + fx * iw, iy + ry * ih, Math.min(w, iw), Math.min(h, ih));
        };
        box(rx, fw);
        if (wraps && rx + fw > 1) box(rx - 1, fw);
        ctx.restore();
      }
    }

    // ---- lo que va en la mano ------------------------------------------------
    /**
     * Un objeto cogido tiene que VERSE cogido.
     *
     * Tres cosas, y las tres hacen falta: el sitio del que sale (un aro fino,
     * para poder volver), la línea que lo une a la mano (o el lector no sabe
     * QUÉ está arrastrando cuando hay tres pueblos juntos) y el nombre en el
     * destino, que es la promesa de lo que va a pasar al soltar. El original se
     * sigue dibujando en su sitio a propósito: hasta que no se suelta, no se ha
     * movido nada.
     */
    {
      const held = moveRef.current;
      if (held?.live) {
        const tx = held.fromX + (held.x - held.pressX);
        const ty = held.fromY + (held.y - held.pressY);
        ctx.save();
        ctx.beginPath();
        ctx.arc(held.fromX, held.fromY, 7, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(240,236,228,0.45)';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(held.fromX, held.fromY);
        ctx.lineTo(tx, ty);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(255,214,120,0.85)';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(tx, ty, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,214,120,0.22)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd479';
        ctx.stroke();
        const name = held.hit.mover?.label
          ?? waypoints.find((wp) => wp.id === held.hit.waypointId)?.name
          ?? '';
        if (name) {
          ctx.font = '600 11px "Source Sans 3", sans-serif';
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(6,8,13,0.88)';
          ctx.strokeText(name, tx + 11, ty);
          ctx.fillStyle = '#ffe9c2';
          ctx.fillText(name, tx + 11, ty);
        }
        ctx.restore();
      }
    }

    // The brush ring, last, over everything. Two circles: where the stroke
    // stops, and where it stops being at full strength — softness is otherwise a
    // number you set and then discover the effect of.
    const at = brushAt.current;
    const bt = brushRef.current.tool;
    // ...except for the frontier bucket and the two lassos, which have no head
    // at all: the ring would draw a radius that changes nothing, at full brush
    // size, straight over the rubber band the shape is actually being aimed
    // with — the one line on screen that does say where the next click lands.
    const headed = !(bt && bt.mode === 'frontera' && bt.realmTool !== 'brush');
    if (at && bt && brushRef.current.brushing && headed) {
      const pxPerCell = (PW * scale) / W;
      const tip = tipOf(bt as unknown as Stroke);
      // The ring is the shape of the HEAD. `tipOutline` solves the rim in the
      // same metric the brush culls with, so the outline and the paint are one
      // figure — a circle drawn over a square brush is just a wrong answer.
      const ring = (rCells: number) => {
        const pts2 = tipOutline(tip, Math.max(0.6, rCells), at.cx, at.cy, 96);
        ctx.beginPath();
        for (let k = 0; k < pts2.length; k++) {
          // Directo, sin media celda: la máscara mide centros de celda desde
          // la pasada 8 (nota B6), así que el suelo entintado queda centrado
          // en el puntero y el anillo puede decir la verdad sin corregirse.
          const px = at.x + (pts2[k].x - at.cx) * pxPerCell;
          const py = at.y + (pts2[k].y - at.cy) * pxPerCell;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      };
      const rOuter = Math.max(3, bt.radius * pxPerCell);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(10,12,18,0.75)';
      ring(bt.radius);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ring(bt.radius);
      const soft = 1 - Math.min(0.98, bt.softness);
      if (rOuter * soft > 2) {
        ctx.strokeStyle = 'rgba(255,220,140,0.75)';
        ctx.setLineDash([3, 3]);
        ring(bt.radius * soft);
        ctx.setLineDash([]);
      }
    }

    // ---- HUD DE DEPURACIÓN (temporal, Luis 2026-08-12) ----------------------
    // «Se ve borroso» y «todavía no ha llegado» se parecen mucho desde fuera:
    // este bloque dice qué nivel se está PIDIENDO, cuál es el techo del mundo,
    // cuántas teselas del plan han llegado, si el canon 2D está armado, y qué
    // ha pasado en la sesión con la vía de teselas. Nunca en exportaciones.
    if (DEBUG_HUD && !exportScale.current) {
      const fw = cw / (PW * scale);
      const spanKm = EARTH_KM * fw;
      const pxCell = (PW * scale) / W;
      const divide = satelliteDeepSupported(world, SAT_DEEP_Z);
      const lines = [
        `DEBUG 2D · vano ${spanKm >= 100 ? Math.round(spanKm) : spanKm.toFixed(1)} km · `
        + `pide z${tileZ} (techo z${satTopZ}) · ${pxCell >= 10 ? Math.round(pxCell) : pxCell.toFixed(1)} px/celda`,
        `teselas: ${tilesEligible ? 'elegibles' : 'NO elegibles'}`
        + (tilePlanDebug ? ` · entregadas ${tilePlanDebug.exact}/${tilePlanDebug.needed}` : ' · sin plan')
        + ` · rótulos: ${deepMarks ? 'canon' : 'mundo'}`,
        `canon 2D: ${canonWorld ? 'armado' : 'SIN ARMAR'}`
        + ` · almacén ${canonWorld && canonWorldBound(canonWorld) ? 'ligado' : 'SIN LIGAR'}`
        + ` · geo ${geography ? geography.depth : '—'}`
        + ` · mundo ${W}×${H} ${divide ? '(divide la retícula)' : '(NO divide: sin canon hondo)'}`,
        `forja: ${forgeAvailable() ? (forgeDegraded() ? 'DEGRADADA (web worker)' : 'sí') : 'no (web worker)'}`
        + ` · sesión: pedidas ${tileStats.asked} · entregadas ${tileStats.delivered}`
        + ` · declinadas ${tileStats.declined} · errores ${tileStats.errors}`
        + ` · caducadas ${tileStats.timeouts}`
        + ` · EN VUELO ${Math.max(0, tileStats.asked - tileStats.delivered - tileStats.declined
          - tileStats.errors - tileStats.timeouts)}${oldestInFlightMs() > 3000
          ? ` (la más vieja ${Math.round(oldestInFlightMs() / 1000)} s)` : ''}`
        + ` · sembradas ${tileStats.seeded} · guardadas ${tileStats.canonBuilt}`
        + (tileStats.seedErrors ? ` · SIEMBRA-ERR ${tileStats.seedErrors} (mira la consola)` : '')
        + (tileStats.fabErrors ? ` · FÁBRICA-ERR ${tileStats.fabErrors} (mira la consola)` : ''),
        // El embudo nuevo (ARQUITECTURA-TESELAS): cuánto sirvió el disco, qué
        // descartó la cola corta, cuánto aterrizó huérfano. «disco 0/N» con
        // suelo revisitado = el almacén de entintadas no acierta — mirar clave.
        `servicio: pedidas ${tileServiceStats.asked}`
        + ` · disco ${tileServiceStats.diskHits}/${tileServiceStats.diskHits + tileServiceStats.diskMisses}`
        + ` · compartidas ${tileServiceStats.shared}`
        + ` · despachadas ${tileServiceStats.dispatched}`
        + ` · descartadas ${tileServiceStats.droppedQueued}`
        + ` · huérfanas ${tileServiceStats.landedOrphan}`
        + ` · entintadas guardadas ${tileServiceStats.saved}`,
      ];
      ctx.save();
      ctx.font = '500 10px ui-monospace, monospace';
      const wMax = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const x0 = cw - wMax - 22, y0 = ch - 16 * lines.length - 14;
      ctx.fillStyle = 'rgba(7,7,13,0.78)';
      ctx.beginPath();
      ctx.roundRect(x0 - 8, y0 - 6, wMax + 16, 16 * lines.length + 12, 6);
      ctx.fill();
      ctx.fillStyle = '#9fd8a4';
      lines.forEach((l, i) => ctx.fillText(l, x0, y0 + 8 + i * 16));
      ctx.restore();
    }
  };

  // `draw` closes over fresh props every render; the stable scheduler calls
  // the latest one through a ref (kept current in the redraw effect below).
  const drawRef = useRef<(() => void) | null>(null);
  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawRef.current?.());
  }, []);

  // ---- sizing / init ----------------------------------------------------------
  // Re-runs on projection change (dims and/or `projection` dep) and starts
  // from a fresh fitted view — the old pan/zoom is meaningless there.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    viewRef.current = null;

    const fit = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!viewRef.current) {
        const fitScale = Math.min(rect.width / PW, rect.height / PH) * 0.98;
        const initialViewport = viewportRef.current;
        const requestedScale = initialViewport
          ? (EARTH_KM / Math.max(MIN_SPAN_KM, initialViewport.spanKm)) * (rect.width / PW)
          : fitScale;
        const scale = Math.max(fitScale * 0.5, Math.min(maxScaleRef.current, requestedScale));
        const [focusX, focusY] = spec.forward(initialViewport?.u ?? 0.5, initialViewport?.v ?? 0.5);
        viewRef.current = {
          scale,
          ox: rect.width * 0.5 - focusX * PW * scale,
          oy: rect.height * 0.5 - focusY * PH * scale,
        };
        clampView(viewRef.current, rect.width, rect.height, PW, PH, wraps);
      }
      scheduleDraw();
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(sharpTimer.current);
      window.clearTimeout(ctxRetryRef.current);
      ctxRetryRef.current = 0;
    };
  }, [PW, PH, projection, scheduleDraw, spec, wraps]);

  /**
   * Keep the draw closure current — every render, with no redraw.
   *
   * This effect used to have no dependency array AND end in `scheduleDraw()`,
   * so any state change repainted the whole canvas. The state that changes most
   * is `hover`, which `handlePointerMove` sets to a FRESH OBJECT on every
   * pointer event — so simply moving the mouse across the map, button up,
   * repainted base + pyramid + borders + roads + every mark and label and the
   * declutterer at pointer rate. Nothing in `draw` reads `hover`; the tooltip is
   * a DOM node beside the canvas.
   */
  useEffect(() => {
    drawRef.current = draw;
    // The store calls this when a tile lands, so the interim gets one more
    // blit with the new tile in it. Through a ref, or the closure the store
    // was built with goes stale on the first re-render.
    requestDrawRef.current = scheduleDraw;
  });

  // And redraw when something that is actually ON the canvas changes.
  useEffect(() => {
    scheduleDraw();
  }, [
    scheduleDraw, world, revision, viewMode, projection, geography,
    showRivers, showLandmarks, showWaypoints, showGrid, showSettlements,
    showRoads, showBorders, showFeatures, roadFrom, tool,
    waypoints, selectedWaypointId, selectedSpatialKey, regionalEntities,
    regionDetail, canonWorld, canonEdits, landmarks,
    // Las capas nuevas: sin esto una comarca recién guardada no aparece hasta
    // que algo mueva el mapa, y una ruta recién calculada tampoco.
    savedRegions, activeRegionId, annotations,
  ]);

  // ---- export -----------------------------------------------------------------
  /**
   * A PNG of THIS view, at a multiple of screen resolution.
   *
   * The export the parent already has re-renders the world RASTER — so the file
   * it saves is framed to the whole planet and carries none of the pyramid, the
   * borders, the roads, the names, the pins or the scale bar the reader is
   * actually looking at. This draws the frame on screen, once, into a bigger
   * backing store, and hands back exactly that.
   */
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async (scale: number): Promise<Blob | null> => {
      const canvas = canvasRef.current;
      // No camera yet means no frame: the first `fit` has not run. And one
      // export at a time — a second one starting inside the first would
      // remember the ALREADY ENLARGED backing store as the size to restore, and
      // the reader would be left looking at a canvas twice the size of its box.
      if (!canvas || !viewRef.current || exportScale.current) return null;
      // One to four. Under one the file would be coarser than the screen it is
      // a picture of, and a 4K window past four is a canvas the browser
      // silently refuses to allocate — every layer then draws into nothing and
      // the export is a blank PNG.
      const s = Math.min(4, Math.max(1, Number.isFinite(scale) ? scale : 1));
      const rect = canvas.getBoundingClientRect();
      // A view that is not on screen has no frame to hand back.
      if (rect.width < 1 || rect.height < 1) return null;
      const w0 = canvas.width, h0 = canvas.height;
      canvas.width = Math.max(1, Math.round(rect.width * s));
      canvas.height = Math.max(1, Math.round(rect.height * s));
      exportScale.current = s;
      try {
        // SYNCHRONOUSLY. Through `scheduleDraw` the frame would land on the
        // next animation frame, by which time the backing store is back to
        // screen size and `toBlob` has already read an empty canvas.
        drawRef.current?.();
        return await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((blob) => resolve(blob), 'image/png');
        });
      } finally {
        // However it ended. Leaving the store enlarged would leave the reader
        // looking at a canvas drawn at the wrong ratio — the map in a corner —
        // until something resized the container.
        exportScale.current = 0;
        canvas.width = w0;
        canvas.height = h0;
        drawRef.current?.();
      }
    };
    return () => { exportRef.current = null; };
  }, [exportRef]);

  // ---- flights ----------------------------------------------------------------
  // A one-shot animated approach (double-click, "volar aquí"): the same
  // interpolation every view uses, applied to this view's private camera.
  const flightRaf = useRef(0);
  const cancelFlight = useCallback(() => {
    if (flightRaf.current) { cancelAnimationFrame(flightRaf.current); flightRaf.current = 0; }
  }, []);

  const applyViewport = useCallback((vp: WorldViewport) => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fitScale = Math.min(rect.width / PW, rect.height / PH) * 0.98;
    const scale = Math.max(fitScale * 0.5, Math.min(maxScale,
      (EARTH_KM / Math.max(MIN_SPAN_KM, vp.spanKm)) * (rect.width / PW)));
    const [fx, fy] = spec.forward(vp.u, vp.v);
    view.scale = scale;
    view.ox = rect.width * 0.5 - fx * PW * scale;
    view.oy = rect.height * 0.5 - fy * PH * scale;
    clampView(view, rect.width, rect.height, PW, PH, wraps);
    scheduleDraw();
  }, [PW, PH, spec, wraps, scheduleDraw, maxScale]);

  /**
   * Volar de donde estamos a donde se pide, con la interpolación compartida.
   *
   * Sacado del efecto de `flyTarget` para que la tecla Inicio y el paso atrás
   * lleguen igual que un doble clic: en 520 ms, con el arco que se abre y se
   * cierra que `flightAt` dibuja. Un salto seco a la vista planetaria pierde al
   * lector exactamente igual que perderse — no sabe si ha subido, si ha saltado
   * de continente o si el mapa se ha recargado.
   */
  const flyLocal = useCallback((target: WorldViewport) => {
    const from = computeViewport();
    if (!from) return;
    cancelFlight();
    const to = clampViewport(target);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / FLIGHT_MS);
      applyViewport(flightAt(from, to, t));
      if (t < 1) {
        flightRaf.current = requestAnimationFrame(step);
      } else {
        flightRaf.current = 0;
        reportViewport();
      }
    };
    flightRaf.current = requestAnimationFrame(step);
  }, [computeViewport, cancelFlight, applyViewport, reportViewport]);

  /**
   * DE DÓNDE VENÍAMOS. La pila de vistas.
   *
   * No había ninguna forma de volver. El lector baja a un caserío, pierde la
   * costa de vista, y nada en la pantalla le devuelve a donde estaba: la rueda
   * hacia atrás sube por donde ha bajado sólo si no ha desplazado el mapa, y en
   * cuanto lo ha desplazado está buscando un continente a ciegas.
   *
   * Sólo los saltos entran en la pila. Desplazar y hacer rueda son continuos —
   * el lector ve moverse el suelo y no se pierde — y meterlos aquí llenaría la
   * pila de veinticuatro posiciones indistinguibles y haría inútil el paso
   * atrás. Un salto es un vuelo (doble clic, «volar aquí»), abrir una comarca
   * guardada, o esta misma tecla.
   */
  const camHistory = useRef<WorldViewport[]>([]);
  const pushHistory = useCallback((vp: WorldViewport | null) => {
    if (!vp) return;
    const stack = camHistory.current;
    // Sin repetir el sitio en el que ya estamos: dos «volar aquí» al mismo
    // pueblo son un solo paso atrás, no dos que no van a ninguna parte.
    if (stack.length && sameViewport(stack[stack.length - 1], vp)) return;
    stack.push(vp);
    if (stack.length > 24) stack.shift();
  }, []);

  /** Devolver al lector a la última vista de la que saltó. */
  const goBack = useCallback(() => {
    const prev = camHistory.current.pop();
    if (prev) flyLocal(prev);
  }, [flyLocal]);

  /**
   * El mundo entero, de una tecla.
   *
   * `MAX_SPAN_KM` es la circunferencia: `applyViewport` la convierte en la
   * escala que mete la lámina entera en el lienzo y `clampView` la centra. Si
   * ya estamos ahí no se hace nada — ni vuelo ni entrada en la pila — porque un
   * paso atrás que devuelve al mismo sitio es un paso atrás gastado.
   */
  const flyHome = useCallback(() => {
    const now = computeViewport();
    if (!now || now.spanKm > MAX_SPAN_KM * 0.92) return;
    pushHistory(now);
    flyLocal({ u: 0.5, v: 0.5, spanKm: MAX_SPAN_KM });
  }, [computeViewport, pushHistory, flyLocal]);

  /**
   * Somebody else moved the shared camera. Go there.
   *
   * `viewport` was read exactly once, inside `fit()`, and only when there was no
   * view yet — so "Ver en 2D" from the place inspector and "abrir comarca
   * guardada" did nothing at all whenever the reader was ALREADY in the 2D,
   * which is the most likely place to press them. The carta has adopted the
   * shared camera since it was written; this is the same effect, with the same
   * echo guard so our own report does not bounce back and fight the wheel.
   */
  useEffect(() => {
    if (!viewport || !viewRef.current) return;
    if (sameViewport(viewport, lastReported.current)) return;
    cancelFlight();
    // Todo lo que llega hasta aquí es un SALTO de verdad: el eco de nuestro
    // propio informe lo ha filtrado la línea de arriba, así que lo que queda es
    // alguien de fuera moviendo la cámara — abrir una comarca guardada, «ver en
    // 2D» desde el inspector. Justo de eso es de lo que hay que poder volver.
    pushHistory(computeViewport());
    applyViewport(viewport);
    // What we ACHIEVED, not what we were asked for. `applyViewport` clamps to
    // `maxScale`, which is 28 px/cell while the geography is still building — so
    // opening a saved comarca at 30 km in that window lands a thousand kilometres
    // out, and recording the request would have left the parent driving
    // everything from a span the map is not showing.
    lastReported.current = computeViewport() ?? viewport;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  /**
   * When the ceiling drops, bring the camera under it.
   *
   * Leaving the atlas mode or the equirect projection takes `maxScale` from
   * ~45 875 px per cell to 28 — the pyramid and the sharp window are only
   * defined there. The live `view.scale` was left where it was, so the picture
   * became giant flat blocks and the NEXT wheel tick teleported the reader out
   * to a thousand kilometres. Re-clamping makes the transition a zoom-out you
   * can watch rather than an ambush on the next gesture.
   */
  useEffect(() => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas || view.scale <= maxScale) return;
    const rect = canvas.getBoundingClientRect();
    view.scale = maxScale;
    clampView(view, rect.width, rect.height, PW, PH, wraps);
    reportViewport();
    scheduleDraw();
  }, [maxScale, PW, PH, wraps, reportViewport, scheduleDraw]);

  useEffect(() => {
    if (!flyTarget) return;
    const from = computeViewport();
    if (!from) return;
    // De aquí es de donde el lector querrá volver.
    pushHistory(from);
    flyLocal({ u: flyTarget.u, v: flyTarget.v, spanKm: flyTarget.spanKm ?? from.spanKm });
    return cancelFlight;
    // The token IS the request; everything else is read fresh when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget?.token]);

  // Wheel zoom — non-passive listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      // Either way: Ctrl+wheel over a canvas is the browser's page zoom, and
      // the plain wheel is the page scrolling behind the map.
      e.preventDefault();
      /**
       * Ctrl/⌘ with a SIZED brush out sizes the BRUSH, not the camera.
       *
       * Same chord, same logarithmic step and same bounds as World3D, so a
       * reader who learned the gesture on the globe does not fly out to a
       * planetary view here when they meant to make the head bigger.
       *
       * `hasRadius`, not `painting`. Guarded on "a brush is out" alone, the
       * chord swallowed the zoom in every mode that has no size to set — Río,
       * Punto, Camino, and the frontier's bucket and two lassos — and spent it
       * on a `tool.radius` those tools never read and the panel never shows. The
       * reader got no bigger brush and no zoom either, which is the worst
       * possible answer to a gesture: nothing happens and the thing that used to
       * happen has stopped.
       */
      const { tool: bt, brushing: painting, onTool: setTool } = brushRef.current;
      if ((e.ctrlKey || e.metaKey) && painting && bt && setTool && hasRadius(bt)) {
        // Clamped in GROUND KILOMETRES, against the two ends of the panel's own
        // size track — the radius is stored in world cells, which mean nothing
        // to the reader and change meaning with the width of the world.
        const kmPerCell = Math.max(1, Math.round(EARTH_KM / W));
        const km = Math.min(BRUSH_MAX_KM, Math.max(BRUSH_MIN_KM,
          bt.radius * kmPerCell * Math.pow(1.0022, -e.deltaY)));
        setTool({ radius: km / kmPerCell });
        return;
      }
      cancelFlight();
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const minScale = Math.min(rect.width / PW, rect.height / PH) * 0.5;
      const newScale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
      const k = newScale / view.scale;
      view.ox = mx - (mx - view.ox) * k;
      view.oy = my - (my - view.oy) * k;
      view.scale = newScale;
      clampView(view, rect.width, rect.height, PW, PH, wraps);
      scheduleDraw();
      reportViewport();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // `W` only moves when the world is a different size, which rebuilds every
    // layer anyway; re-subscribing the listener then costs nothing.
  }, [PW, PH, W, wraps, scheduleDraw, reportViewport, cancelFlight, maxScale]);

  // ---- helpers -------------------------------------------------------------------
  const screenToMap = (sx: number, sy: number): { u: number; v: number } | null => {
    const view = viewRef.current;
    if (!view) return null;
    const mapW = PW * view.scale, mapH = PH * view.scale;
    let X: number;
    if (wraps) {
      X = (((sx - view.ox) / mapW) % 1 + 1) % 1;
    } else {
      X = (sx - view.ox) / mapW;
      if (X < 0 || X > 1) return null;
    }
    const Y = (sy - view.oy) / mapH;
    if (Y < 0 || Y > 1) return null;
    const uv = spec.inverse(X, Y);
    if (!uv) return null;
    return { u: uv[0], v: uv[1] };
  };

  const waypointAt = (sx: number, sy: number): WorldWaypoint | null => {
    const id = hitAt(sx, sy, ['waypoint'])?.waypointId;
    return id ? waypoints.find((wp) => wp.id === id) ?? null : null;
  };

  /**
   * The nearest thing the last frame DREW, of the kinds asked for.
   *
   * Distance is scaled by the entry's bias so a capital beats the village next
   * to it and a pin beats both — the same ordering the old searches had, now
   * applied to one list instead of three that disagreed with the renderer.
   */
  const hitAt = (
    sx: number, sy: number, kinds: Hit['kind'][], want?: (h: Hit) => boolean,
  ): Hit | null => {
    let best: Hit | null = null;
    let bestScore = Infinity;
    for (const h of painted.current) {
      if (!kinds.includes(h.kind)) continue;
      if (want && !want(h)) continue;
      const dx = sx - h.x, dy = sy - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > h.reach * h.reach) continue;
      // SQUARED, like the searches this replaced. Scoring linear distance by the
      // same bias silently changes the winner: a capital at 10 px (bias 0,45)
      // and a village at 5 px used to go to the village (45 vs 25) and with a
      // linear score go to the capital (4,5 vs 5).
      const score = d2 * (h.bias ?? 1);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    return best;
  };

  const landmarkAt = (sx: number, sy: number): WorldSpatialEntity | null =>
    hitAt(sx, sy, ['entity'])?.entity ?? null;

  /**
   * Lo que hay bajo el puntero Y SE PUEDE COGER.
   *
   * Pregunta al mismo registro que todo lo demás, con el filtro puesto: un
   * rótulo pintado y una ruina responden los dos como `note`, y sólo la ruina
   * tiene identidad que trasladar. Sin el filtro, el arrastre se quedaría
   * enganchado al rótulo — que está más cerca — y no movería nada.
   */
  const movableAt = (sx: number, sy: number): Hit | null => {
    // Sólo lo que el padre sabe guardar. Ofrecer el gesto — cursor de mover,
    // fantasma siguiendo la mano — y tragárselo al soltar es peor que no
    // ofrecerlo: el lector cree que ha movido el pueblo y no lo ha movido.
    const kinds: Hit['kind'][] = [];
    if (onEdit) kinds.push('settlement', 'entity', 'note');
    if (onMoveWaypoint) kinds.push('waypoint');
    if (!kinds.length) return null;
    return hitAt(sx, sy, kinds, (h) => (h.kind === 'waypoint' ? !!h.waypointId : !!h.mover));
  };

  /**
   * DÓNDE NACIÓ lo que hay en este punto, si es que alguien lo movió.
   *
   * `pickGeneratedAt` — que es quien contesta a un Ctrl+clic — mide contra
   * `geo.settlements`, y esa lista no sabe nada de `moves`: guarda la posición
   * de origen. Así que en cuanto el lector mueve un pueblo, el Ctrl+clic sobre
   * el punto donde AHORA se dibuja no encuentra nada dentro de la tolerancia y
   * el gesto se pierde en silencio — o, peor, alcanza al vecino. Una función
   * que crea un objeto inalcanzable para el borrador no está terminada.
   *
   * Las coordenadas de origen están en la propia llave: `editKey` las escribió
   * ahí («settlement:412,207»), que es justo lo que la hace estable. Así que se
   * leen de vuelta y la pregunta se traslada al sitio en el que la lista sí
   * responde. La tolerancia es la misma que va a usar el buscador, para que lo
   * que este paso acepta sea exactamente lo que aquél puede encontrar.
   */
  const sourcePointFor = (x: number, y: number, tol: number): Pt => {
    const mv = world.painted?.moves;
    if (!mv) return { x, y };
    let best: Pt | null = null;
    let bestD = tol;
    for (const key of Object.keys(mv)) {
      const p = mv[key];
      let dx = Math.abs(p.x - x);
      if (dx > W / 2) dx = W - dx;
      const d = Math.hypot(dx, p.y - y);
      if (d > bestD) continue;
      const tail = key.slice(key.lastIndexOf(':') + 1).split(',');
      const sx = Number(tail[0]), sy = Number(tail[1]);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      bestD = d;
      best = { x: sx, y: sy };
    }
    return best ?? { x, y };
  };

  /** Dónde ha soltado el lector, en celdas del mundo — o null si ha soltado
   *  fuera del suelo (el margen negro de una proyección curva). */
  const dropPoint = (sx: number, sy: number): Pt | null => {
    const m = screenToMap(sx, sy);
    if (!m) return null;
    return {
      x: ((m.u * W) % W + W) % W,
      y: Math.min(H - 1e-3, Math.max(0, m.v * H)),
    };
  };

  /**
   * Soltar el objeto donde está el puntero.
   *
   * Una chincheta va a su tabla; todo lo demás es un `move` en la lista de
   * ediciones, que es lo que hace que sobreviva a cerrar el mundo y que Ctrl+Z
   * lo levante. Devuelve si ha llegado a mover algo, para que el llamante sepa
   * si tragarse el clic.
   */
  const dropMove = (sx: number, sy: number): boolean => {
    const held = moveRef.current;
    moveRef.current = null;
    if (!held?.live) return false;
    // Con el desfase del agarre, igual que el fantasma que el lector ha estado
    // viendo: el objeto cae donde se veía caer, no donde está la punta del
    // puntero. Ver `moveRef.fromX`.
    const at = dropPoint(held.fromX + (sx - held.pressX), held.fromY + (sy - held.pressY));
    if (!at) { scheduleDraw(); return true; }
    if (held.hit.kind === 'waypoint' && held.hit.waypointId) {
      onMoveWaypoint?.(held.hit.waypointId, at.x / W, at.y / H);
    } else if (held.hit.mover) {
      // `onEdit` y no `brushRef`: mover no es pintar, y el gesto existe con el
      // pincel guardado. El padre lo tiene puesto siempre que la vista sea
      // editable.
      onEdit?.({
        kind: 'move',
        target: held.hit.mover.target,
        key: held.hit.mover.key,
        x: at.x,
        y: at.y,
      });
    }
    scheduleDraw();
    return true;
  };

  /** Dejarlo donde estaba. Nada se ha confirmado todavía, así que no hay nada
   *  que deshacer — que es para lo que sirve un Escape. */
  const abandonMove = useCallback(() => {
    if (!moveRef.current) return;
    moveRef.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  /** A name the deep tiles found — a hamlet, a farm, a mill, a named crag. */
  const deepPlaceAt = (sx: number, sy: number): TilePlace | null =>
    hitAt(sx, sy, ['place'])?.place ?? null;

  /** What a realm index is CALLED, with −1 spelled out. Unclaimed ground is a
   *  real answer to "whose is this", not a blank. */
  const realmLabel = (r: number): string =>
    (r >= 0 && geography?.realms[r]?.name) || t('worldgen.hover.realm.unclaimed');

  /**
   * Close the ring and hand the ground over.
   *
   * Under three corners there is no shape at all — `polygonCells` returns
   * nothing for one — so closing would spend an undo step on ground that never
   * changed and leave the reader hunting for what it did. The corners STAY put
   * in that case rather than being thrown away: a reader who pressed Intro one
   * click early meant to finish, not to lose the shape they had drawn.
   */
  const closeRealmPoly = useCallback((): boolean => {
    const open = realmPoly.current;
    const { tool: bt, onEdit: commit } = brushRef.current;
    if (!open || open.pts.length < 3 || !bt || bt.mode !== 'frontera' || !commit) return false;
    realmPoly.current = null;
    commit({
      kind: 'realmArea',
      realm: open.neg ? -1 : bt.realm,
      pts: open.pts,
      smooth: bt.realmTool === 'curve',
    });
    scheduleDraw();
    return true;
  }, [scheduleDraw]);

  /** Throw the half-drawn shape away. Nothing is committed, so there is nothing
   *  to undo — which is the whole point of having an Escape. */
  const abandonRealmPoly = useCallback(() => {
    if (!realmPoly.current) return;
    realmPoly.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  /** Take the last corner back. Emptying the run ends the gesture outright:
   *  a live shape with no corners is a hidden mode with nothing on screen to
   *  say the tool is still holding one. */
  const dropRealmCorner = useCallback(() => {
    const open = realmPoly.current;
    if (!open) return;
    open.pts.pop();
    if (!open.pts.length) realmPoly.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  /**
   * Putting the tool away abandons a half-drawn frontier.
   *
   * The same rule `WorldView` keeps for `roadFrom`, mirrored here because the
   * corners live here: a gesture that spans several clicks IS a hidden mode,
   * and one that survives the tool being changed is the worst kind — the next
   * Intro anywhere on the page would drop a province the reader had forgotten
   * they were drawing. Swapping between the straight lasso and the curved one
   * keeps the corners on purpose: it is the same run of clicks drawn two ways.
   *
   * `world` is in the list for the reason `abandonLive` exists: the corners are
   * world cells, and a regenerated — or differently sized — world turns them
   * into coordinates into ground that is gone.
   */
  const realmLasso = tool?.mode === 'frontera' ? tool.realmTool : null;
  useEffect(() => {
    if (realmLasso !== 'poly' && realmLasso !== 'curve') abandonRealmPoly();
  }, [realmLasso, world, abandonRealmPoly]);

  // Space suspends the brush for as long as it is held, the way every paint
  // program does it, so the reader can reposition mid-drawing without changing
  // tool. Ctrl+Z goes to the world's own history, which is shared with 3D.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
      // NOT while the reader is typing. This listener is on `window` and calls
      // `preventDefault`, so Ctrl+Z in the Rótulo text box — or in any input on
      // the page — silently reverted a brush stroke instead of the typing.
      // World3D has always had this guard; the 2D did not.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA'
        || (e.target as HTMLElement | null)?.isContentEditable) return;
      /**
       * The frontier lasso, which is the one gesture here that spans clicks.
       *
       * A multi-click gesture needs a way OUT that is not "close it into the
       * world and then undo": Intro finishes the ring, Retroceso takes the last
       * corner back, Esc throws the whole thing away. Under the typing guard
       * above on purpose — Retroceso in the Rótulo box has to delete a letter,
       * not a corner — and before the undo chord, which stays reachable while a
       * shape is open because it undoes the WORLD, not the gesture.
       *
       * Focused controls are excluded as well as text fields: `preventDefault`
       * on Intro is what stops a button being pressed by keyboard, so without
       * this a half-drawn frontier would quietly deaden every button on the
       * page — and the reader would have no idea which of the two things they
       * were doing had broken the other.
       */
      /**
       * Esc suelta lo que va en la mano y lo deja donde estaba.
       *
       * Antes que el lazo porque las dos cosas no pueden estar vivas a la vez
       * — el lazo es un pincel y con un pincel fuera no se coge nada — y
       * porque una mudanza en curso es lo más inmediato que puede haber:
       * mientras el pueblo sigue al puntero, Esc no puede significar otra cosa.
       */
      if (moveRef.current?.live && e.key === 'Escape') {
        e.preventDefault();
        abandonMove();
        return;
      }
      if (realmPoly.current && tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') {
        if (e.key === 'Enter') { e.preventDefault(); closeRealmPoly(); return; }
        if (e.key === 'Escape') { e.preventDefault(); abandonRealmPoly(); return; }
        // `preventDefault` matters here: Retroceso outside a text field is the
        // browser's own "go back", which would take the whole app off the map.
        if (e.key === 'Backspace') { e.preventDefault(); dropRealmCorner(); return; }
      }
      /**
       * LAS DOS TECLAS DE LA CÁMARA: el mundo entero, y de dónde venía.
       *
       * Después del lazo a propósito: mientras hay una frontera a medio dibujar,
       * Retroceso quita una esquina y no toca la cámara — la lectura es la misma
       * en los dos casos («deshaz el último paso»), y la más cercana gana.
       *
       * `preventDefault` en Retroceso no es cosmético: fuera de un campo de
       * texto es el «atrás» del navegador, que se llevaría la aplicación entera
       * fuera del mapa. En Inicio evita que la página salte al principio cuando
       * el mapa vive dentro de una columna con desplazamiento.
       */
      // Un desplegable abierto se queda con las dos: Inicio salta a su primera
      // opción, y quitársela sería romper un control por ganar un atajo.
      if (tag !== 'SELECT') {
        if (e.key === 'Home') { e.preventDefault(); flyHome(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); goBack(); return; }
      }
      if (e.ctrlKey || e.metaKey) {
        // One keymap for both views. They disagreed: here Ctrl+Shift+Z redid,
        // in the 3D the same chord UNDID (its test is `e.key === 'z' || 'Z'`),
        // and Ctrl+Y redid there and did nothing here. The same chord destroying
        // work in one view and restoring it in the other is not a preference.
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(e.shiftKey ? 'wg-redo' : 'wg-undo'));
        } else if (k === 'y') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('wg-redo'));
        }
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    // Alt-tabbing away while Space is held used to leave the brush suspended
    // for ever, because the keyup never arrived.
    const blur = () => { spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [closeRealmPoly, abandonRealmPoly, dropRealmCorner, abandonMove, flyHome, goBack]);

  /** The nearest town to a screen point, within a screen-sized reach. */
  const settlementAt = (sx: number, sy: number): Settlement | null =>
    hitAt(sx, sy, ['settlement'])?.settlement ?? null;

  // ---- pointer events ----------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    cancelFlight();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    negRef.current = e.ctrlKey || e.metaKey;
    /**
     * IS THIS GESTURE THE CAMERA? Decided once, here, with the modifiers.
     *
     * Espacio, Mayúsculas and any button that is not the left one all mean
     * "move the map, do not paint" — that is the escape hatch the brush guard
     * below has always tested for. Written down instead of re-derived because
     * `handlePointerMove` and `handlePointerUp` both need the same answer, and
     * both used to guess: the move handler returned early on `brushing` alone
     * and the drag never happened, the up handler saw an unmoved drag and ran
     * the CLICK path. See `panRef` for what that click did.
     *
     * Resolved at the press like `negRef`, and written on EVERY press so it can
     * never be left over from the last one.
     */
    panRef.current = brushing && (spaceRef.current || e.shiftKey || e.button !== 0);
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    // Literally the same condition, from the other side: a brush is out and
    // this press is not the camera's.
    if (brushing && !panRef.current) {
      const m = screenToMap(sx, sy);
      if (!m) return;
      /**
       * Alt is the eyedropper: it READS the ground instead of painting it.
       *
       * The biome list is forty-four entries long and the one the reader wants
       * is nearly always already on screen under the cursor. Without this,
       * matching the ground next door means hovering it, reading the name off
       * the tooltip, and then finding that name in the panel — and the tooltip
       * gives a translated name, which is not what the list is keyed by.
       */
      const { tool: dropper, onTool: setTool } = brushRef.current;
      if (e.altKey && dropper?.mode === 'biome' && setTool) {
        const cx = Math.min(W - 1, Math.max(0, Math.floor(m.u * W)));
        const cy = Math.min(H - 1, Math.max(0, Math.floor(m.v * H)));
        setTool({ biome: world.biome[cy * W + cx] as BiomeId });
        return;
      }
      /**
       * The frontier lasso: A CLICK IS A CORNER, not a stroke.
       *
       * Handled before the stroke machinery and returning without touching it,
       * so `handlePointerUp` finds neither a stroke nor a drag and does nothing
       * at all. Letting a corner also open a stroke would put a one-point
       * polyline into the generic commit on every click — and the tint trail,
       * the live-world ownership and the release path all belong to a gesture
       * this one is not.
       */
      const lasso = brushRef.current.tool;
      if (lasso && lasso.mode === 'frontera'
        && (lasso.realmTool === 'poly' || lasso.realmTool === 'curve')) {
        const open = realmPoly.current;
        // Closing on the first handle asks `painted` like every other pointer
        // question in this view — no second hit test that can disagree with
        // where the handle was actually drawn. See the note on `painted`.
        if (open && hitAt(sx, sy, ['realmVertex'])) { closeRealmPoly(); return; }
        const corner = { x: m.u * W, y: m.v * H };
        if (open) open.pts.push(corner);
        else realmPoly.current = { pts: [corner], neg: negRef.current };
        scheduleDraw();
        return;
      }
      const p0 = { x: m.u * W, y: m.v * H };
      stroke.current = [p0];
      liveWorld.current = world;
      pressAt.current = { x: sx, y: sy };
      brushAt.current = { x: sx, y: sy, cx: p0.x, cy: p0.y };
      const { tool: bt } = brushRef.current;
      if (bt && bt.mode === 'biome' && !negRef.current
        && viewMode === 'atlas' && projection === 'equirect' && unshadedAtlas && sharpReady()) {
        liveBiome.current = { saved: new Map() };
        applyLiveBiome();
      }
      if (bt && (bt.mode === 'terrain' || bt.mode === 'land')
        && viewMode === 'atlas' && projection === 'equirect' && unshadedAtlas && sharpReady()) {
        // Sculpt LIVE: the ground moves under the brush. Negative resolves at
        // the START here — the gesture must deform in the direction the
        // release will commit.
        const spec = negRef.current ? negativeOf(bt) : bt;
        // THE WHOLE HEAD, not just its size.
        //
        // Leaving out curve/tip/angle/jitter/aspect/taper meant the live path
        // built a plain round disc while the ring drew a ridge — and because
        // `SculptGesture.edits()` copies the spec straight into the stored
        // stroke, the SAVED edit was a disc too. So the same gesture made
        // different ground depending on whether the reader happened to be
        // zoomed in past 2,5 px per cell. World3D has always passed all of it.
        const g = new SculptGesture(world.elevation, W, H, world.params.seed, {
          kind: spec.mode as 'terrain' | 'land',
          op: spec.mode === 'land' ? spec.landOp : spec.terrainOp,
          radius: spec.radius, strength: spec.strength, softness: spec.softness,
          curve: spec.curve, tip: spec.tip, angle: spec.angle,
          jitter: spec.jitter, aspect: spec.aspect, taper: spec.taper,
        });
        liveSculpt.current = g;
        patchLive(g.extend(p0));
      }
      scheduleDraw();
      return;
    }
    /**
     * ¿HAY ALGO AQUÍ QUE COGER? Entonces el arrastre lo mueve a ÉL, no al mapa.
     *
     * Es la regla de cualquier editor de mapas y no hace falta ningún modo: el
     * impacto es de diez píxeles, así que arrastrar sobre suelo vacío sigue
     * siendo mover el mapa, que es el 99 % de los arrastres. Sólo con el botón
     * izquierdo y sin pincel — con un pincel fuera el arrastre es la pincelada,
     * y esa es la promesa que el lector ha hecho al coger la herramienta.
     *
     * `dragRef` se arma igual, y no sobra: hasta los cuatro píxeles el gesto
     * todavía puede acabar siendo un clic, y el camino del clic sale de ahí.
     * Lo que no puede es DESPLAZAR mientras se decide — ver el bloque de
     * `moveRef` en `handlePointerMove`, que devuelve antes de llegar a él.
     *
     * Escrito en cada presión, con null incluido: un agarre heredado de un
     * gesto anterior haría que el siguiente arrastre sobre suelo vacío se
     * llevara un pueblo que el lector ni siquiera está tocando.
     */
    moveRef.current = null;
    if (!brushing && e.button === 0) {
      const grab = movableAt(sx, sy);
      if (grab) {
        moveRef.current = {
          hit: grab, fromX: grab.x, fromY: grab.y,
          pressX: sx, pressY: sy, x: sx, y: sy, live: false,
        };
      }
    }
    // Everything below this line is the CAMERA, and the cursor says so: an open
    // hand closing over the map, not the brush's crosshair, even where a brush
    // is out and it was Espacio that got us here.
    if (!brushing || panRef.current) e.currentTarget.style.cursor = 'grabbing';
    dragRef.current = { x: sx, y: sy, ox: view.ox, oy: view.oy, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    // The ring follows the pointer whenever a brush is out, button down or not:
    // without it the reader cannot tell how big the next stroke is.
    // `!panRef.current` is what makes Espacio, Mayúsculas and the middle button
    // work at all: this branch returns, so without the term the drag below was
    // unreachable while a brush was out and the promised pan was a click. See
    // `panRef`.
    if (brushing && !panRef.current) {
      const mp = screenToMap(sx, sy);
      if (!mp) {
        /**
         * There is no cell under the pointer — the black margin a
         * non-cylindrical projection leaves in the corners of the canvas.
         *
         * `(mp?.u ?? 0) * W` silently answered "world cell (0, 0)". The ring is
         * solved against the ground it sits on, so its outline changed shape the
         * moment the pointer crossed the edge; and every point of an in-flight
         * stroke is drawn RELATIVE to this anchor, so the preview jumped
         * thousands of pixels away from the hand drawing it. No cell, no anchor
         * — the same answer `onPointerLeave` gives.
         */
        brushAt.current = null;
      } else {
        brushAt.current = { x: sx, y: sy, cx: mp.u * W, cy: mp.v * H };
        const pts = stroke.current;
        if (pts) {
          const p = { x: mp.u * W, y: mp.v * H };
          const last = pts[pts.length - 1];
          // One point per half-cell keeps the serialized edit small enough to
          // store a hundred strokes.
          if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) {
            pts.push(p);
            const g = liveSculpt.current;
            if (g) patchLive(g.extend(p));
            else if (liveBiome.current) applyLiveBiome();
          }
        }
      }
      /**
       * WHOSE GROUND IS THIS, and whose the next click makes it.
       *
       * The readout is suppressed under every other brush on purpose: a box
       * under the cursor is in the way of the thing being painted. The frontier
       * tool is the one that has to answer a question BEFORE the stroke — the
       * political wash says a cell is claimed and nothing on screen says by
       * whom, the tint is a hue rather than a name, and the reader is about to
       * hand that ground to somebody. Ctrl is read live, so the negative names
       * the country it is about to take the cell away from.
       *
       * Never mid-stroke: the answer is already changing under the hand and the
       * box would sit on top of the paint. `setHover(null)` on a hover that is
       * already null re-renders nothing, so the drag stays as cheap as it was.
       */
      const bt2 = brushRef.current.tool;
      if (bt2 && bt2.mode === 'frontera' && mp && !stroke.current) {
        const hx = Math.min(W - 1, Math.max(0, Math.floor(mp.u * W)));
        const hy = Math.min(H - 1, Math.max(0, Math.floor(mp.v * H)));
        const hi = hy * W + hx;
        const to = (e.ctrlKey || e.metaKey) ? -1 : bt2.realm;
        const from = geography ? geography.realmOf[hi] : -1;
        setHover({
          x: Math.min(sx + 14, rect.width - 260),
          y: sy + 18,
          // The sea is not a country's to give: the merge in `settlements.ts`
          // writes −1 over open water whatever the stroke said, and
          // `realmFloodCells` will not even start there. A readout promising a
          // handover on water would be a promise nothing downstream keeps.
          text: world.elevation[hi] <= 0
            ? t('worldgen.hover.realm.sea')
            : from === to
              ? t('worldgen.hover.realm.keeps').replace('{name}', realmLabel(from))
              : t('worldgen.hover.realm.gives')
                .replace('{from}', realmLabel(from))
                .replace('{to}', realmLabel(to)),
        });
      } else {
        setHover(null);
      }
      scheduleDraw();
      return;
    }
    if (brushAt.current) { brushAt.current = null; scheduleDraw(); }

    /**
     * Un objeto en la mano gana al mapa, y se queda con el gesto entero.
     *
     * Antes del bloque del arrastre de cámara y devolviendo: el mapa NO puede
     * moverse a la vez que lo que hay encima de él, o el objeto llegaría a
     * ordenadas que el lector no ha elegido. `dragRef` se anula al pasar el
     * umbral, no al presionar, porque hasta entonces el gesto todavía puede
     * resultar ser un clic.
     */
    const held = moveRef.current;
    if (held) {
      held.x = sx; held.y = sy;
      if (!held.live && Math.abs(sx - held.pressX) + Math.abs(sy - held.pressY) > 4) {
        held.live = true;
        dragRef.current = null;
        e.currentTarget.style.cursor = 'grabbing';
        setHover(null);
      }
      if (held.live) scheduleDraw();
      /**
       * Y devuelve SIEMPRE, aunque todavía no sea una mudanza.
       *
       * El desplazamiento de la cámara se declara movido a los tres píxeles y
       * la mudanza a los cuatro, así que dejar pasar el gesto mientras se
       * decide desplazaba el mapa un píxel justo antes de coger el objeto: un
       * tirón al empezar cada arrastre, y el fantasma dibujado un píxel al lado
       * del pueblo, porque `fromX` se tomó antes del tirón. Un agarre pendiente
       * que acaba sin pasar el umbral es un CLIC, y un clic tampoco desplaza.
       */
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const dx = sx - drag.x, dy = sy - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        view.ox = drag.ox + dx;
        view.oy = drag.oy + dy;
        clampView(view, rect.width, rect.height, PW, PH, wraps);
        scheduleDraw();
        setHover(null);
      }
      return;
    }
    /**
     * El cursor dice qué se puede coger.
     *
     * Es lo único que anuncia el gesto sin gastar una línea de texto: la mano
     * abierta sobre suelo vacío, la cruz de mover sobre un pueblo. Comparado
     * antes de escribir porque esto corre en cada `pointermove` y una escritura
     * en `style` por evento invalida el estilo del lienzo sesenta veces por
     * segundo para dejarlo igual.
     */
    const wantCursor = movableAt(sx, sy) ? 'move' : 'grab';
    if (e.currentTarget.style.cursor !== wantCursor) e.currentTarget.style.cursor = wantCursor;

    // Hover inspector
    const m = screenToMap(sx, sy);
    if (!m) { setHover(null); return; }
    // The hamlets, farms, mills and named crags the deep tiles found. They are
    // drawn with a dot and a name; until this line the pointer knew nothing
    // about them and answered with the generic terrain reading instead.
    const hoveredPlace = deepPlaceAt(sx, sy);
    if (hoveredPlace) {
      setHover({
        x: Math.min(sx + 12, rect.width - 210),
        y: sy + 14,
        text: `${hoveredPlace.name} · ${PLACE_KIND_ES[hoveredPlace.kind]
          ? t(PLACE_KIND_ES[hoveredPlace.kind])
          : hoveredPlace.kind}`,
      });
      return;
    }
    const hoveredLandmark = landmarkAt(sx, sy);
    if (hoveredLandmark) {
      const left = Math.min(sx + 12, rect.width - 210);
      setHover({
        x: left,
        y: sy + 14,
        // Por el catálogo, como el accidente de abajo: `type` es 'hotspring',
        // no «Termas», y el sobrevuelo es lectura para el lector, no para
        // nosotros.
        text: `${hoveredLandmark.name} · ${kindLabel(hoveredLandmark.type)}`,
      });
      return;
    }
    /**
     * The TOWN, not the soil under it.
     *
     * The hover chain went straight from landmarks to the terrain readout, so
     * pointing at a capital answered "bosque templado · 340 m · 12 °C" — every
     * fact about the place itself sits on the `Settlement` and needed a
     * full-screen modal to see. Nothing in the 2D ever named a realm either,
     * even with the borders switched on.
     */
    const hoveredTown = settlementAt(sx, sy);
    if (hoveredTown && geography) {
      const realm = hoveredTown.realm >= 0 ? geography.realms[hoveredTown.realm] : undefined;
      const bits = [
        hoveredTown.name,
        RANK_ES[hoveredTown.rank] ? t(RANK_ES[hoveredTown.rank]) : hoveredTown.rank,
      ];
      if (hoveredTown.population) {
        bits.push(t('worldgen.hover.inhabitants')
          .replace('{n}', hoveredTown.population.toLocaleString('es')));
      }
      if (realm) bits.push(realm.name);
      if (hoveredTown.port) bits.push(t('worldgen.hover.port'));
      else if (hoveredTown.river) bits.push(t('worldgen.hover.onRiver'));
      setHover({ x: Math.min(sx + 12, rect.width - 260), y: sy + 14, text: bits.join(' · ') });
      return;
    }
    const hoveredNote = hitAt(sx, sy, ['note']);
    if (hoveredNote?.note) {
      setHover({ x: Math.min(sx + 12, rect.width - 240), y: sy + 14, text: hoveredNote.note });
      return;
    }
    const cx = Math.min(W - 1, Math.floor(m.u * W));
    const cy = Math.min(H - 1, Math.floor(m.v * H));
    const i = cy * W + cx;
    const e2 = world.elevation[i];
    /**
     * What is growing here.
     *
     * Por `biomeLocaleKey`, que cubre los 44 ids — la tabla local de 17 dejaba
     * manglar, estepa, erg y compañía cayendo al castellano del gazetteer en
     * una UI en inglés. `biomeName` queda de reserva para un id que ni el
     * catálogo conozca (un mundo guardado por una versión más nueva).
     */
    const biomeId = world.biome[i];
    const biomeK = biomeLocaleKey(biomeId);
    const biomeLabel = biomeK ? t(biomeK) : biomeName(biomeId);

    // Ask the canon, if the canon is what is on screen. One reading per cell of
    // ground, so a moving cursor asks a few times a second and not a few
    // hundred; the answer arrives for the NEXT frame of hovering, which at this
    // range is a few pixels away and reads as instant.
    const deep = tileLevel.current >= SAT_DEEP_Z && !!geography;
    /**
     * The GROUND and the WORLD, not the ground alone.
     *
     * Keyed on coordinates only, the cached reading outlived the thing it was a
     * reading of. Paint a coast, raise a range, load another world — the cursor
     * comes back to the same spot, the key matches, and the readout confidently
     * reports the height, the cover and the wetness of ground that no longer
     * exists. Nothing ever cleared it: `probe` is a ref, so it survives every
     * re-render, and the only write is this cache-miss path.
     *
     * `tileGeneration` is the same string the pyramid throws its tiles away on
     * — world identity, revision, the human counts and the canon — so the
     * reading is invalidated by exactly the events that make it wrong, and by
     * nothing else. A hover that has to ask again costs one worker round trip
     * and 70 ms of settle; a hover that answers from the previous world costs
     * the reader their trust in the readout.
     */
    const probeKey = deep
      ? `${tileGeneration.current}|${Math.round(m.u * W * 128)}:${Math.round(m.v * H * 128)}`
      : '';
    if (deep && probe.current?.key !== probeKey) {
      window.clearTimeout(probeTimer.current);
      const wx = m.u * W, wy = m.v * H;
      probeTimer.current = window.setTimeout(() => {
        const q = tileProps.current;
        if (!q.geography) return;
        regionClient
          .requestProbe(q.canonWorld ?? q.world, q.geography, wx, wy)
          .then((data) => { probe.current = { key: probeKey, data }; })
          .catch(() => { probe.current = { key: probeKey, data: null }; });
      }, 70);
    }
    const canon = deep && probe.current?.key === probeKey ? probe.current.data : null;

    const parts = canon
      ? [
        canon.water === 1 ? t('worldgen.cover.0') : canon.water === 2 ? t('worldgen.cover.1')
          // Through the catalogue. `COVER_LABEL_ES` is a Spanish-only table
          // that SHADOWED the already-translated biome name whenever canon
          // ground was resident — so the hover readout changed language as you
          // zoomed in, which is a stranger bug than either half of it.
          : (canon.cover in COVER_LABEL_ES ? t(`worldgen.cover.${canon.cover}`) : biomeLabel),
        `${Math.round(canon.elevationM)} m`,
        t('worldgen.hover.slope').replace('{n}', String(Math.round(canon.slope * 100))),
        canon.wet > 0.6
          ? t('worldgen.hover.waterlogged')
          : canon.wet > 0.35 ? t('worldgen.hover.damp') : t('worldgen.hover.dry'),
        t('worldgen.paint.units.mPerCell')
          .replace('{n}', String(Math.round(canon.metresPerCell))),
      ]
      : [
        biomeLabel,
        // With borders on and no realm ever named, the political layer was a
        // set of coloured lines around nothing. One lookup answers it.
        ...(geography && geography.realmOf[i] >= 0
          ? [geography.realms[geography.realmOf[i]]?.name ?? '']
          : []),
        e2 > 0
          ? `${Math.round(e2 * 1000)} m`
          : `−${Math.round(-e2 * 1000)} m`,
        `${Math.round(world.temperature[i])}°C`,
        `${Math.round(world.precipitation[i])} mm`,
      ];
    // Clamp here (event handler) so render never touches the container ref.
    const left = Math.min(sx + 12, rect.width - 210);
    setHover({ x: left, y: sy + 14, text: parts.join(' · ') });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.style.cursor = '';
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    // Soltar lo que iba en la mano, ANTES que nada: una mudanza se come el
    // gesto entero, así que ni abre el plano del pueblo ni deselecciona nada.
    // Si no llegó a ser mudanza, `dropMove` devuelve falso, limpia el agarre y
    // el clic sigue su camino de siempre.
    if (dropMove(sx, sy)) return;

    // A stroke becomes an edit on release, not per move: a terrain stroke costs
    // a few hundred milliseconds, which is fine once and unusable sixty times a
    // second.
    const pts = stroke.current;
    stroke.current = null;
    // The gesture is over however it ends: the ownership ref must not outlive it,
    // or a later world change would run `abandonLive` against a stroke that was
    // committed properly minutes ago.
    liveWorld.current = null;
    const press = pressAt.current;
    pressAt.current = null;
    if (pts) {
      const { tool: bt, onEdit: commit, geography: geo } = brushRef.current;
      // The Camino tool is not a brush and never was: it is two clicks on two
      // towns with an A* between them, and the routing lives in the parent.
      // A click made a one-point stroke, `commitPaintStroke` returns null for
      // one point, and the click therefore did NOTHING — while the status line
      // went on asking for a town it was impossible to pick. Let a click that
      // landed on a dot through to the picker; a drag still draws by hand.
      if (bt && bt.mode === 'road' && !negRef.current && onPickSettlement
        && (!press || Math.hypot(sx - press.x, sy - press.y) <= 4)) {
        const s = settlementAt(sx, sy);
        if (s) { onPickSettlement(s); scheduleDraw(); return; }
      }
      /**
       * The frontier brush and bucket commit HERE, before the generic path.
       *
       * `commitPaintStroke` has no `frontera` case and is not this view's to
       * change — one brush, three views, one translation. Reaching it would
       * return null and the whole gesture would do nothing at all, silently:
       * the same failure the Camino click above exists to prevent. So the
       * short-circuit is the same shape as that one.
       */
      if (bt && bt.mode === 'frontera' && commit) {
        // Ctrl is the universal negative and here it means UNCLAIMED — the one
        // "realm" every other one shares a frontier with. Read from the press,
        // like every other negative, so the stroke commits the direction the
        // reader watched it draw in.
        const own = negRef.current ? -1 : bt.realm;
        if (bt.realmTool === 'brush') {
          const st = realmBrushStroke(bt, pts);
          if (st) commit({ kind: 'realm', realm: own, stroke: st });
        } else if (bt.realmTool === 'fill'
          // A bucket is a CLICK. Dragging away from the press is how the reader
          // takes a mis-aimed one back before it costs them an undo — the same
          // four-pixel test the Camino click uses to tell the two apart.
          && (!press || Math.hypot(sx - press.x, sy - press.y) <= 4)) {
          // From where the button went DOWN, not where it came up: a click that
          // wobbled a cell still floods the ground the reader aimed at.
          const at = pts[0];
          commit({
            kind: 'realmFill',
            realm: own,
            x: at.x,
            y: at.y,
            bounded: bt.realmBound,
            maxCells: Math.max(REALM_FILL_FLOOR_CELLS, Math.round(W * H * REALM_FILL_SHARE)),
          });
        }
        scheduleDraw();
        return;
      }
      if (bt && isWaypointTool(bt)) {
        // A pin does not go into the edit list — see `isWaypointTool`.
        if (negRef.current) {
          const hit = waypointAt(sx, sy);
          if (hit) onRemoveWaypoint?.(hit.id);
        } else {
          const at = pts[pts.length - 1];
          onPlaceWaypoint?.(
            (((at.x / W) % 1) + 1) % 1,
            Math.min(1, Math.max(0, at.y / H)),
          );
        }
        scheduleDraw();
        return;
      }
      // A live biome stroke rolls back FIRST; the ordinary commit below then
      // replays it through the session — the stamp above guarantees the replay
      // lands on the same cells the reader just watched fill in.
      rollbackLiveBiome();
      const g = liveSculpt.current;
      if (g && commit) {
        // Roll the live deformation back and hand the stroke to the session,
        // exactly like the sculptor and the 3D brush: preview and replay agree
        // cell for cell, and rolling back anyway means the authoritative one
        // wins if they ever stop agreeing.
        liveSculpt.current = null;
        const total = g.dirty;
        g.rollback();
        patchLive(total);
        for (const ed of g.edits()) commit(ed as WorldEdit);
        scheduleDraw();
        return;
      }
      if (bt && commit) {
        const view = viewRef.current;
        const cellsPerPx = view ? W / Math.max(1, PW * view.scale) : 1;
        // Terrain and coast invert the OPERATION, everything else inverts at
        // commit time — one rule, resolved in the one place that knows both.
        const spec = negRef.current ? negativeOf(bt) : bt;
        // Sixteen pixels of aim error, in cells, UNFLOORED. `paintCommit`
        // clamps it: `NEGATIVE_REACH_CELLS` is the ceiling for the zoomed-out
        // case and a fraction of a cell the floor. The `Math.max(2, ...)` that
        // used to be here re-imposed the floor from the outside, which is how
        // Ctrl+clicking a label at street zoom deleted a generated town sixty
        // kilometres off screen.
        const reachCells = 16 * cellsPerPx;
        const why = commitRefusal(spec, { negative: negRef.current });
        if (why) {
          // A commit that returns null is dropped in silence — right for "the
          // pointer did not travel far enough", wrong for Rotulo with an empty
          // box, where the reader clicks, and clicks again, and nothing on
          // screen ever says why.
          setRefusal(t(why));
          scheduleDraw();
          return;
        }
        const edit = commitPaintStroke(spec, pts, {
          negative: negRef.current,
          reachCells,
          // Por la posición de ORIGEN de lo que se haya movido — ver
          // `sourcePointFor`, sin la cual un pueblo arrastrado queda fuera del
          // alcance del borrador para siempre.
          pickGenerated: (x, y) => {
            const at0 = sourcePointFor(x, y, reachCells);
            return pickGeneratedAt(world, geo, at0.x, at0.y, reachCells);
          },
        });
        if (edit) commit(edit);
      }
      scheduleDraw();
      return;
    }

    const drag = dragRef.current;
    dragRef.current = null;
    // Read and cleared together: the gesture is over either way, and a `panRef`
    // left standing would make the NEXT plain click a pan and swallow it.
    const panned = panRef.current;
    panRef.current = false;
    if (!drag) return;
    if (drag.moved) {
      // One more frame, now that the drag is over. Every frame of the pan was
      // drawn with `dragRef` set, so none of them asked the tile store to build
      // the window the map has just landed on — and reporting the camera does
      // not bring us a frame either, because the parent's echo is filtered out
      // as our own. Without this the pyramid stays at whatever was resident
      // when the hand went down.
      scheduleDraw();
      reportViewport();
      return;
    }
    // Only the left button selects. Without this the right button opened a
    // town's plan UNDER the browser's own context menu — see `onContextMenu`.
    if (e.button !== 0) return;
    // A pan that happened not to move is still not a click. The reader held
    // Espacio (or Mayúsculas) to reposition the map with a brush out and let go
    // without shifting it three pixels; answering that with "open this town's
    // plan", or with "the road starts here", is the second half of the bug
    // `panRef` exists for — and the more annoying half, because the map looks
    // exactly as it did and something else has changed.
    if (panned) return;
    // It was a click.
    const wp = waypointAt(sx, sy);
    if (wp) { onSelectWaypoint(wp.id); return; }
    // El nombre de una comarca guardada la abre — antes que el pueblo que
    // pueda haber debajo, porque el rótulo está fuera del marco y sólo puede
    // haberse pinchado a propósito.
    if (onOpenSavedRegion) {
      const rg = hitAt(sx, sy, ['note'], (h) => !!h.regionId);
      if (rg?.regionId) { onOpenSavedRegion(rg.regionId); return; }
    }
    const landmark = landmarkAt(sx, sy);
    if (landmark) {
      onSelectWaypoint(null);
      onSelectSpatialEntity?.(landmark);
      return;
    }
    // A town under the pointer opens its plan — the same gesture as on the
    // carta and in 3D, because it is the same question being asked.
    if (onPickSettlement) {
      const s = settlementAt(sx, sy);
      if (s) { onPickSettlement(s); return; }
    }
    onSelectWaypoint(null);
    onSelectSpatialEntity?.(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Double-click closes a frontier, before the zoom this gesture means
    // everywhere else — and it must, because the ring's last side is otherwise
    // only reachable by hitting a five-pixel handle or by knowing about Intro.
    const open = realmPoly.current;
    if (open) {
      // The second click of the double-click has ALREADY dropped a corner, on
      // top of the one the first click dropped. Committed, that is a
      // zero-length edge in the stored shape and a visible kink in the rounded
      // one; the reader clicked twice in one place and meant "finish", once.
      const n = open.pts.length;
      if (n >= 2 && Math.hypot(open.pts[n - 1].x - open.pts[n - 2].x,
        open.pts[n - 1].y - open.pts[n - 2].y) < 0.75) {
        open.pts.pop();
      }
      if (closeRealmPoly()) return;
    }
    if (brushing || !onZoomTo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    if (m) onZoomTo(m.u * W, m.v * H);
  };

  /**
   * The readout stays up while the FRONTIER tool is out.
   *
   * Every other brush hides it, and rightly: a box under the cursor is in the
   * way of the thing being painted. This is the one tool whose whole question —
   * whose ground is this, and whose will it be — has no other answer anywhere
   * on screen. The political wash is a hue, and a hue is not a name.
   */
  const showReadout = !brushing || tool?.mode === 'frontera';

  /**
   * WHAT THE WHEEL AND ALT ACTUALLY DO, for the tool that is actually out.
   *
   * One string used to be appended to every brush's hint: "Ctrl+rueda cambia el
   * tamaño · Alt toma el bioma". Both halves were promises the map only keeps
   * in one mode. Alt is the eyedropper and is guarded on `dropper?.mode ===
   * 'biome'`, so with Costa, Relieve, Río or Punto out, Alt+clic does not sample
   * anything — it PAINTS, which is the opposite of what the reader was told, and
   * it paints where they were only looking. And Ctrl+rueda has a size to change
   * only where `hasRadius` says so.
   *
   * A hint that names a key that does something else is worse than no hint: the
   * reader tries it once, the map changes under them, and now they distrust the
   * whole line. So each mode gets the part that is true of it and nothing else,
   * and Río and Punto — which have neither — get no tail at all.
   */
  const wheelHint = tool?.mode === 'biome'
    ? t('worldgen.map.brushWheelHint')
    : hasRadius(tool) ? t('worldgen.map.brushSizeHint') : '';

  /** La chuleta de navegación, detrás del botón «?» (Luis, 2026-08-12: el
   *  rótulo permanente tapaba media esquina inferior). */
  const [hintsOpen, setHintsOpen] = useState(false);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: brushing ? 'crosshair' : 'grab', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          rollbackLiveBiome();
          const g = liveSculpt.current;
          if (g) {
            liveSculpt.current = null;
            const total = g.dirty;
            g.rollback();
            patchLive(total);
          }
          // `dragRef` too: without it a cancelled PAN left the map following
          // the pointer forever with no button held down. `panRef` goes with
          // it — a stale one turns the next ordinary click into a pan that
          // selects nothing.
          stroke.current = null; brushAt.current = null; pressAt.current = null;
          dragRef.current = null; panRef.current = false;
          // Y lo que iba en la mano: un `pointercancel` con un pueblo cogido lo
          // dejaba siguiendo al puntero para siempre, sin botón apretado.
          moveRef.current = null;
          scheduleDraw();
        }}
        onPointerLeave={() => {
          setHover(null);
          if (brushAt.current) { brushAt.current = null; scheduleDraw(); }
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {hover && showReadout && (
        <div
          className="absolute z-10 pointer-events-none px-2 py-1 rounded-md bg-surface/95 border border-border text-[11px] text-text-primary whitespace-nowrap shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.text}
        </div>
      )}
      {/* Los avisos de HERRAMIENTA se enseñan solos (son cortos y van con el
          gesto); la chuleta de navegación vive detrás del botón «?» — a
          pantalla completa tapaba media esquina, incluido el HUD de
          depuración (Luis, 2026-08-12). */}
      {(refusal || brushing) && (
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md border border-white/20 bg-[#0b0e14]/92 text-[11px] leading-snug text-white shadow-lg shadow-black/50 backdrop-blur-sm pointer-events-none">
          {refusal
            ? refusal
            : (tool?.mode === 'road'
              ? `${roadFrom
                ? t('worldgen.map.roadFrom').replace('{name}', roadFrom.name)
                : t('worldgen.map.roadStart')} · ${t('worldgen.map.roadHintTail')}`
              // The lasso is the only gesture in this view that spans several
              // clicks, and Intro / Retroceso / Esc are the only ways out of it.
              // A key nothing on screen mentions is a key nobody presses — and a
              // reader who cannot finish a shape cannot abandon one either.
              : tool?.mode === 'frontera'
                ? (tool.realmTool === 'brush'
                  ? t('worldgen.map.realmBrushHint')
                  : tool.realmTool === 'fill'
                    ? t('worldgen.map.realmFillHint')
                    : t('worldgen.map.realmPolyHint'))
                : `${t('worldgen.map.paintHint')}${wheelHint ? ` · ${wheelHint}` : ''}`)}
        </div>
      )}
      {!refusal && !brushing && (
        <div className="absolute bottom-2 left-2 flex items-end gap-1.5">
          <button
            onClick={() => setHintsOpen((o) => !o)}
            title={t('worldgen.hints.button')}
            className={`w-6 h-6 rounded-full border text-[12px] font-semibold shadow-lg shadow-black/50 backdrop-blur-sm transition ${
              hintsOpen
                ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                : 'bg-[#0b0e14]/92 border-white/20 text-white/70 hover:text-white'
            }`}
          >?</button>
          {hintsOpen && (
            <div className="px-2 py-1 rounded-md border border-white/20 bg-[#0b0e14]/92 text-[11px] leading-snug text-white shadow-lg shadow-black/50 backdrop-blur-sm max-w-[720px]">
              <span className="block">
                {t('worldgen.map.panHint')}
                {onEdit ? ` · ${t('worldgen.map.moveHint')}` : ''}
                {onPickSettlement ? ` · ${t('worldgen.mapHint.town')}` : ''}
              </span>
              <span className="block text-white/60">{t('worldgen.map.cameraHint')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function clampView(view: ViewState, cw: number, ch: number, PW: number, PH: number, wraps: boolean): void {
  const mapW = PW * view.scale;
  const mapH = PH * view.scale;
  const marginY = Math.min(ch * 0.4, mapH * 0.6);
  if (mapH <= ch) {
    view.oy = Math.max(-mapH * 0.5, Math.min(ch - mapH * 0.5, view.oy));
  } else {
    view.oy = Math.max(ch - mapH - marginY, Math.min(marginY, view.oy));
  }
  if (!wraps) {
    const marginX = Math.min(cw * 0.4, mapW * 0.6);
    if (mapW <= cw) {
      view.ox = Math.max(-mapW * 0.5, Math.min(cw - mapW * 0.5, view.ox));
    } else {
      view.ox = Math.max(cw - mapW - marginX, Math.min(marginX, view.ox));
    }
  }
}

function makeRegionalTerrainCanvas(region: RegionData): HTMLCanvasElement {
  const visible = regionVisibleRect(region);
  const width = Math.max(1, Math.round(visible.width));
  const height = Math.max(1, Math.round(visible.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(region.height - 1, region.margin + y);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(region.width - 1, region.margin + x);
      const source = sy * region.width + sx;
      const output = (y * width + x) * 4;
      let color = BIOME_COLORS[region.biome[source]] ?? [116, 120, 105];
      if (region.water[source] === 1) color = [48, 90, 126];
      else if (region.water[source] === 2) color = [67, 112, 142];
      const left = region.elevation[sy * region.width + Math.max(0, sx - 1)];
      const up = region.elevation[Math.max(0, sy - 1) * region.width + sx];
      const here = region.elevation[source];
      const shade = Math.min(1.24, Math.max(0.68, 0.98 + (left + up - here * 2) * 18));
      rgba[output] = Math.round(color[0] * shade);
      rgba[output + 1] = Math.round(color[1] * shade);
      rgba[output + 2] = Math.round(color[2] * shade);
      rgba[output + 3] = 255;
    }
  }
  // Igual que en `makeCanvas`: contexto null = ráster en blanco un fotograma,
  // nunca un TypeError dentro del dibujo.
  canvas.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function drawRegionalEntity(
  ctx: CanvasRenderingContext2D,
  entity: WorldSpatialEntity,
  x: number,
  y: number,
  selected: boolean,
): void {
  const natural = ['volcano', 'cave', 'waterfall', 'gorge', 'hotspring'].includes(entity.type);
  if (natural) {
    drawLandmark(ctx, entity, x, y, selected);
    return;
  }
  const size = Math.min(2, Math.max(0.7, entity.style.size ?? 1));
  const important = entity.type === 'town' || entity.type === 'village'
    || entity.type === 'abbey' || entity.type === 'tower';
  ctx.beginPath();
  if (important) {
    ctx.rect(x - 3 * size, y - 3 * size, 6 * size, 6 * size);
  } else {
    ctx.arc(x, y, 2.5 * size, 0, Math.PI * 2);
  }
  ctx.fillStyle = entity.style.color ?? (important ? '#f0dfbc' : '#c8b78e');
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? '#f5c66a' : 'rgba(6,8,13,0.9)';
  ctx.stroke();
}

function drawLandmark(
  ctx: CanvasRenderingContext2D,
  entity: WorldSpatialEntity,
  x: number,
  y: number,
  selected: boolean,
): void {
  const scale = Math.min(2.4, Math.max(0.65, entity.style.size ?? 1));
  const screenX = x;
  const screenY = y;
  const lm = {
    type: (entity.style.icon ?? entity.type) as LandmarkType,
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  x = 0;
  y = 0;
  ctx.lineWidth = 1.2;
  switch (lm.type) {
    case 'volcano': {
      ctx.beginPath();
      ctx.moveTo(x, y - 5.5);
      ctx.lineTo(x + 5, y + 4);
      ctx.lineTo(x - 5, y + 4);
      ctx.closePath();
      ctx.fillStyle = '#8a3a30';
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,7,13,0.8)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 5, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#e4a853';
      ctx.fill();
      break;
    }
    case 'cave': {
      ctx.beginPath();
      ctx.arc(x, y + 2, 5, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#2a2a3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,229,224,0.7)';
      ctx.stroke();
      break;
    }
    case 'waterfall': {
      ctx.strokeStyle = '#7fc0dd';
      ctx.lineWidth = 1.6;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 2.4, y - 4);
        ctx.lineTo(x + k * 2.4, y + 3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x - 4.5, y + 4.5);
      ctx.quadraticCurveTo(x, y + 6.5, x + 4.5, y + 4.5);
      ctx.stroke();
      break;
    }
    case 'gorge': {
      ctx.strokeStyle = '#a06a3c';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 3.5);
      ctx.lineTo(x - 1.5, y + 3.5);
      ctx.moveTo(x + 5, y - 3.5);
      ctx.lineTo(x + 1.5, y + 3.5);
      ctx.stroke();
      break;
    }
    case 'hotspring': {
      ctx.beginPath();
      ctx.arc(x, y + 1.5, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#d585a8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,7,13,0.8)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,229,224,0.85)';
      ctx.lineWidth = 1.1;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 2.2, y - 1.5);
        ctx.quadraticCurveTo(x + k * 2.2 + 1, y - 3.5, x + k * 2.2, y - 5.5);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
  if (entity.style.color) {
    ctx.beginPath();
    ctx.arc(screenX, screenY, 7 * scale, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = entity.style.color;
    ctx.stroke();
  }
  if (selected) {
    ctx.beginPath();
    ctx.arc(screenX, screenY, 9 * scale, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f5c66a';
    ctx.stroke();
  }
}
