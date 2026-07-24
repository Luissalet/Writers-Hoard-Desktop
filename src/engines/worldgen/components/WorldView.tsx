import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomSeed } from '../randomSeed';
import {
  Map as MapIcon, Box, Dices, Download, Waves, Flame, MapPin, Globe,
  Loader2, X, ChevronDown, Send, Mountain,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { EngineSpinner } from '@/engines/_shared';
import { generateId } from '@/utils/idGenerator';
import { worldMapOps, mapPinOps } from '@/engines/maps/operations';
import type { GeneratedWorld, WorldWaypoint } from '../types';
import { WAYPOINT_COLORS } from '../types';
import type { ViewMode, WorldData, WorldParams } from '../core/types';
import { renderComposite } from '../core/render';
import { useWorldGeneration } from '../useWorldGeneration';
import { useWorldWaypoints } from '../hooks';
import Map2D from './Map2D';
import ParamsPanel from './ParamsPanel';
import WaypointsPanel from './WaypointsPanel';

const Terrain3D = lazy(() => import('./Terrain3D'));

const VIEW_MODES: ViewMode[] = ['atlas', 'elevation', 'temperature', 'precipitation', 'plates', 'flow'];

export interface WaypointFocus {
  id: string;
  /** Monotonic token so the same waypoint can be re-focused later. */
  token: number;
}

interface WorldViewProps {
  projectId: string;
  world: GeneratedWorld;
  onSaveParams: (params: WorldParams) => Promise<void> | void;
  onThumbnail: (thumbnail: string) => Promise<void> | void;
  focusWaypoint: WaypointFocus | null;
}

export default function WorldView({
  projectId,
  world,
  onSaveParams,
  onThumbnail,
  focusWaypoint,
}: WorldViewProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<WorldParams>(world.params);
  const [view, setView] = useState<'map' | '3d'>('map');
  const [viewMode, setViewMode] = useState<ViewMode>('atlas');
  const [showRivers, setShowRivers] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [panelTab, setPanelTab] = useState<'params' | 'waypoints'>('params');
  const [placing, setPlacing] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ u: number; v: number; token: number } | null>(null);
  const [exaggeration, setExaggeration] = useState(30);
  const [exportOpen, setExportOpen] = useState(false);

  const thumbRef = useRef<string | undefined>(world.thumbnail);

  const handleDone = useCallback((data: WorldData) => {
    // Small preview for dashboards; deterministic pixels → cheap dedupe.
    try {
      const canvas = compositeToCanvas(data, 'atlas', true, 256);
      const url = canvas.toDataURL('image/jpeg', 0.8);
      if (url !== thumbRef.current) {
        thumbRef.current = url;
        onThumbnail(url);
      }
    } catch {
      // thumbnail is cosmetic — never block on it
    }
  }, [onThumbnail]);

  const { world: data, gen, generate, cancel } = useWorldGeneration(world.id, handleDone);

  // First open (or cache miss): generate from stored params automatically.
  // Deliberately re-runnable — StrictMode's mount→unmount→mount cycle
  // terminates the in-flight worker during cleanup, so the guard must be the
  // cache (instant hit), never a ref flag. `generate` is stable per world id.
  const storedParamsRef = useRef(world.params);
  useEffect(() => {
    storedParamsRef.current = world.params;
  });
  useEffect(() => {
    generate(storedParamsRef.current);
  }, [generate]);

  const {
    items: waypoints,
    addItem: addWaypoint,
    editItem: editWaypoint,
    removeItem: removeWaypoint,
  } = useWorldWaypoints(world.id);

  // Deep-linked waypoint focus — applied as a render-phase state adjustment
  // (React's documented pattern) once the waypoint list contains the target.
  const [consumedFocusToken, setConsumedFocusToken] = useState(0);
  if (focusWaypoint && focusWaypoint.token !== consumedFocusToken
      && waypoints.some((w) => w.id === focusWaypoint.id)) {
    setConsumedFocusToken(focusWaypoint.token);
    setSelectedWaypointId(focusWaypoint.id);
    setPanelTab('waypoints');
  }

  const handleGenerate = useCallback(() => {
    onSaveParams(params);
    generate(params);
  }, [params, onSaveParams, generate]);

  const handlePlace = useCallback(async (u: number, v: number) => {
    const wp: WorldWaypoint = {
      id: generateId('wpt'),
      projectId,
      worldId: world.id,
      name: `${t('worldgen.waypoints.defaultName')} ${waypoints.length + 1}`,
      color: WAYPOINT_COLORS[waypoints.length % WAYPOINT_COLORS.length],
      u,
      v,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addWaypoint(wp);
    setSelectedWaypointId(wp.id);
    setPlacing(false);
    setPanelTab('waypoints');
  }, [projectId, world.id, waypoints.length, addWaypoint, t]);

  const flyTo = useCallback((u: number, v: number) => {
    setFlyTarget({ u, v, token: Date.now() });
    setView('3d');
  }, []);

  // ---- Exports -----------------------------------------------------------
  const exportPng = useCallback(() => {
    if (!data) return;
    const canvas = compositeToCanvas(data, viewMode, showRivers);
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${safeName(world.title)}-${viewMode}.png`);
    }, 'image/png');
    setExportOpen(false);
  }, [data, viewMode, showRivers, world.title]);

  const exportHeightmap = useCallback(() => {
    if (!data) return;
    const { width: W, height: H, elevation } = data;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i] < min) min = elevation[i];
      if (elevation[i] > max) max = elevation[i];
    }
    const range = max - min || 1;
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < elevation.length; i++) {
      const g = Math.round(((elevation[i] - min) / range) * 255);
      px[i * 4] = g; px[i * 4 + 1] = g; px[i * 4 + 2] = g; px[i * 4 + 3] = 255;
    }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${safeName(world.title)}-heightmap.png`);
    }, 'image/png');
    setExportOpen(false);
  }, [data, world.title]);

  const sendToMaps = useCallback(async () => {
    if (!data) return;
    setExportOpen(false);
    const canvas = compositeToCanvas(data, 'atlas', true, 1600);
    const bg = canvas.toDataURL('image/jpeg', 0.86);
    const mapId = generateId('map');
    await worldMapOps.create({
      id: mapId,
      projectId,
      title: `${world.title} — ${t('worldgen.export.atlasSuffix')}`,
      backgroundImage: bg,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const wp of waypoints) {
      await mapPinOps.create({
        id: generateId('pin'),
        projectId,
        mapId,
        name: wp.name,
        icon: 'custom',
        position: { x: wp.u * 100, y: wp.v * 100 },
        description: wp.description,
      });
    }
    toast.success(t('worldgen.export.sentToMaps'));
  }, [data, projectId, world.title, waypoints, t]);

  const stageLabel = gen.running ? t(`worldgen.stage.${gen.stage}`) : '';
  const selectedWaypoint = useMemo(
    () => waypoints.find((w) => w.id === selectedWaypointId) ?? null,
    [waypoints, selectedWaypointId],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Toolbar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View switch */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <ToolbarTab active={view === 'map'} onClick={() => setView('map')} icon={MapIcon} label={t('worldgen.view.map')} />
          <ToolbarTab active={view === '3d'} onClick={() => setView('3d')} icon={Box} label={t('worldgen.view.terrain')} disabled={!data} />
        </div>

        {/* 2D view-mode select */}
        {view === 'map' && (
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            className="bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-gold/60"
          >
            {VIEW_MODES.map((m) => (
              <option key={m} value={m}>{t(`worldgen.viewMode.${m}`)}</option>
            ))}
          </select>
        )}

        {/* Overlay toggles */}
        <div className="flex items-center gap-1">
          <OverlayToggle active={showRivers} onClick={() => setShowRivers(!showRivers)} icon={Waves} title={t('worldgen.overlay.rivers')} />
          <OverlayToggle active={showLandmarks} onClick={() => setShowLandmarks(!showLandmarks)} icon={Flame} title={t('worldgen.overlay.landmarks')} />
          <OverlayToggle active={showWaypoints} onClick={() => setShowWaypoints(!showWaypoints)} icon={MapPin} title={t('worldgen.overlay.waypoints')} />
          {view === 'map' && (
            <OverlayToggle active={showGrid} onClick={() => setShowGrid(!showGrid)} icon={Globe} title={t('worldgen.overlay.grid')} />
          )}
        </div>

        <div className="flex-1" />

        {/* Export menu */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-elevated border border-border rounded-lg text-text-primary hover:border-accent-gold/50 transition disabled:opacity-40"
          >
            <Download size={13} />
            {t('worldgen.export.button')}
            <ChevronDown size={12} />
          </button>
          {exportOpen && data && (
            <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-lg border border-border bg-elevated shadow-xl shadow-black/40 py-1">
              <ExportItem icon={Download} label={t('worldgen.export.png')} onClick={exportPng} />
              <ExportItem icon={Mountain} label={t('worldgen.export.heightmap')} onClick={exportHeightmap} />
              <ExportItem icon={Send} label={t('worldgen.export.sendToMaps')} onClick={sendToMaps} />
            </div>
          )}
        </div>
      </div>

      {/* ---- Main area ---- */}
      <div className="flex gap-3 items-stretch" style={{ height: 'max(440px, calc(100vh - 300px))' }}>
        <div className="flex-1 relative rounded-xl overflow-hidden border border-border bg-deep min-w-0">
          {data && view === 'map' && (
            <Map2D
              world={data}
              viewMode={viewMode}
              showRivers={showRivers}
              showLandmarks={showLandmarks}
              showWaypoints={showWaypoints}
              showGrid={showGrid}
              waypoints={waypoints}
              selectedWaypointId={selectedWaypointId}
              placing={placing}
              onPlace={handlePlace}
              onSelectWaypoint={setSelectedWaypointId}
              onFlyTo={flyTo}
            />
          )}
          {data && view === '3d' && (
            <Suspense fallback={<EngineSpinner />}>
              <Terrain3D
                world={data}
                waypoints={showWaypoints ? waypoints : []}
                flyTarget={flyTarget}
                exaggeration={exaggeration}
                onPickWaypoint={(id) => {
                  setSelectedWaypointId(id);
                  setPanelTab('waypoints');
                }}
              />
            </Suspense>
          )}

          {/* 3D exaggeration slider */}
          {data && view === '3d' && (
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 bg-surface/85 border border-border rounded-lg px-3 py-2 backdrop-blur">
              <Mountain size={12} className="text-text-muted" />
              <input
                type="range"
                min={4}
                max={60}
                value={exaggeration}
                onChange={(e) => setExaggeration(Number(e.target.value))}
                className="w-28 accent-[#c4973b]"
                title={t('worldgen.threeD.exaggeration')}
              />
            </div>
          )}

          {/* Placing hint */}
          {placing && view === 'map' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 text-xs px-3 py-1.5 rounded-full bg-accent-gold/90 text-deep font-medium shadow-lg">
              {t('worldgen.waypoints.placingHint')}
            </div>
          )}

          {/* Generation overlay */}
          {(gen.running || (!data && !gen.error)) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-deep/70 backdrop-blur-sm">
              <div className="w-72 rounded-xl border border-border bg-surface p-5 shadow-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Loader2 size={15} className="animate-spin text-accent-gold" />
                  <span className="text-sm text-text-primary font-medium">
                    {t('worldgen.generating')}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-elevated overflow-hidden mb-2">
                  <div
                    className="h-full bg-accent-gold transition-[width] duration-200"
                    style={{ width: `${Math.round(gen.progress * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">{stageLabel}</span>
                  <button onClick={cancel} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
                    <X size={11} />
                    {t('worldgen.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {gen.error && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-deep/70">
              <div className="text-center">
                <p className="text-sm text-danger mb-2">{t('worldgen.error.generationFailed')}</p>
                <p className="text-xs text-text-dim mb-3 max-w-xs">{gen.error}</p>
                <button
                  onClick={handleGenerate}
                  className="px-4 py-2 text-xs bg-accent-gold text-deep rounded-lg font-medium hover:bg-accent-amber transition"
                >
                  {t('worldgen.retry')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Side panel ---- */}
        <aside className="w-80 shrink-0 flex flex-col rounded-xl border border-border bg-surface/50 overflow-hidden">
          <div className="flex border-b border-border">
            <PanelTab active={panelTab === 'params'} onClick={() => setPanelTab('params')} label={t('worldgen.params.title')} />
            <PanelTab active={panelTab === 'waypoints'} onClick={() => setPanelTab('waypoints')} label={`${t('worldgen.waypoints.title')}${waypoints.length ? ` (${waypoints.length})` : ''}`} />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {panelTab === 'params' ? (
              <ParamsPanel
                params={params}
                onChange={setParams}
                onGenerate={handleGenerate}
                onRandomSeed={() => setParams({ ...params, seed: randomSeed() })}
                generating={gen.running}
                hasWorld={!!data}
              />
            ) : (
              <WaypointsPanel
                waypoints={waypoints}
                selectedId={selectedWaypointId}
                onSelect={setSelectedWaypointId}
                selected={selectedWaypoint}
                onEdit={editWaypoint}
                onDelete={async (id) => {
                  await removeWaypoint(id);
                  if (selectedWaypointId === id) setSelectedWaypointId(null);
                }}
                placing={placing}
                onTogglePlacing={() => {
                  setPlacing(!placing);
                  setView('map');
                }}
                onFlyTo={(wp) => flyTo(wp.u, wp.v)}
                disabled={!data}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Seed shortcut under the map */}
      <div className="flex items-center gap-2 text-[11px] text-text-dim">
        <Dices size={12} className="text-text-muted" />
        <span>
          {t('worldgen.seedLabel')}: <span className="font-mono text-text-muted">{world.params.seed}</span>
        </span>
        {data && (
          <span className="ml-3">
            {t('worldgen.stats')
              .replace('{rivers}', String(data.rivers.length))
              .replace('{landmarks}', String(data.landmarks.length))}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ToolbarTab({ active, onClick, icon: Icon, label, disabled }: {
  active: boolean;
  onClick: () => void;
  icon: typeof MapIcon;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition disabled:opacity-40 ${
        active ? 'bg-accent-gold/15 text-accent-gold' : 'bg-elevated text-text-muted hover:text-text-primary'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function OverlayToggle({ active, onClick, icon: Icon, title }: {
  active: boolean;
  onClick: () => void;
  icon: typeof MapIcon;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg border transition ${
        active
          ? 'border-accent-gold/50 bg-accent-gold/10 text-accent-gold'
          : 'border-border bg-elevated text-text-dim hover:text-text-muted'
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function ExportItem({ icon: Icon, label, onClick }: { icon: typeof MapIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-accent-gold/10 transition text-left"
    >
      <Icon size={13} className="text-text-muted" />
      {label}
    </button>
  );
}

function PanelTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-medium transition ${
        active ? 'text-accent-gold border-b-2 border-accent-gold bg-accent-gold/5' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() || 'world';
}

/** Render a composite to a canvas, optionally downscaled to maxWidth. */
function compositeToCanvas(data: WorldData, mode: ViewMode, withRivers: boolean, maxWidth?: number): HTMLCanvasElement {
  const px = renderComposite(data, mode, withRivers);
  const full = document.createElement('canvas');
  full.width = data.width;
  full.height = data.height;
  full.getContext('2d')!.putImageData(new ImageData(px, data.width, data.height), 0, 0);
  if (!maxWidth || maxWidth >= data.width) return full;
  const scaled = document.createElement('canvas');
  scaled.width = maxWidth;
  scaled.height = Math.round((maxWidth * data.height) / data.width);
  const ctx = scaled.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, scaled.width, scaled.height);
  return scaled;
}
