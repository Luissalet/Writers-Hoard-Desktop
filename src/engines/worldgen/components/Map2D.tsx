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
import type { WorldData, ViewMode, Landmark } from '../core/types';
import { renderBase, renderRivers } from '../core/render';
import { PROJECTIONS, reprojectRgba, type Projection } from '../core/projections';
import { commitPaintStroke, isWaypointTool, negativeOf, pickGeneratedAt } from '../core/paintCommit';
import type { Pt, WorldEdit } from '../core/edits';
import type { HumanGeography, Settlement } from '../core/settlements';
import type { WorldWaypoint } from '../types';
import type { PaintTool } from './PaintPanel';

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
  /** Placing a pin is the Punto tool with Chincheta selected, not a mode of
   *  its own. Both take normalized coordinates, which is how a pin is stored. */
  onPlaceWaypoint?: (u: number, v: number) => void;
  onRemoveWaypoint?: (id: string) => void;
  onSelectWaypoint: (id: string | null) => void;
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
  onOpenRegion?: (x: number, y: number) => void;
  /** Bumped when an edit changed the world under us, so the raster is rebuilt. */
  revision?: number;
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
  geography, showSettlements, tool, onEdit, onPickSettlement, onOpenRegion, revision = 0,
}: Map2DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const rafRef = useRef(0);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  /** Cells the pointer has crossed this stroke, and where the ring is drawn. */
  const stroke = useRef<Pt[] | null>(null);
  const brushAt = useRef<{ x: number; y: number } | null>(null);
  /** Ctrl at the moment the gesture started: the negative of whatever is out. */
  const negRef = useRef(false);
  const spaceRef = useRef(false);
  const brushing = !!tool && tool.mode !== 'off' && !!onEdit;
  const brushRef = useRef({ tool, onEdit, geography, brushing });
  brushRef.current = { tool, onEdit, geography, brushing };

  const W = world.width, H = world.height;
  const spec = PROJECTIONS[projection];
  const wraps = spec.wraps;

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

  const PW = baseCanvas.width, PH = baseCanvas.height;

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

    // Copies for wrap-around; single sheet otherwise.
    let firstOx = view.ox;
    let lastOx = view.ox;
    if (wraps) {
      firstOx = view.ox % mapW;
      if (firstOx > 0) firstOx -= mapW;
      lastOx = cw;
    }

    ctx.imageSmoothingEnabled = scale < 3;
    ctx.imageSmoothingQuality = 'high';

    for (let ox = firstOx; ox <= lastOx; ox += mapW) {
      ctx.drawImage(baseCanvas, ox, view.oy, mapW, mapH);
      if (showRivers && viewMode !== 'plates' && viewMode !== 'flow') {
        ctx.drawImage(riverCanvas, ox, view.oy, mapW, mapH);
      }
      if (!wraps) break;
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
        for (const lm of world.landmarks) {
          const [sx, sy] = toScreen((lm.x + 0.5) / W, (lm.y + 0.5) / H, copyOx);
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
          drawLandmark(ctx, lm, sx, sy);
        }
      }
    }

    // Towns. Drawn before the waypoints so a pin the reader placed is never
    // hidden behind a dot the generator placed.
    if (showSettlements && geography) {
      // Only as much of the gazetteer as the zoom can carry: every village at
      // full extent is a grey smear along every coast.
      const maxRank = scale < 1.4 ? 1 : scale < 4 ? 2 : 3;
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
          if (rank <= 1 || scale > 6) {
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(6,8,13,0.85)';
            ctx.strokeText(s.name, sx + r + 5, sy);
            ctx.fillStyle = '#f6efe0';
            ctx.fillText(s.name, sx + r + 5, sy);
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

    // The brush ring, last, over everything. Two circles: where the stroke
    // stops, and where it stops being at full strength — softness is otherwise a
    // number you set and then discover the effect of.
    const at = brushAt.current;
    const bt = brushRef.current.tool;
    if (at && bt && brushRef.current.brushing) {
      const pxPerCell = (PW * scale) / W;
      const rOuter = Math.max(3, bt.radius * pxPerCell);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(10,12,18,0.75)';
      ctx.beginPath();
      ctx.arc(at.x, at.y, rOuter + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(at.x, at.y, rOuter, 0, Math.PI * 2);
      ctx.stroke();
      const rInner = rOuter * (1 - Math.min(0.98, bt.softness));
      if (rInner > 2) {
        ctx.strokeStyle = 'rgba(255,220,140,0.75)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(at.x, at.y, rInner, 0, Math.PI * 2);
        ctx.stroke();
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
        const scale = Math.min(rect.width / PW, rect.height / PH) * 0.98;
        viewRef.current = {
          scale,
          ox: (rect.width - PW * scale) / 2,
          oy: (rect.height - PH * scale) / 2,
        };
      }
      scheduleDraw();
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [PW, PH, projection, scheduleDraw]);

  // Redraw on layer/props changes (also keeps drawRef current).
  useEffect(() => {
    drawRef.current = draw;
    scheduleDraw();
  });

  // Wheel zoom — non-passive listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const minScale = Math.min(rect.width / PW, rect.height / PH) * 0.5;
      const newScale = Math.max(minScale, Math.min(28, view.scale * factor));
      const k = newScale / view.scale;
      view.ox = mx - (mx - view.ox) * k;
      view.oy = my - (my - view.oy) * k;
      view.scale = newScale;
      clampView(view, rect.width, rect.height, PW, PH, wraps);
      scheduleDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [PW, PH, wraps, scheduleDraw]);

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
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    negRef.current = e.ctrlKey || e.metaKey;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (brushing && e.button === 0 && !spaceRef.current && !e.shiftKey) {
      const m = screenToMap(sx, sy);
      if (!m) return;
      stroke.current = [{ x: m.u * W, y: m.v * H }];
      brushAt.current = { x: sx, y: sy };
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
      brushAt.current = { x: sx, y: sy };
      const pts = stroke.current;
      if (pts) {
        const m = screenToMap(sx, sy);
        if (m) {
          const p = { x: m.u * W, y: m.v * H };
          const last = pts[pts.length - 1];
          // One point per half-cell keeps the serialized edit small enough to
          // store a hundred strokes.
          if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) pts.push(p);
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
    const cx = Math.min(W - 1, Math.floor(m.u * W));
    const cy = Math.min(H - 1, Math.floor(m.v * H));
    const i = cy * W + cx;
    const e2 = world.elevation[i];
    const biomeKey = BIOME_KEYS[world.biome[i]] ?? 'ocean';
    const parts = [
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
    if (!drag || drag.moved) return;
    // It was a click.
    const wp = waypointAt(sx, sy);
    if (wp) { onSelectWaypoint(wp.id); return; }
    // A town under the pointer opens its plan — the same gesture as on the
    // carta and in 3D, because it is the same question being asked.
    if (onPickSettlement) {
      const s = settlementAt(sx, sy);
      if (s) { onPickSettlement(s); return; }
    }
    onSelectWaypoint(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (brushing || !onOpenRegion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    if (m) onOpenRegion(m.u * W, m.v * H);
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
        onPointerCancel={() => { stroke.current = null; brushAt.current = null; scheduleDraw(); }}
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

function drawLandmark(ctx: CanvasRenderingContext2D, lm: Landmark, x: number, y: number): void {
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
}
