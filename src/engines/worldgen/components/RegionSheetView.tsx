import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Download,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Sliders,
  X,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { generateId } from '@/utils/idGenerator';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { targetFromKey, type WorldEdit } from '../core/edits';
import {
  resolveWorldSpatialEntity,
  type WorldSpatialEntity,
} from '../core/spatialEntities';
import { requestRegion } from '../region/client';
import {
  canvasToRegionCell,
  regionCellToCanvas,
  regionVisibleRect,
} from '../region/coordinates';
import { renderRegion } from '../region/render';
import {
  DEFAULT_REGION_PARAMS,
  type RegionData,
  type RegionParams,
  type RegionPlace,
  type RegionWindow,
} from '../region/types';
import { kmPerWorldCell } from '../region/terrain';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import type { SavedWorldRegion } from '../types';

interface RegionSheetViewProps {
  world: WorldData;
  geography: HumanGeography;
  theme: CartoTheme;
  /** Where to open, in world cell coordinates. */
  at: { x: number; y: number };
  saved?: SavedWorldRegion;
  revision?: number;
  selectedSpatialKey?: string | null;
  onSelectSpatialEntity?: (entity: WorldSpatialEntity | null) => void;
  onEditEntity?: (edit: WorldEdit) => void;
  onSaveRegion?: (region: SavedWorldRegion) => void;
  onClose: () => void;
  onPickSettlement?: (settlement: Settlement) => void;
}

const SPANS = [30, 45, 60, 90, 120, 160, 200, 280, 400];
const REGION_LANDMARKS = new Set([
  'waterfall', 'spring', 'gorge', 'crag', 'cave', 'volcano', 'hotspring',
  'lake', 'island', 'moss', 'pass',
]);

function nearestSpanIndex(spanKm: number): number {
  let best = 0;
  for (let index = 1; index < SPANS.length; index++) {
    if (Math.abs(SPANS[index] - spanKm) < Math.abs(SPANS[best] - spanKm)) best = index;
  }
  return best;
}

function placeEntity(place: RegionPlace, world: WorldData): WorldSpatialEntity {
  return resolveWorldSpatialEntity({
    key: place.sourceKey,
    kind: 'region',
    type: place.landmark ?? place.kind,
    name: place.name,
    x: place.worldX,
    y: place.worldY,
    extent: 0.4,
    importance: place.importance * 0.7,
    source: 'regional',
    style: {
      icon: place.landmark ?? place.kind,
      size: place.importance > 0.7 ? 1.15 : 0.9,
    },
  }, world.painted);
}

