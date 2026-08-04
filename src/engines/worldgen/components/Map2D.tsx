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
import type { LandmarkType, WorldData, ViewMode } from '../core/types';
import { BIOME_COLORS, renderAtlasWindow, renderBase, renderRivers, updateAtlasCells } from '../core/render';
import { SculptGesture } from '../sculpt/ops';
import { PROJECTIONS, reprojectRgba, type Projection } from '../core/projections';
import { commitPaintStroke, isWaypointTool, negativeOf, pickGeneratedAt, restriction } from '../core/paintCommit';
import type { Pt, Stroke, WorldEdit } from '../core/edits';
import { filterFor } from '../core/edits';
import { strokeMask } from '../sculpt/ops';
import { Biome } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import type { WorldViewport, WorldWaypoint } from '../types';
import { tipOf, tipOutline } from '../sculpt/ops';
import type { PaintTool } from './PaintPanel';
import {
  resolveWorldLandmarks,
  type WorldSpatialEntity,
} from '../core/spatialEntities';
import { declutterLabels, semanticZoomProfile } from '../core/semanticZoom';
import { DisplayTileStore } from '../cartography/tileStore';
import { levelFor, tileId, TILE_PX, type TileKey } from '../cartography/tiles';
import { MAX_SAT_TILE_Z, SAT_DEEP_Z } from '../region/satelliteTile';
import { regionClient } from '../region/client';
import type { TilePlace } from '../region/deepTile';
import { COVER_LABEL_ES } from '../region/types';
import type { RegionData } from '../region/types';
import { regionVisibleRect } from '../region/coordinates';
import { EARTH_KM, MIN_SPAN_KM, clampViewport, flightAt, FLIGHT_MS, type FlyTarget } from '../core/camera';

export const BIOME_KEYS = [
  'ocean', 'lake', 'iceCap', 'tundra', 'boreal', 'tempForest', 'tempRain',
  'grassland', 'shrubland', 'savanna', 'tropForest', 'tropRain', 'desert',
  'coldDesert', 'alpine', 'glacier', 'beach', 'saltFlat',
] as const;

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
}

interface ViewState {
  scale: number; // screen px per projected-map px
  ox: number;    // screen offset of map X=0
  oy: number;
}

function makeCanvas(px: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return c;
}

