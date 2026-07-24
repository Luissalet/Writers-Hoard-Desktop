// ============================================
// World Generator — 2D atlas map (canvas)
// ============================================
// Pan/zoom canvas with seamless east–west wrap, overlay layers (rivers,
// landmarks, waypoints, graticule) and a hover inspector that tells writers
// what any point on the planet is: biome, elevation, climate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldData, ViewMode, Landmark } from '../core/types';
import { renderBase, renderRivers } from '../core/render';
import type { WorldWaypoint } from '../types';

export const BIOME_KEYS = [
  'ocean', 'lake', 'iceCap', 'tundra', 'boreal', 'tempForest', 'tempRain',
  'grassland', 'shrubland', 'savanna', 'tropForest', 'tropRain', 'desert',
  'coldDesert', 'alpine', 'glacier', 'beach', 'saltFlat',
] as const;

interface Map2DProps {
  world: WorldData;
  viewMode: ViewMode;
  showRivers: boolean;
  showLandmarks: boolean;
  showWaypoints: boolean;
  showGrid: boolean;
  waypoints: WorldWaypoint[];
  selectedWaypointId: string | null;
  placing: boolean;
  onPlace: (u: number, v: number) => void;
  onSelectWaypoint: (id: string | null) => void;
  onFlyTo: (u: number, v: number) => void;
}

interface ViewState {
  scale: number; // screen px per map cell
  ox: number;    // screen offset of map x=0
  oy: number;
}