export default function RegionSheetView({
  world,
  geography,
  theme,
  at,
  saved,
  revision = 0,
  selectedSpatialKey,
  onSelectSpatialEntity,
  onEditEntity,
  onSaveRegion,
  onClose,
  onPickSettlement,
}: RegionSheetViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spanIdx, setSpanIdx] = useState(() => nearestSpanIndex(saved?.spanKm ?? 120));
  const [centre, setCentre] = useState({ x: saved?.x ?? at.x, y: saved?.y ?? at.y });
  const [params, setParams] = useState<RegionParams>(saved?.params ?? DEFAULT_REGION_PARAMS);
  const [title, setTitle] = useState(saved?.title ?? '');
  const [showControls, setShowControls] = useState(false);
  const [stage, setStage] = useState('relieve');
  const [region, setRegion] = useState<RegionData | null>(null);
  const [busy, setBusy] = useState(false);

  const win: RegionWindow = useMemo(
    () => ({ cx: centre.x, cy: centre.y, spanKm: SPANS[spanIdx] }),
    [centre.x, centre.y, spanIdx],
  );
  const regionParams = useMemo(() => {
    if (size.w < 8 || size.h < 8) return params;
    const aspect = size.w / size.h;
    return Math.abs(params.aspect - aspect) < 0.02 ? params : { ...params, aspect };
  }, [params, size.w, size.h]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => setSize({ w: host.clientWidth, h: host.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let handle: ReturnType<typeof requestRegion> | null = null;
    const timer = window.setTimeout(() => {
      setBusy(true);
      handle = requestRegion(world, geography, win, {
        params: regionParams,
        signal: controller.signal,
        onProgress: (nextStage) => {
          if (!controller.signal.aborted) setStage(nextStage);
        },
      });
      handle.promise.then((nextRegion) => {
        if (!controller.signal.aborted) setRegion(nextRegion);
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.warn('[worldgen] regional sheet failed', error);
      }).finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      handle?.cancel();
    };
  }, [geography, regionParams, win, world]);

  const entities = useMemo(
    () => region?.places.map((place) => placeEntity(place, world)) ?? [],
    // Edits mutate world.painted in place; revision is the React signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region, revision, world],
  );
  const entityByKey = useMemo(
    () => new Map(entities.map((entity) => [entity.key, entity])),
    [entities],
  );
  const displayRegion = useMemo<RegionData | null>(() => {
    if (!region) return null;
    const places = region.places.flatMap((place) => {
      const entity = entityByKey.get(place.sourceKey);
      if (!entity || entity.hidden) return [];
      const icon = entity.style.icon;
      return [{
        ...place,
        name: entity.name,
        worldX: entity.x,
        worldY: entity.y,
        landmark: icon && REGION_LANDMARKS.has(icon)
          ? icon as RegionPlace['landmark']
          : place.landmark,
      }];
    });
    return {
      ...region,
      places,
      title: title.trim() || region.title,
    };
  }, [entityByKey, region, title]);
  const selectedEntity = selectedSpatialKey ? entityByKey.get(selectedSpatialKey) ?? null : null;
  const selectedPlace = selectedSpatialKey
    ? region?.places.find((place) => place.sourceKey === selectedSpatialKey) ?? null
    : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displayRegion || size.w < 8 || size.h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    renderRegion(displayRegion, context as unknown as Ctx, {
      theme,
      width: canvas.width,
      height: canvas.height,
      typeScale: dpr,
    });
    if (selectedPlace && !selectedEntity?.hidden) {
      const point = regionCellToCanvas(
        displayRegion,
        selectedPlace,
        { width: canvas.width, height: canvas.height },
      );
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.beginPath();
      context.arc(point.x, point.y, 10 * dpr, 0, Math.PI * 2);
      context.lineWidth = 2.2 * dpr;
      context.strokeStyle = '#f5c66a';
      context.stroke();
      context.restore();
    }
  }, [displayRegion, selectedEntity?.hidden, selectedPlace, size.h, size.w, theme]);

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const kmCell = kmPerWorldCell(world);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      cx: centre.x,
      cy: centre.y,
      moved: false,
    };
  }, [centre.x, centre.y]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || size.w < 8) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    current.moved = true;
    const worldPerPx = (SPANS[spanIdx] / kmCell) / size.w;
    setCentre({
      x: current.cx - dx * worldPerPx,
      y: Math.min(world.height - 1, Math.max(0, current.cy - dy * worldPerPx)),
    });
  }, [kmCell, size.w, spanIdx, world.height]);

  const entityAt = useCallback((clientX: number, clientY: number) => {
    if (!displayRegion) return null;
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const cell = canvasToRegionCell(
      displayRegion,
      { x: clientX - rect.left, y: clientY - rect.top },
      { width: rect.width, height: rect.height },
    );
    const visible = regionVisibleRect(displayRegion);
    const reach = Math.max(3, (14 / Math.max(1, rect.width)) * visible.width);
    let best: { entity: WorldSpatialEntity; place: RegionPlace; distance: number } | null = null;
    for (const place of region?.places ?? []) {
      const entity = entityByKey.get(place.sourceKey);
      if (!entity || entity.hidden) continue;
      const distance = Math.hypot(place.x - cell.x, place.y - cell.y);
      if (distance <= reach && (!best || distance < best.distance)) {
        best = { entity, place, distance };
      }
    }
    return best;
  }, [displayRegion, entityByKey, region?.places]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    const hit = entityAt(event.clientX, event.clientY);
    onSelectSpatialEntity?.(hit?.entity ?? null);
  }, [entityAt, onSelectSpatialEntity]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    const hit = entityAt(event.clientX, event.clientY);
    if (!hit || hit.place.kind !== 'town' || hit.place.worldId === undefined || !onPickSettlement) {
      return;
    }
    const settlement = geography.settlements.find((candidate) => candidate.id === hit.place.worldId);
    if (settlement) onPickSettlement(settlement);
  }, [entityAt, geography.settlements, onPickSettlement]);

  const onWheel = useCallback((event: React.WheelEvent) => {
    setSpanIdx((index) => Math.min(
      SPANS.length - 1,
      Math.max(0, index + (event.deltaY > 0 ? 1 : -1)),
    ));
  }, []);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displayRegion) return;
    canvas.toBlob((blob) => {
      if (blob) {
        saveAs(blob, `${displayRegion.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.png`);
      }
    }, 'image/png');
  }, [displayRegion]);

  const save = useCallback(() => {
    if (!onSaveRegion) return;
    const now = Date.now();
    onSaveRegion({
      id: saved?.id ?? generateId('region'),
      title: title.trim() || displayRegion?.title || 'Hoja regional',
      x: centre.x,
      y: centre.y,
      spanKm: SPANS[spanIdx],
      params: regionParams,
      createdAt: saved?.createdAt ?? now,
      updatedAt: now,
    });
  }, [centre.x, centre.y, displayRegion?.title, onSaveRegion, regionParams, saved, spanIdx, title]);

  const set = (patch: Partial<RegionParams>) => setParams((current) => ({ ...current, ...patch }));

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-white/10 bg-black/50 px-3 py-2">
        <input
          value={title || region?.title || ''}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 max-w-72 rounded border border-transparent bg-transparent px-1 text-sm font-medium text-white/90 outline-none hover:border-white/15 focus:border-amber-400/50 focus:bg-black/30"
          aria-label="Nombre de la comarca"
        />
        <span className="text-[11px] text-white/45">{displayRegion?.subtitle ?? ''}</span>
        {busy && (
          <span className="flex items-center gap-1 text-[11px] text-accent-gold/90">
            <Loader2 size={12} className="animate-spin" /> {stage}…
          </span>
        )}
        <div className="flex-1" />
        <div className="mr-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSpanIdx((index) => Math.max(0, index - 1))}
            disabled={spanIdx === 0}
            className="rounded bg-white/8 p-1 hover:bg-white/15 disabled:opacity-30"
            title="Acercar"
          >
            <Minus size={13} />
          </button>
          <span className="w-14 text-center text-[11px] tabular-nums text-white/70">
            {SPANS[spanIdx]} km
          </span>
          <button
            type="button"
            onClick={() => setSpanIdx((index) => Math.min(SPANS.length - 1, index + 1))}
            disabled={spanIdx === SPANS.length - 1}
            className="rounded bg-white/8 p-1 hover:bg-white/15 disabled:opacity-30"
            title="Alejar"
          >
            <Plus size={13} />
          </button>
        </div>
        <button
          type="button"
          onClick={save}
          className="rounded bg-white/8 p-1.5 hover:bg-white/15"
          title="Guardar comarca"
        >
          <Bookmark size={14} />
        </button>
        <button
          type="button"
          onClick={() => setShowControls((value) => !value)}
          className={`rounded p-1.5 ${showControls ? 'bg-accent-gold/25' : 'bg-white/8 hover:bg-white/15'}`}
          title="Ajustes de la hoja"
        >
          <Sliders size={14} />
        </button>
        <button type="button" onClick={download} className="rounded bg-white/8 p-1.5 hover:bg-white/15" title="Descargar">
          <Download size={14} />
        </button>
        <button type="button" onClick={onClose} className="rounded bg-white/8 p-1.5 hover:bg-white/15" title="Cerrar">
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={hostRef}
          className="relative min-w-0 flex-1 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
        >
          <canvas
            ref={canvasRef}
            className="block transition-opacity duration-150"
            style={{ opacity: busy ? 0.62 : 1 }}
          />
          {!displayRegion && (
            <div className="absolute inset-0 grid place-items-center text-xs text-white/60">
              trazando la hoja…
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] text-white/55">
            arrastra para recorrer · rueda para cambiar escala · selecciona un lugar · doble clic abre una villa
          </div>
        </div>

        {(showControls || selectedEntity) && (
          <div className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-black/55 p-3">
            {selectedEntity && (
              <RegionPlaceControls
                key={selectedEntity.key}
                entity={selectedEntity}
                onEdit={(edit) => onEditEntity?.(edit)}
              />
            )}
            {showControls && (
              <>
                <p className="text-[10px] leading-snug text-white/45">
                  La hoja, el mapa 2D y el relieve 3D comparten la misma comarca derivada.
                  Sólo se guardan el nombre, la ventana y tus correcciones.
                </p>
                <Slider label="Detalle local" value={params.detail} min={0} max={1.4} step={0.05}
                  format={(value) => `${Math.round(value * 100)} %`} onChange={(value) => set({ detail: value })} />
                <Slider label="Tierra roturada" value={params.settled} min={0} max={1} step={0.05}
                  format={(value) => (value <= 0 ? 'yerma' : `${Math.round(value * 100)} %`)}
                  onChange={(value) => set({ settled: value })} />
                <Slider label="Poblamiento" value={params.habitation} min={0.2} max={2.2} step={0.1}
                  format={(value) => `×${value.toFixed(1)}`} onChange={(value) => set({ habitation: value })} />
                <Slider label="Cursos de agua" value={params.streamDensity} min={0} max={1} step={0.05}
                  format={(value) => (value < 0.3 ? 'sólo ríos' : value > 0.7 ? 'hasta arroyos' : 'normal')}
                  onChange={(value) => set({ streamDensity: value })} />
                <Slider label="Resolución" value={params.res} min={384} max={1024} step={64}
                  format={(value) => `${value} celdas`} onChange={(value) => set({ res: value })} />
                {displayRegion && (
                  <div className="border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/45">
                    {displayRegion.places.filter((place) => place.kind === 'village').length} aldeas ·{' '}
                    {displayRegion.places.filter((place) => place.kind === 'hamlet').length} caseríos ·{' '}
                    {displayRegion.places.filter((place) => place.kind === 'farm').length} granjas<br />
                    {displayRegion.streams.length} cursos · {displayRegion.tracks.length} caminos
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RegionPlaceControls({
  entity,
  onEdit,
}: {
  entity: WorldSpatialEntity;
  onEdit: (edit: WorldEdit) => void;
}) {
  const [name, setName] = useState(entity.name);
  const target = targetFromKey(entity.key) ?? 'region';
  return (
    <div className="flex flex-col gap-2 border-b border-white/10 pb-3">
      <span className="text-[10px] uppercase tracking-wider text-white/45">
        {entity.type}
      </span>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const value = name.trim();
          if (value && value !== entity.name) {
            onEdit({ kind: 'rename', target, key: entity.key, name: value });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="rounded border border-white/15 bg-black/35 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-amber-400/60"
      />
      <label className="flex items-center justify-between text-[10px] text-white/55">
        Mostrar nombre
        <input
          type="checkbox"
          checked={entity.style.labelVisible ?? false}
          onChange={(event) => onEdit({
            kind: 'style',
            target,
            key: entity.key,
            style: { labelVisible: event.target.checked },
          })}
          className="accent-amber-400"
        />
      </label>
      {entity.hidden ? (
        <button
          type="button"
          onClick={() => onEdit({ kind: 'restore', target, key: entity.key })}
          className="flex items-center justify-center gap-1.5 rounded border border-white/15 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10"
        >
          <RotateCcw size={12} /> Restaurar
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onEdit({ kind: 'remove', target, key: entity.key })}
          className="flex items-center justify-center gap-1.5 rounded border border-red-400/25 bg-red-400/10 px-2 py-1.5 text-[11px] text-red-200 hover:bg-red-400/15"
        >
          <EyeOff size={12} /> Ocultar
        </button>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/70">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-amber-400"
      />
    </label>
  );
}