export default function Map2D({
  world, viewMode, projection, showRivers, showLandmarks, showWaypoints, showGrid,
  waypoints, selectedWaypointId, onPlaceWaypoint, onRemoveWaypoint, onSelectWaypoint,
  selectedSpatialKey, regionalEntities = [], regionDetail, onSelectSpatialEntity,
  geography, showSettlements, tool, onEdit, onPickSettlement, onZoomTo,
  viewport, onViewportChange, flyTarget, revision = 0, canonWorld, canonEdits,
}: Map2DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const rafRef = useRef(0);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  /** Cells the pointer has crossed this stroke, and where the ring is drawn. */
  const stroke = useRef<Pt[] | null>(null);
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
  const spaceRef = useRef(false);
  const brushing = !!tool && tool.mode !== 'off' && !!onEdit;
  const brushRef = useRef({ tool, onEdit, geography, brushing });
  brushRef.current = { tool, onEdit, geography, brushing };

  const W = world.width, H = world.height;
  const spec = PROJECTIONS[projection];
  const wraps = spec.wraps;
  const landmarks = useMemo(
    () => resolveWorldLandmarks(world),
    // The edit pipeline mutates the same world object and bumps revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, revision],
  );
  const visibleSpatialEntities = useMemo(
    () => [...landmarks, ...regionalEntities.filter((entity) => !entity.hidden)],
    [landmarks, regionalEntities],
  );

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
  const tileStore = useMemo(() => new DisplayTileStore(
    (key: TileKey) => {
      const q = tileProps.current;
      if (!q.geography) return Promise.resolve(null);
      const deep = key.z >= SAT_DEEP_Z && !!q.canonWorld;
      return regionClient.requestTile(
        deep ? q.canonWorld! : q.world,
        q.geography,
        key,
        {
          ink: 'satellite',
          themeId: 'satellite',
          layers: { rivers: q.showRivers, roads: true, fields: true },
          density: 1,
          reliefAmount: 1,
          edits: deep ? q.canonEdits : undefined,
        },
      ).promise.then((res) => {
        if (!res) return null;
        if (res.places?.length) {
          const places = deepPlaces.current;
          places.set(tileId(key), res.places);
          if (places.size > 256) {
            const oldest = places.keys().next().value;
            if (oldest !== undefined) places.delete(oldest);
          }
        }
        return res.bitmap;
      }).catch(() => null);
    },
    () => requestDrawRef.current(),
  ), []);
  useEffect(() => () => tileStore.dispose(), [tileStore]);
  const tileGeneration = useRef('');
  /** Level the pyramid is drawing at, for the parts of the UI outside draw(). */
  const tileLevel = useRef(-1);

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
   * carries: with the canon behind it that is z18, one canon cell per 256-pixel
   * tile, about 0,6 m per pixel. Half a level of slack on top so the last level
   * can be magnified a little rather than stopping dead.
   */
  const maxScaleRef = useRef(28);
  const maxScale = useMemo(() => {
    const zTop = canonWorld && geography ? MAX_SAT_TILE_Z : 12;
    const usable = viewMode === 'atlas' && projection === 'equirect' && !!geography;
    if (!usable) return 28;
    return (TILE_PX * Math.pow(2, zTop) / world.width) * 1.4;
  }, [canonWorld, geography, viewMode, projection, world.width]);
  maxScaleRef.current = maxScale;

  /** Refresh the palette AND the sharp window over a freshly sculpted rect —
   *  the whole cost of a live brush move, a few hundred cells' worth. */
  const patchLive = useCallback((d: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!unshadedAtlas || d.x1 < d.x0 || d.y1 < d.y0) return;
    updateAtlasCells(world, unshadedAtlas, d.x0 - 1, d.y0 - 1, d.x1 + 1, d.y1 + 1);
    const sh = sharpSat.current;
    if (sh && sh.key === `${world.params.seed}:${revision}`) {
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
    return !!sh && !!v && v.scale >= 2.5 && sh.key === `${world.params.seed}:${revision}`;
  }, [world, revision]);

  /** Roll a live biome stroke back to the pre-stroke ground. */
  const rollbackLiveBiome = useCallback(() => {
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

  const reportViewport = useCallback(() => {
    if (!onViewportChange) return;
    const vp = computeViewport();
    if (vp) onViewportChange(vp);
  }, [computeViewport, onViewportChange]);

  // ---- drawing --------------------------------------------------------------
  const draw = () => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07070d';
    ctx.fillRect(0, 0, cw, ch);

    const { scale } = view;
    const mapW = PW * scale, mapH = PH * scale;
    const semantic = semanticZoomProfile(40075 * cw / Math.max(1, mapW));
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

    for (let ox = firstOx; ox <= lastOx; ox += mapW) {
      ctx.drawImage(baseCanvas, ox, view.oy, mapW, mapH);
      if (sharpEligible && sharpSat.current && sharpSat.current.key === `${world.params.seed}:${revision}`) {
        const sh = sharpSat.current;
        ctx.drawImage(sh.canvas, ox + sh.vx * scale, view.oy + sh.vy * scale, sh.vw * scale, sh.vh * scale);
      }
      if (showRivers && viewMode !== 'plates' && viewMode !== 'flow') {
        ctx.drawImage(riverCanvas, ox, view.oy, mapW, mapH);
      }

      if (!wraps) break;
    }

    // ---- the satellite pyramid ---------------------------------------------
    // Drawn OVER the world raster, never instead of it. The raster is the
    // fallback that is always there and always current — including mid-stroke,
    // when the brush has changed the ground under the reader's hand and no
    // tile can know it yet — and the pyramid covers it wherever a tile, or an
    // ancestor's quarter, is resident. Blurry then sharp, never blank.
    const tilesEligible = viewMode === 'atlas' && projection === 'equirect'
      && !!geography && !stroke.current;
    let tileZ = -1;
    if (!tilesEligible) tileLevel.current = -1;
    if (tilesEligible) {
      // A painted stroke is a different country: bumping the generation empties
      // the store rather than showing tiles of the world as it was.
      const gen = `${world.params.seed}:${revision}:${showRivers ? 1 : 0}:${canonWorld ? 1 : 0}`;
      if (gen !== tileGeneration.current) {
        tileGeneration.current = gen;
        deepPlaces.current.clear();
      }
      tileStore.setGeneration(gen);
      tileZ = levelFor(world, scale, canonWorld ? MAX_SAT_TILE_Z : 12);
      const tv = { x: -view.ox / scale, y: -view.oy / scale, w: cw / scale, h: ch / scale };
      tileLevel.current = tileZ;
      tileStore.want(world, tileZ, tv);
      const got = tileStore.draw(ctx, world, tileZ, tv, { x: 0, y: 0, w: cw, h: ch });
      // Say so when the ground under the reader is still an ancestor's blur.
      // A stroke empties the store — the canon has to be rebuilt with it — and
      // without a word of warning that reads as "the paint did nothing".
      if (got.exact < got.needed) {
        const msg = `terreno · ${got.exact}/${got.needed}`;
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

    // Book a fresh window once the view rests. Booked from draw() so any
    // gesture reschedules it; rendered synchronously after 170 ms of quiet,
    // which is the same "still, then real" contract the other views keep.
    if (sharpEligible) {
      const want = {
        x: -view.ox / scale, y: -view.oy / scale, w: cw / scale, h: ch / scale,
      };
      const cur = sharpSat.current;
      const key = `${world.params.seed}:${revision}`;
      const stale = !cur || cur.key !== key
        || Math.abs(cur.vx - want.x) > 1e-6 || Math.abs(cur.vy - want.y) > 1e-6
        || Math.abs(cur.vw - want.w) > 1e-6;
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
    if (regionalCanvas && regionDetail && semantic.showRegionalTerrain && !tilesEligible) {
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
    if (showGrid) {
      ctx.lineWidth = 1;
      for (const copyOx of copies) {
        // Parallels every 30°.
        for (let lat = -60; lat <= 60; lat += 30) {
          ctx.strokeStyle = lat === 0 ? 'rgba(232,229,224,0.28)' : 'rgba(232,229,224,0.14)';
          ctx.setLineDash(lat === 0 ? [] : [4, 4]);
          ctx.beginPath();
          const v = 0.5 - lat / 180;
          for (let k = 0; k <= 120; k++) {
            const [sx, sy] = toScreen(k / 120, v, copyOx);
            if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        // Meridians every 30°.
        ctx.strokeStyle = 'rgba(232,229,224,0.14)';
        ctx.setLineDash([4, 4]);
        for (let m = 0; m < 12; m++) {
          ctx.beginPath();
          for (let k = 0; k <= 60; k++) {
            const [sx, sy] = toScreen(m / 12, k / 60, copyOx);
            if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // Landmarks
    if (showLandmarks) {
      for (const copyOx of copies) {
        for (const lm of landmarks) {
          if (!semantic.showMinorLandmarks && lm.importance < 0.26) continue;
          const [sx, sy] = toScreen((lm.x + 0.5) / W, (lm.y + 0.5) / H, copyOx);
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
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

    if (regionalEntities.length && semantic.showRegionalTerrain) {
      ctx.font = '600 10px "Source Sans 3", sans-serif';
      for (const copyOx of copies) {
        for (const entity of regionalEntities) {
          if (entity.hidden) continue;
          const natural = entity.type === 'volcano' || entity.type === 'cave'
            || entity.type === 'waterfall' || entity.type === 'gorge'
            || entity.type === 'hotspring' || entity.kind === 'landmark';
          if ((natural && !showLandmarks) || (!natural && !showSettlements)) continue;
          const [sx, sy] = toScreen(
            ((entity.x / W) % 1 + 1) % 1,
            Math.min(1, Math.max(0, entity.y / H)),
            copyOx,
          );
          if (sx < -30 || sx > cw + 30 || sy < -20 || sy > ch + 20) continue;
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

    // Towns. Drawn before the waypoints so a pin the reader placed is never
    // hidden behind a dot the generator placed.
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
          if (rank > maxRank) continue;
          const [sx, sy] = toScreen((s.x + 0.5) / W, (s.y + 0.5) / H, copyOx);
          if (sx < -40 || sx > cw + 40 || sy < -20 || sy > ch + 20) continue;
          const r = rank === 0 ? 5 : rank === 1 ? 4 : rank === 2 ? 3 : 2.2;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = rank === 0 ? '#ffd479' : '#f4ead4';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(6,8,13,0.92)';
          ctx.stroke();
          if (rank === 0
              || (rank <= 1 && semantic.tier !== 'planetary')
              || (rank <= 2 && (semantic.tier === 'regional' || semantic.tier === 'local'))
              || semantic.tier === 'local') {
            queueLabel(
              s.name,
              sx + r + 5,
              sy,
              '#f6efe0',
              rank <= 1 ? 11 : 10,
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
    if (tilesEligible && tileZ >= SAT_DEEP_Z) {
      const prefix = `${tileZ}/`;
      for (const [id, places] of deepPlaces.current) {
        if (!id.startsWith(prefix)) continue;
        for (const p of places) {
          for (const copyOx of copies) {
            const [sx, sy] = toScreen(p.worldX / W, p.worldY / H, copyOx);
            if (sx < -80 || sx > cw + 80 || sy < -30 || sy > ch + 30) continue;
            const big = p.kind === 'town' || p.kind === 'village';
            ctx.beginPath();
            ctx.arc(sx, sy, big ? 3 : 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(20,18,14,0.75)';
            ctx.fill();
            queueLabel(
              p.name, sx + 5, sy, '#f2ecdd',
              big ? 11 : 9.5, big ? 600 : 500,
              40 + p.importance * 30,
            );
          }
        }
      }
    }

    // Waypoints
    if (showWaypoints) {
      ctx.font = '600 11px "Source Sans 3", sans-serif';
      for (const copyOx of copies) {
        for (const wp of waypoints) {
          const [sx, sy] = toScreen(wp.u, wp.v, copyOx);
          if (sx < -60 || sx > cw + 60 || sy < -30 || sy > ch + 30) continue;
          const selected = wp.id === selectedWaypointId;
          ctx.beginPath();
          ctx.arc(sx, sy, selected ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = wp.color;
          ctx.fill();
          ctx.lineWidth = selected ? 2 : 1.25;
          ctx.strokeStyle = selected ? '#e8e5e0' : 'rgba(7,7,13,0.85)';
          ctx.stroke();
          const label = wp.name;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(7, 7, 13, 0.72)';
          ctx.beginPath();
          ctx.roundRect(sx + 8, sy - 8, tw + 10, 16, 4);
          ctx.fill();
          ctx.fillStyle = selected ? '#e4a853' : '#e8e5e0';
          ctx.fillText(label, sx + 13, sy + 4);
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
          : bt0.mode === 'river'
            ? 'rgba(64,124,196,0.55)'
            : bt0.mode === 'land'
              ? (bt0.landOp === 'sea' ? 'rgba(38,74,128,0.45)' : 'rgba(196,176,128,0.5)')
              : bt0.mode === 'terrain'
                ? (bt0.terrainOp === 'lower' ? 'rgba(30,34,44,0.4)' : 'rgba(255,255,255,0.35)')
                : null;
        if (tint) {
          // Screen position through the RING'S anchor, so the preview stays on
          // the copy of the world the pointer is actually over when the map
          // wraps — the same trick the cursor outline uses.
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

    // The brush ring, last, over everything. Two circles: where the stroke
    // stops, and where it stops being at full strength — softness is otherwise a
    // number you set and then discover the effect of.
    const at = brushAt.current;
    const bt = brushRef.current.tool;
    if (at && bt && brushRef.current.brushing) {
      const pxPerCell = (PW * scale) / W;
      const tip = tipOf(bt as unknown as Stroke);
      // The ring is the shape of the HEAD. `tipOutline` solves the rim in the
      // same metric the brush culls with, so the outline and the paint are one
      // figure — a circle drawn over a square brush is just a wrong answer.
      const ring = (rCells: number) => {
        const pts2 = tipOutline(tip, Math.max(0.6, rCells), at.cx, at.cy, 96);
        ctx.beginPath();
        for (let k = 0; k < pts2.length; k++) {
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
    };
  }, [PW, PH, projection, scheduleDraw, spec, wraps]);

  // Redraw on layer/props changes (also keeps drawRef current).
  useEffect(() => {
    drawRef.current = draw;
    // The store calls this when a tile lands, so the interim gets one more
    // blit with the new tile in it. Through a ref, or the closure the store
    // was built with goes stale on the first re-render.
    requestDrawRef.current = scheduleDraw;
    scheduleDraw();
  });

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

  useEffect(() => {
    if (!flyTarget) return;
    const from = computeViewport();
    if (!from) return;
    cancelFlight();
    const to = clampViewport({ u: flyTarget.u, v: flyTarget.v, spanKm: flyTarget.spanKm ?? from.spanKm });
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
    return cancelFlight;
    // The token IS the request; everything else is read fresh when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget?.token]);

  // Wheel zoom — non-passive listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
  }, [PW, PH, wraps, scheduleDraw, reportViewport, cancelFlight, maxScale]);

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
    const view = viewRef.current;
    if (!view) return null;
    const mapW = PW * view.scale, mapH = PH * view.scale;
    for (const wp of waypoints) {
      const [X, Y] = spec.forward(wp.u, wp.v);
      const wy = view.oy + Y * mapH;
      let wx = view.ox + X * mapW;
      if (wraps) {
        const dxRaw = (((sx - wx) % mapW) + mapW) % mapW;
        const dx = dxRaw > mapW / 2 ? dxRaw - mapW : dxRaw;
        wx = sx - dx;
      }
      if (Math.hypot(sx - wx, sy - wy) < 9) return wp;
    }
    return null;
  };

  const landmarkAt = (sx: number, sy: number): WorldSpatialEntity | null => {
    const view = viewRef.current;
    if (!view || !showLandmarks) return null;
    const mapW = PW * view.scale, mapH = PH * view.scale;
    let best: { entity: WorldSpatialEntity; distance: number } | null = null;
    for (const entity of visibleSpatialEntities) {
      if (entity.source === 'regional' && !regionDetail) continue;
      const [X, Y] = spec.forward((entity.x + 0.5) / W, (entity.y + 0.5) / H);
      const py = view.oy + Y * mapH;
      let px = view.ox + X * mapW;
      if (wraps) {
        const dxRaw = (((sx - px) % mapW) + mapW) % mapW;
        px = sx - (dxRaw > mapW / 2 ? dxRaw - mapW : dxRaw);
      }
      const distance = Math.hypot(sx - px, sy - py);
      const reach = 9 * Math.max(0.75, entity.style.size ?? 1);
      if (distance <= reach && (!best || distance < best.distance)) {
        best = { entity, distance };
      }
    }
    return best?.entity ?? null;
  };

  // Space suspends the brush for as long as it is held, the way every paint
  // program does it, so the reader can reposition mid-drawing without changing
  // tool. Ctrl+Z goes to the world's own history, which is shared with 3D.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(e.shiftKey ? 'wg-redo' : 'wg-undo'));
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /** The nearest town to a screen point, within a screen-sized reach. */
  const settlementAt = (sx: number, sy: number): Settlement | null => {
    const view = viewRef.current;
    if (!view || !geography) return null;
    const mapW = PW * view.scale, mapH = PH * view.scale;
    let best: Settlement | null = null;
    let bestD = 14 * 14;
    const bias: Record<string, number> = { capital: 0.45, city: 0.65, town: 0.85, village: 1 };
    for (const s of geography.settlements) {
      const [X, Y] = spec.forward((s.x + 0.5) / W, (s.y + 0.5) / H);
      const py = view.oy + Y * mapH;
      let px = view.ox + X * mapW;
      if (wraps) {
        const dxRaw = (((sx - px) % mapW) + mapW) % mapW;
        px = sx - (dxRaw > mapW / 2 ? dxRaw - mapW : dxRaw);
      }
      const d = ((sx - px) ** 2 + (sy - py) ** 2) * (bias[s.rank] ?? 1);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  // ---- pointer events ----------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    cancelFlight();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    negRef.current = e.ctrlKey || e.metaKey;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (brushing && e.button === 0 && !spaceRef.current && !e.shiftKey) {
      const m = screenToMap(sx, sy);
      if (!m) return;
      const p0 = { x: m.u * W, y: m.v * H };
      stroke.current = [p0];
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
        const g = new SculptGesture(world.elevation, W, H, world.params.seed, {
          kind: spec.mode as 'terrain' | 'land',
          op: spec.mode === 'land' ? spec.landOp : spec.terrainOp,
          radius: spec.radius, strength: spec.strength, softness: spec.softness,
        });
        liveSculpt.current = g;
        patchLive(g.extend(p0));
      }
      scheduleDraw();
      return;
    }
    if (!brushing) e.currentTarget.style.cursor = 'grabbing';
    dragRef.current = { x: sx, y: sy, ox: view.ox, oy: view.oy, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    // The ring follows the pointer whenever a brush is out, button down or not:
    // without it the reader cannot tell how big the next stroke is.
    if (brushing) {
      const mp = screenToMap(sx, sy);
      brushAt.current = { x: sx, y: sy, cx: (mp?.u ?? 0) * W, cy: (mp?.v ?? 0) * H };
      const pts = stroke.current;
      if (pts) {
        const m = screenToMap(sx, sy);
        if (m) {
          const p = { x: m.u * W, y: m.v * H };
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
      setHover(null);
      scheduleDraw();
      return;
    }
    if (brushAt.current) { brushAt.current = null; scheduleDraw(); }

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
    // Hover inspector
    const m = screenToMap(sx, sy);
    if (!m) { setHover(null); return; }
    const hoveredLandmark = landmarkAt(sx, sy);
    if (hoveredLandmark) {
      const left = Math.min(sx + 12, rect.width - 210);
      setHover({
        x: left,
        y: sy + 14,
        text: `${hoveredLandmark.name} · ${hoveredLandmark.type}`,
      });
      return;
    }
    const cx = Math.min(W - 1, Math.floor(m.u * W));
    const cy = Math.min(H - 1, Math.floor(m.v * H));
    const i = cy * W + cx;
    const e2 = world.elevation[i];
    const biomeKey = BIOME_KEYS[world.biome[i]] ?? 'ocean';

    // Ask the canon, if the canon is what is on screen. One reading per cell of
    // ground, so a moving cursor asks a few times a second and not a few
    // hundred; the answer arrives for the NEXT frame of hovering, which at this
    // range is a few pixels away and reads as instant.
    const deep = tileLevel.current >= SAT_DEEP_Z && !!geography;
    const probeKey = deep
      ? `${Math.round(m.u * W * 128)}:${Math.round(m.v * H * 128)}`
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
        canon.water === 1 ? 'mar' : canon.water === 2 ? 'lago'
          : (COVER_LABEL_ES[canon.cover] ?? t(`worldgen.biome.${biomeKey}`)),
        `${Math.round(canon.elevationM)} m`,
        `${Math.round(canon.slope * 100)} % pdte.`,
        canon.wet > 0.6 ? 'encharcado' : canon.wet > 0.35 ? 'húmedo' : 'seco',
        `${Math.round(canon.metresPerCell)} m/celda`,
      ]
      : [
        t(`worldgen.biome.${biomeKey}`),
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

    // A stroke becomes an edit on release, not per move: a terrain stroke costs
    // a few hundred milliseconds, which is fine once and unusable sixty times a
    // second.
    const pts = stroke.current;
    stroke.current = null;
    if (pts) {
      const { tool: bt, onEdit: commit, geography: geo } = brushRef.current;
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
        const edit = commitPaintStroke(spec, pts, {
          negative: negRef.current,
          pickGenerated: (x, y) => pickGeneratedAt(world, geo, x, y, Math.max(2, 16 * cellsPerPx)),
        });
        if (edit) commit(edit);
      }
      scheduleDraw();
      return;
    }

    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      reportViewport();
      return;
    }
    // It was a click.
    const wp = waypointAt(sx, sy);
    if (wp) { onSelectWaypoint(wp.id); return; }
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
    if (brushing || !onZoomTo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    if (m) onZoomTo(m.u * W, m.v * H);
  };

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
          stroke.current = null; brushAt.current = null; scheduleDraw();
        }}
        onPointerLeave={() => {
          setHover(null);
          if (brushAt.current) { brushAt.current = null; scheduleDraw(); }
        }}
        onDoubleClick={handleDoubleClick}
      />
      {hover && !brushing && (
        <div
          className="absolute z-10 pointer-events-none px-2 py-1 rounded-md bg-surface/95 border border-border text-[11px] text-text-primary whitespace-nowrap shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.text}
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md border border-white/20 bg-[#0b0e14]/92 text-[11px] leading-snug text-white shadow-lg shadow-black/50 backdrop-blur-sm pointer-events-none">
        {brushing
          ? 'arrastra para pintar · Espacio para mover el mapa · Ctrl+Z deshace'
          : `${t('worldgen.mapHint')}${onPickSettlement ? ' · clic en una ciudad abre su plano · doble clic baja a la comarca' : ''}`}
      </div>
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
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
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