export default function Map2D({
  world, viewMode, showRivers, showLandmarks, showWaypoints, showGrid,
  waypoints, selectedWaypointId, placing, onPlace, onSelectWaypoint, onFlyTo,
}: Map2DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const rafRef = useRef(0);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const W = world.width, H = world.height;

  // Offscreen layers — rebuilt when the world or view mode changes.
  const baseCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d')!.putImageData(new ImageData(renderBase(world, viewMode), W, H), 0, 0);
    return c;
  }, [world, viewMode, W, H]);

  const riverCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d')!.putImageData(new ImageData(renderRivers(world), W, H), 0, 0);
    return c;
  }, [world, W, H]);

  // --- drawing ------------------------------------------------------------
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
    const mapW = W * scale, mapH = H * scale;
    // Wrap ox into [-mapW, 0) so at most 3 copies cover the screen.
    let baseOx = view.ox % mapW;
    if (baseOx > 0) baseOx -= mapW;

    ctx.imageSmoothingEnabled = scale < 3;
    ctx.imageSmoothingQuality = 'high';

    for (let ox = baseOx; ox < cw; ox += mapW) {
      ctx.drawImage(baseCanvas, ox, view.oy, mapW, mapH);
      if (showRivers && viewMode !== 'plates' && viewMode !== 'flow') {
        ctx.drawImage(riverCanvas, ox, view.oy, mapW, mapH);
      }
    }

    // Graticule
    if (showGrid) {
      ctx.strokeStyle = 'rgba(232, 229, 224, 0.14)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = view.oy + ((90 - lat) / 180) * mapH;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
      }
      // Equator brighter
      ctx.strokeStyle = 'rgba(232, 229, 224, 0.25)';
      const yEq = view.oy + mapH / 2;
      ctx.beginPath(); ctx.moveTo(0, yEq); ctx.lineTo(cw, yEq); ctx.stroke();
      ctx.strokeStyle = 'rgba(232, 229, 224, 0.14)';
      for (let ox = baseOx; ox < cw + mapW; ox += mapW / 12) {
        ctx.beginPath(); ctx.moveTo(ox, view.oy); ctx.lineTo(ox, view.oy + mapH); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Landmarks
    if (showLandmarks) {
      for (let ox = baseOx; ox < cw; ox += mapW) {
        for (const lm of world.landmarks) {
          const sx = ox + (lm.x + 0.5) * scale;
          const sy = view.oy + (lm.y + 0.5) * scale;
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;
          drawLandmark(ctx, lm, sx, sy);
        }
      }
    }

    // Waypoints
    if (showWaypoints) {
      ctx.font = '600 11px "Source Sans 3", sans-serif';
      for (let ox = baseOx; ox < cw; ox += mapW) {
        for (const wp of waypoints) {
          const sx = ox + wp.u * mapW;
          const sy = view.oy + wp.v * mapH;
          if (sx < -60 || sx > cw + 60 || sy < -30 || sy > ch + 30) continue;
          const selected = wp.id === selectedWaypointId;
          // Pin
          ctx.beginPath();
          ctx.arc(sx, sy, selected ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = wp.color;
          ctx.fill();
          ctx.lineWidth = selected ? 2 : 1.25;
          ctx.strokeStyle = selected ? '#e8e5e0' : 'rgba(7,7,13,0.85)';
          ctx.stroke();
          // Label
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
  };

  // `draw` closes over fresh props every render; the stable scheduler calls
  // the latest one through a ref (kept current in the redraw effect below).
  const drawRef = useRef<(() => void) | null>(null);
  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawRef.current?.());
  }, []);

  // --- sizing / init -------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const fit = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!viewRef.current) {
        const scale = Math.min(rect.width / W, rect.height / H);
        viewRef.current = {
          scale,
          ox: (rect.width - W * scale) / 2,
          oy: (rect.height - H * scale) / 2,
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
  }, [W, H, scheduleDraw]);

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
      const minScale = Math.min(rect.width / W, rect.height / H) * 0.5;
      const newScale = Math.max(minScale, Math.min(28, view.scale * factor));
      const k = newScale / view.scale;
      view.ox = mx - (mx - view.ox) * k;
      view.oy = my - (my - view.oy) * k;
      view.scale = newScale;
      clampVertical(view, rect.width, rect.height, H);
      scheduleDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [W, H, scheduleDraw]);

  // --- helpers --------------------------------------------------------------
  const screenToMap = (sx: number, sy: number): { u: number; v: number } | null => {
    const view = viewRef.current;
    if (!view) return null;
    const mapW = W * view.scale, mapH = H * view.scale;
    let u = ((sx - view.ox) / mapW) % 1;
    if (u < 0) u += 1;
    const v = (sy - view.oy) / mapH;
    if (v < 0 || v > 1) return null;
    return { u, v };
  };

  const waypointAt = (sx: number, sy: number): WorldWaypoint | null => {
    const view = viewRef.current;
    if (!view) return null;
    const mapW = W * view.scale, mapH = H * view.scale;
    for (const wp of waypoints) {
      // account for wrap: compare in wrapped screen space
      let wx = view.ox + wp.u * mapW;
      const wy = view.oy + wp.v * mapH;
      const dxRaw = ((sx - wx) % mapW + mapW) % mapW;
      const dx = dxRaw > mapW / 2 ? dxRaw - mapW : dxRaw;
      wx = sx - dx;
      if (Math.hypot(sx - wx, sy - wy) < 9) return wp;
    }
    return null;
  };

  // --- pointer events --------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (!placing) e.currentTarget.style.cursor = 'grabbing';
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      ox: view.ox,
      oy: view.oy,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      const dx = sx - drag.x, dy = sy - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        view.ox = drag.ox + dx;
        view.oy = drag.oy + dy;
        clampVertical(view, rect.width, rect.height, H);
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
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    // It was a click.
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (placing) {
      const m = screenToMap(sx, sy);
      if (m) onPlace(m.u, m.v);
      return;
    }
    const wp = waypointAt(sx, sy);
    onSelectWaypoint(wp ? wp.id : null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    if (m) onFlyTo(m.u, m.v);
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: placing ? 'crosshair' : 'grab', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={handleDoubleClick}
      />
      {hover && !placing && (
        <div
          className="absolute z-10 pointer-events-none px-2 py-1 rounded-md bg-surface/95 border border-border text-[11px] text-text-primary whitespace-nowrap shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.text}
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-[10px] text-text-dim bg-deep/60 rounded px-1.5 py-0.5 pointer-events-none">
        {t('worldgen.mapHint')}
      </div>
    </div>
  );
}

function clampVertical(view: ViewState, cw: number, ch: number, H: number): void {
  const mapH = H * view.scale;
  const margin = Math.min(ch * 0.35, mapH * 0.5);
  if (mapH <= ch) {
    // keep fully visible-ish, allow slight drift
    view.oy = Math.max(Math.min(view.oy, ch - mapH + margin - margin), (ch - mapH) / 2 - margin / 2);
    view.oy = Math.max(Math.min(view.oy, ch - mapH / 2), -mapH / 2);
  } else {
    view.oy = Math.max(ch - mapH - margin, Math.min(margin, view.oy));
  }
  void cw;
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
