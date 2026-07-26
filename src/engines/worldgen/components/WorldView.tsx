import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomSeed } from '../randomSeed';
import {
  Map as MapIcon, Box, Dices, Download, Waves, Flame, MapPin, Globe,
  Loader2, X, ChevronDown, Send, Mountain, ScrollText, Trees, Route, Landmark,
  Signpost, Compass,
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
import { normalizeParams } from '../core/types';
import { renderComposite } from '../core/render';
import { PROJECTION_IDS, reprojectRgba, type Projection } from '../core/projections';
import { useWorldGeneration } from '../useWorldGeneration';
import { useWorldWaypoints } from '../hooks';
import Map2D from './Map2D';
import ParamsPanel from './ParamsPanel';
import WaypointsPanel from './WaypointsPanel';
import type { Shape3D, Skin3D } from './World3D';
import CartoMap from './CartoMap';
import CityPlanView from './CityPlanView';
import RegionSheetView from './RegionSheetView';
import JourneyPanel from './JourneyPanel';
import AtlasPanel from './AtlasPanel';
import PaintPanel, { DEFAULT_PAINT_TOOL, type PaintTool } from './PaintPanel';
import FiltersPanel from './FiltersPanel';
import { PaintSession } from '../core/paintSession';
import { deserializeEdits, editKey, targetFromKey } from '../core/edits';
import { planRoute } from '../core/travel';
import { nameBridges, paleoMap } from '../core/paleo';
import type { WorldEdit } from '../core/edits';
import { THEMES, themeById } from '../cartography/theme';
import { getGeography, geographyIsStale, rebuildGeography, renderCartoCanvas } from '../cartography/texture';
import type { GeoDepth } from '../core/settlements';
import type { HumanGeography, Settlement } from '../core/settlements';
import type { CartoLayers } from '../cartography/render';
import type { CartoAnnotations } from '../cartography/annotations';
import type { PaleoState } from '../core/paleo';
import { buildAtlas, buildIndex, linkWeights, placeAt, type ManuscriptLink } from '../core/atlas';
import type { Route as TravelRoute } from '../core/travel';

// three.js and the surface shader are the heaviest thing in the engine, so they
// still arrive on demand — but this IS the opening view now, so the chunk is
// requested the moment the module loads rather than on a first click.
const World3D = lazy(() => import('./World3D'));

const VIEW_MODES: ViewMode[] = ['atlas', 'elevation', 'temperature', 'precipitation', 'plates', 'flow'];
const SHAPES_3D: Shape3D[] = ['plane', 'globe'];
const SKINS_3D: { id: Skin3D; label: string; title: string }[] = [
  { id: 'satelite', label: 'Satélite', title: 'El mundo visto desde arriba: biomas, ríos, hielo' },
  { id: 'dibujado', label: 'Dibujado', title: 'La carta dibujada, drapeada sobre el relieve' },
  { id: 'arcilla', label: 'Arcilla', title: 'Sin color: sólo la forma, para esculpir' },
];

export interface WaypointFocus {
  id: string;
  /** Monotonic token so the same waypoint can be re-focused later. */
  token: number;
}

interface WorldViewProps {
  projectId: string;
  world: GeneratedWorld;
  /**
   * What the manuscript says about places, supplied by the host application.
   *
   * The world engine owns the place registry and the key scheme; the app owns
   * the book. Passing nothing is a valid, fully working world — the index panel
   * simply says there is nothing linked yet.
   */
  manuscriptLinks?: ManuscriptLink[];
  /** Open the host's own editor for a linked scene, character or event. */
  onOpenManuscriptLink?: (link: ManuscriptLink) => void;
  onSaveParams: (params: WorldParams) => Promise<void> | void;
  /**
   * Persist the brush strokes.
   *
   * Everything painted used to live in memory and nowhere else: close the
   * application and the hand-drawn coast, the hand-placed towns and every
   * renamed sea were gone, and the world came back as the generator had first
   * made it. The list is small — a few hundred bytes — and it is the other half
   * of what a world is.
   */
  onSaveEdits: (edits: string) => Promise<void> | void;
  onThumbnail: (thumbnail: string) => Promise<void> | void;
  focusWaypoint: WaypointFocus | null;
}

export default function WorldView({
  projectId,
  world,
  manuscriptLinks,
  onOpenManuscriptLink,
  onSaveParams,
  onSaveEdits,
  onThumbnail,
  focusWaypoint,
}: WorldViewProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<WorldParams>(() => normalizeParams(world.params));
  /**
   * Which view the reader lands in.
   *
   * The 3D world, in satellite. It is the one that shows what the generator
   * actually made — the shape of the ground and the colour of it — and it is the
   * one the brush works on. The carta is a beautiful thing to export and a poor
   * thing to work in, so it is last in the row and never the default.
   */
  const [view, setView] = useState<'3d' | 'map' | 'carta'>('3d');
  const [themeId, setThemeId] = useState<string>('wonder');
  const [skin3D, setSkin3D] = useState<Skin3D>('satelite');
  const [cityFor, setCityFor] = useState<Settlement | null>(null);
  const [regionAt, setRegionAt] = useState<{ x: number; y: number } | null>(null);
  const [cartoLayers, setCartoLayers] = useState<Partial<CartoLayers>>({
    relief: true, forests: true, labels: true, settlements: true,
    roads: true, borders: false, frame: true, compass: true, scaleBar: true,
  });
  const [reliefAmount, setReliefAmount] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('atlas');
  const [projection, setProjection] = useState<Projection>('equirect');
  const [shape3D, setShape3D] = useState<Shape3D>('plane');
  const [showRivers, setShowRivers] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [showSettlements, setShowSettlements] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [panelTab, setPanelTab] = useState<'params' | 'waypoints' | 'paint' | 'world' | 'journey' | 'atlas'>('params');
  const [atlasKey, setAtlasKey] = useState<string | null>(null);
  // The journey: two ends, the route between them, and the world at another
  // sea level. All of it lives here rather than in the panel because the map
  // draws it and the panel only chooses it.
  const [journeyFrom, setJourneyFrom] = useState<Settlement | null>(null);
  const [journeyTo, setJourneyTo] = useState<Settlement | null>(null);
  const [journeyPick, setJourneyPick] = useState<'from' | 'to' | 'via' | null>(null);
  const [journeyVia, setJourneyVia] = useState<Settlement[]>([]);
  const [journeyRoute, setJourneyRoute] = useState<{ route: TravelRoute | null; color: string }>({ route: null, color: '#a3261e' });
  const [paleoState, setPaleoState] = useState<PaleoState | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ u: number; v: number; token: number } | null>(null);
  /** First end of a road being laid, waiting for its second click. */
  const [roadFrom, setRoadFrom] = useState<Settlement | null>(null);
  const [exaggeration, setExaggeration] = useState(30);
  const [exportOpen, setExportOpen] = useState(false);
  // Declared up here with the rest of the view state rather than down in the
  // painting section, because whether a brush is out decides when the human
  // geography may be rebuilt — and that effect runs above it.
  const [tool, setTool] = useState<PaintTool>(DEFAULT_PAINT_TOOL);
  // Same reason: a stroke bumps this, and the geography effect has to notice.
  const [paintRev, setPaintRev] = useState(0);

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

  const { world: data, gen, generate, cancel, restorePristine } = useWorldGeneration(world.id, handleDone);

  // First open (or cache miss): generate from stored params automatically.
  // Deliberately re-runnable — StrictMode's mount→unmount→mount cycle
  // terminates the in-flight worker during cleanup, so the guard must be the
  // cache (instant hit), never a ref flag. `generate` is stable per world id.
  const storedParamsRef = useRef(normalizeParams(world.params));
  useEffect(() => {
    storedParamsRef.current = normalizeParams(world.params);
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

  // Human geography costs ~2 s on a 1024-wide world. Computing it inside a
  // render would freeze the toolbar mid-click, so it is kicked off in an effect
  // the first time a view that needs it is opened, and cached on the world.
  const [geography, setGeography] = useState<HumanGeography | null>(null);
  // Kept for the badge the Carta view shows while a full rebuild runs in the
  // background; the map itself is never unmounted for it any more.
  const [geoBusy, setGeoBusy] = useState(false);
  /**
   * Who needs the human geography, and HOW MUCH of it.
   *
   * These are two different questions and conflating them cost seconds of frozen
   * main thread. The dots you click to open a town's plan are on every view now,
   * and they are cheap: cultures, siting, realms and roads are about a second
   * and a half. The named capes and seas and the ruins are another eighteen,
   * because both walk every cell of the grid — and neither is on screen unless
   * the reader has asked for the sheet that draws them.
   *
   * So the 3D world and the satellite map ask for `places`, and the carta, the
   * index and the journey panel ask for `full`. See `GeoDepth` in settlements.
   */
  const needsFullGeo = view === 'carta' || skin3D === 'dibujado'
    || panelTab === 'atlas' || panelTab === 'journey';
  const needsGeo = needsFullGeo || showSettlements;
  const geoDepth: GeoDepth = needsFullGeo ? 'full' : 'places';

  /**
   * A brush exists only where it can be used.
   *
   * Two bugs came out of the tool being a single piece of state that outlived
   * the place it was chosen: the crosshair followed the reader into panels that
   * have nothing to paint, and the carta — which is a finished drawing, not a
   * working surface — accepted strokes. Both are the same mistake, so both get
   * the same fix: leaving the brush box, or opening the carta, puts the brush
   * down. `paintable` is the single source of truth for "can this view paint",
   * and the views are handed a brush only when it is true.
   */
  const paintable = view !== 'carta' && panelTab === 'paint';
  const brush = paintable ? tool : DEFAULT_PAINT_TOOL;
  /** The Punto tool, set to Chincheta, and actually live. */
  const pinning = paintable && tool.mode === 'point' && tool.point === 'waypoint';
  /** True while the reader is holding a brush: nothing expensive may run. */
  const brushIsOut = brush.mode !== 'off';
  const brushingRef = useRef(brushIsOut);
  brushingRef.current = brushIsOut;
  // Read through a ref so `afterEdit` does not have to be rebuilt — and so a
  // stroke started in one view cannot be judged by the view the reader has
  // since switched to.
  const needsGeoRef = useRef(needsGeo);
  needsGeoRef.current = needsGeo;
  const geoDepthRef = useRef(geoDepth);
  geoDepthRef.current = geoDepth;
  /** The world revision the cached geography was built at. */
  const geoRev = useRef(-1);

  // Places the manuscript talks about, as a heat overlay. Built here rather
  // than in the panel because the map draws it whether or not the panel is open
  // — the whole point is to see, at a glance, where the book actually happens.
  const linked = useMemo(() => {
    if (!data || !geography || !manuscriptLinks?.length) return undefined;
    const atlas = buildAtlas(data, geography);
    const weights = linkWeights(buildIndex(atlas, manuscriptLinks));
    const out: { x: number; y: number; weight: number }[] = [];
    for (const [key, weight] of weights) {
      const p = atlas.byKey.get(key);
      if (p) out.push({ x: p.x, y: p.y, weight });
    }
    return out.length ? out : undefined;
  }, [data, geography, manuscriptLinks]);

  const annotations: CartoAnnotations | undefined = useMemo(() => {
    const pins: NonNullable<CartoAnnotations['pins']> = [];
    if (journeyFrom) pins.push({ x: journeyFrom.x, y: journeyFrom.y, label: journeyFrom.name, kind: 'from' });
    for (const v of journeyVia) pins.push({ x: v.x, y: v.y, label: v.name, kind: 'mark' });
    if (journeyTo) pins.push({ x: journeyTo.x, y: journeyTo.y, label: journeyTo.name, kind: 'to' });
    const r = journeyRoute.route;
    if (!pins.length && !r && !paleoState && !linked) return undefined;
    return {
      pins,
      linked,
      route: r && r.cells.length > 1 ? { cells: r.cells, color: journeyRoute.color } : undefined,
      paleo: paleoState && data ? (() => {
        const pm = paleoMap(data, paleoState);
        // Named here, where the world's own feature names are to hand: a bridge
        // between two continents is only interesting if you can say which two.
        if (geography) nameBridges(data, geography.features, pm);
        return pm;
      })() : undefined,
    };
  }, [journeyFrom, journeyTo, journeyVia, journeyRoute, paleoState, data, linked, geography]);
  useEffect(() => {
    setGeography(null);
    geoRev.current = -1;
  }, [data]);
  /**
   * Bring the human geography up to date whenever a view that shows it opens.
   *
   * The condition used to be "there is no geography yet", and skipping the
   * rebuild while sculpting turned that into a bug: sculpt for a while, go back
   * to the carta, and the geography is present but stale, so the guard passes it
   * over and the map draws the coastline the reader just changed with the towns
   * that were on the old one. The revision is what has to be compared, not the
   * presence.
   */
  useEffect(() => {
    if (!needsGeo || !data) return;
    // NOT WHILE A BRUSH IS OUT. Rebuilding costs one and a half seconds at
    // `places` and nineteen at `full`, and a reader mid-stroke wants neither —
    // the cheap patch in `afterEdit` keeps the dots honest until they stop.
    if (brushingRef.current) return;
    const rev = data.revision ?? 0;
    // Two ways to be out of date, and they need different answers. A cheap patch
    // of the current revision is REPAIRED by a full pass; a missing or shallow
    // build is simply BUILT. Asking `getGeography` in the first case would hand
    // back the same patch it already has and the roads would never catch up.
    const stale = geographyIsStale(data, geoDepth);
    if (geography && geoRev.current === rev && !stale) return;
    setGeoBusy(true);
    const id = window.setTimeout(() => {
      try {
        geoRev.current = rev;
        setGeography(stale ? rebuildGeography(data, geoDepth) : getGeography(data, geoDepth));
      } finally {
        setGeoBusy(false);
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [needsGeo, geoDepth, brushIsOut, data, geography, paintRev]);

  // ---- painting ------------------------------------------------------------
  // A world is stored as seed + params + edit list, so the session holds the list
  // and a pristine snapshot; the world object itself is mutated in place and its
  // revision counter is what tells every cache and the map to redraw.
  useEffect(() => {
    if (!paintable) setTool((t) => (t.mode === 'off' ? t : { ...t, mode: 'off' }));
  }, [paintable]);

  const [painting, setPainting] = useState(false);
  const session = useRef<PaintSession | null>(null);
  /**
   * The stored strokes, read ONCE.
   *
   * Saving them updates the world row, which hands this component a new `world`
   * prop; reading `world.edits` on every render would then rebuild the session
   * from what was just written and undo the reader's undo.
   */
  const savedEdits = useRef<string | undefined>(world.edits);
  useEffect(() => {
    if (!data) { session.current = null; return; }
    // The cached world object carries whatever the last session painted on it,
    // so it is put back the way the generator left it before the list is
    // replayed — otherwise the strokes apply on top of themselves.
    restorePristine(data);
    const stored = savedEdits.current;
    let initial: WorldEdit[] = [];
    if (stored) {
      try {
        initial = deserializeEdits(stored);
      } catch (err) {
        console.warn('[worldgen] no se pudieron leer las ediciones guardadas', err);
      }
    }
    session.current = new PaintSession(data, initial);
    setPaintRev(initial.length);
  }, [data, restorePristine]);

  // Written after the world has settled rather than on every stroke: a terrain
  // stroke is followed by more terrain strokes, and a write per stroke is a
  // write per fifty milliseconds of somebody drawing a coastline.
  const saveTimer = useRef(0);
  const saveEditsRef = useRef(onSaveEdits);
  saveEditsRef.current = onSaveEdits;
  const scheduleSaveEdits = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const json = session.current?.serialize();
      if (json === undefined || json === savedEdits.current) return;
      savedEdits.current = json;
      void saveEditsRef.current(json);
    }, 900);
  }, []);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // A full geography rebuild is ~4 s. After a stroke we take the cheap patch —
  // painted marks appear at once, anything drowned disappears — and schedule the
  // real rebuild for when the reader stops painting, so roads and realms catch up
  // without a four-second stall between brush strokes.
  const afterEdit = useCallback(() => {
    // A stroke gets the PATCH and nothing else: two milliseconds, measured.
    // Painted marks appear at once and anything drowned disappears, while roads,
    // realms and named seas stay as they were.
    //
    // What used to be here — a full rebuild scheduled 2.2 s after every stroke —
    // is the freeze Luis reported. On a 2048-wide world that pass is nineteen
    // seconds, and it fired every time he stopped moving the brush. The rebuild
    // now belongs to the effect above, which runs when the brush goes away.
    if (data && needsGeoRef.current) {
      geoRev.current = data.revision ?? 0;
      setGeography(getGeography(data, geoDepthRef.current));
    }
    setPaintRev((r) => r + 1);
    scheduleSaveEdits();
  }, [data, scheduleSaveEdits]);

  const applyEdit = useCallback((edit: WorldEdit) => {
    const s = session.current;
    if (!s) return;
    setPainting(true);
    // One frame of breathing room so the brush ring clears and the busy flag
    // paints before the main thread blocks on the edit.
    window.setTimeout(() => {
      try {
        s.push(edit);
      } finally {
        setPainting(false);
        afterEdit();
      }
    }, 0);
  }, [afterEdit]);

  /**
   * Several edits as ONE step.
   *
   * A symmetric brush stroke is genuinely two or four edits — the storage contract
   * has no notion of a mirrored stroke and should not grow one — but it is a single
   * movement of the reader's hand, so it is a single Ctrl+Z and a single replay.
   */
  const applyEditGroup = useCallback((edits: WorldEdit[]) => {
    const s = session.current;
    if (!s || !edits.length) return;
    setPainting(true);
    window.setTimeout(() => {
      try {
        s.pushMany(edits);
      } finally {
        setPainting(false);
        afterEdit();
      }
    }, 0);
  }, [afterEdit]);

  /**
   * Rename one generated thing, from wherever the reader is looking at it.
   *
   * Both callers hand over a key that `editKey` produced, so the target comes
   * back out of the key rather than being passed alongside it and drifting.
   * The cheap geography patch applies renames, so the label on the map changes
   * within a millisecond of the edit — no rebuild, no wait.
   */
  const renameByKey = useCallback((key: string, name: string) => {
    const target = targetFromKey(key);
    if (!target) return;
    applyEdit({ kind: 'rename', target, key, name });
  }, [applyEdit]);

  const removeByKey = useCallback((key: string) => {
    const target = targetFromKey(key);
    if (target) applyEdit({ kind: 'remove', target, key });
  }, [applyEdit]);

  /**
   * What a click on a town means, which depends on what is in the reader's hand.
   *
   * With the road tool out it is one end of a road; with the journey panel open
   * it is one end of a journey; otherwise it opens the town. Three meanings for
   * one gesture is usually a smell, but here the tool IS the mode indicator and
   * the alternative is three different ways to point at the same dot.
   */
  const pickSettlement = useCallback((s: Settlement) => {
    if (brushIsOut && brush.mode === 'road') {
      if (!roadFrom) { setRoadFrom(s); return; }
      setRoadFrom(null);
      if (roadFrom.id === s.id || !data || !geography) return;
      // A* over the real ground, the same search the journey planner runs, so a
      // road laid by hand goes through the pass instead of over the mountain.
      const r = planRoute(data, geography, roadFrom, s, { mode: 'cart', season: 'summer' });
      if (r.impossible || r.cells.length < 2) {
        toast.error('No hay ruta por tierra entre esas dos poblaciones');
        return;
      }
      const W = data.width;
      applyEdit({
        kind: 'road',
        pts: r.cells.map((c) => ({ x: c % W, y: Math.floor(c / W) })),
        major: brush.roadMajor,
      });
      return;
    }
    if (journeyPick === 'from') { setJourneyFrom(s); setJourneyPick('to'); return; }
    if (journeyPick === 'to') { setJourneyTo(s); setJourneyPick(null); return; }
    if (journeyPick === 'via') {
      setJourneyVia((v) => (v.some((q) => q.id === s.id) ? v : [...v, s]));
      return;
    }
    setCityFor(s);
  }, [brushIsOut, brush.mode, brush.roadMajor, roadFrom, data, geography, journeyPick, applyEdit]);

  // Putting the tool away abandons a half-drawn road.
  useEffect(() => {
    if (!brushIsOut || brush.mode !== 'road') setRoadFrom(null);
  }, [brushIsOut, brush.mode]);

  const undoEdit = useCallback(() => {
    const s = session.current;
    if (!s?.canUndo) return;
    s.undo();
    afterEdit();
  }, [afterEdit]);

  const redoEdit = useCallback(() => {
    const s = session.current;
    if (!s?.canRedo) return;
    s.redo();
    afterEdit();
  }, [afterEdit]);

  const clearEdits = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.clear();
    afterEdit();
  }, [afterEdit]);

  useEffect(() => {
    const u = () => undoEdit();
    const r = () => redoEdit();
    window.addEventListener('wg-undo', u);
    window.addEventListener('wg-redo', r);
    return () => { window.removeEventListener('wg-undo', u); window.removeEventListener('wg-redo', r); };
  }, [undoEdit, redoEdit]);

  const theme = useMemo(() => themeById(themeId), [themeId]);

  const handleGenerate = useCallback(() => {
    onSaveParams(params);
    generate(params);
  }, [params, onSaveParams, generate]);

  /**
   * Drop a pin.
   *
   * Reached from the Punto tool with Chincheta selected, in 2D or in 3D. It
   * deliberately does NOT jump back to the pin list: the reader who chose the
   * pin tool is usually placing several, and being thrown out of the brush box
   * after each one was the old placing-mode behaviour that this replaces.
   */
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
  }, [projectId, world.id, waypoints.length, addWaypoint, t]);

  const dropWaypoint = useCallback(async (id: string) => {
    await removeWaypoint(id);
    setSelectedWaypointId((cur) => (cur === id ? null : cur));
  }, [removeWaypoint]);

  const flyTo = useCallback((u: number, v: number) => {
    setFlyTarget({ u, v, token: Date.now() });
    setView('3d');
  }, []);

  // ---- Exports -----------------------------------------------------------
  const exportPng = useCallback(() => {
    if (!data) return;
    // Export what's on screen: current view mode AND current projection.
    let canvas: HTMLCanvasElement;
    if (projection === 'equirect') {
      canvas = compositeToCanvas(data, viewMode, showRivers);
    } else {
      const px = renderComposite(data, viewMode, showRivers);
      const { px: proj, w, h } = reprojectRgba(px, data.width, data.height, projection);
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.putImageData(new ImageData(proj, w, h), 0, 0);
    }
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${safeName(world.title)}-${viewMode}-${projection}.png`);
    }, 'image/png');
    setExportOpen(false);
  }, [data, viewMode, showRivers, projection, world.title]);

  const exportCarta = useCallback(() => {
    if (!data) return;
    setExportOpen(false);
    const canvas = renderCartoCanvas(data, {
      theme,
      width: 4096,
      height: 2048,
      layers: cartoLayers,
      reliefAmount,
      geography: geography ?? undefined,
      title: world.title,
      subtitle: t('worldgen.export.atlasSuffix'),
      typeScale: 1.5,
    });
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${safeName(world.title)}-carta.png`);
    }, 'image/png');
  }, [data, theme, cartoLayers, reliefAmount, geography, world.title, t]);

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

  // 'loading' is not a pipeline stage — it is the snapshot coming back off the
  // disk — so it does not go looking for a translation of a stage name.
  const stageLabel = !gen.running ? ''
    : gen.stage === 'loading' ? 'recuperando el mundo guardado…'
      : t(`worldgen.stage.${gen.stage}`);
  const selectedWaypoint = useMemo(
    () => waypoints.find((w) => w.id === selectedWaypointId) ?? null,
    [waypoints, selectedWaypointId],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Toolbar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View switch. The order is the order of importance. */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <ToolbarTab active={view === '3d'} onClick={() => setView('3d')} icon={Box} label="Mundo 3D" disabled={!data} />
          <ToolbarTab active={view === 'map'} onClick={() => setView('map')} icon={MapIcon} label={t('worldgen.view.map')} />
          <ToolbarTab active={view === 'carta'} onClick={() => setView('carta')} icon={ScrollText} label="Carta" disabled={!data} />
        </div>

        {/* 2D view-mode + projection selects */}
        {view === 'map' && (
          <>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-gold/60"
            >
              {VIEW_MODES.map((m) => (
                <option key={m} value={m}>{t(`worldgen.viewMode.${m}`)}</option>
              ))}
            </select>
            <select
              value={projection}
              onChange={(e) => setProjection(e.target.value as Projection)}
              title={t('worldgen.projection.title')}
              className="bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-gold/60"
            >
              {PROJECTION_IDS.map((p) => (
                <option key={p} value={p}>{t(`worldgen.projection.${p}`)}</option>
              ))}
            </select>
          </>
        )}

        {/* Carta: theme, layer toggles, relief density */}
        {(view === 'carta' || (view === '3d' && skin3D === 'dibujado')) && (
          <select
            value={themeId}
            onChange={(e) => setThemeId(e.target.value)}
            title="Estilo cartográfico"
            className="bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-gold/60"
          >
            {THEMES.map((th) => (
              <option key={th.id} value={th.id}>{th.name}</option>
            ))}
          </select>
        )}
        {view === 'carta' && (
          <>
            <div className="flex items-center gap-1">
              <OverlayToggle active={cartoLayers.forests !== false} onClick={() => setCartoLayers((l) => ({ ...l, forests: l.forests === false }))} icon={Trees} title="Bosques" />
              <OverlayToggle active={cartoLayers.roads !== false} onClick={() => setCartoLayers((l) => ({ ...l, roads: l.roads === false }))} icon={Route} title="Caminos" />
              <OverlayToggle active={cartoLayers.settlements !== false} onClick={() => setCartoLayers((l) => ({ ...l, settlements: l.settlements === false }))} icon={Landmark} title="Ciudades" />
              <OverlayToggle active={cartoLayers.labels !== false} onClick={() => setCartoLayers((l) => ({ ...l, labels: l.labels === false }))} icon={Signpost} title="Nombres" />
              <OverlayToggle active={cartoLayers.borders === true} onClick={() => setCartoLayers((l) => ({ ...l, borders: l.borders !== true }))} icon={Globe} title="Fronteras" />
              <OverlayToggle active={cartoLayers.frame !== false} onClick={() => setCartoLayers((l) => ({ ...l, frame: l.frame === false, compass: l.frame === false, scaleBar: l.frame === false }))} icon={Compass} title="Marco y rosa de los vientos" />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Cuánta tierra recibe símbolos de relieve">
              Relieve
              <input
                type="range" min={0.3} max={2} step={0.1}
                value={reliefAmount}
                onChange={(e) => setReliefAmount(Number(e.target.value))}
                className="w-20 accent-accent-gold"
              />
            </label>
          </>
        )}

        {/* 3D skin switch */}
        {view === '3d' && (
          <div className="flex rounded-lg border border-border overflow-hidden">
            {SKINS_3D.map((s) => (
              <button
                key={s.id}
                onClick={() => setSkin3D(s.id)}
                title={s.title}
                className={`px-3 py-1.5 text-xs transition ${
                  skin3D === s.id
                    ? 'bg-accent-gold/15 text-accent-gold'
                    : 'bg-elevated text-text-muted hover:text-text-primary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* 3D shape switch */}
        {view === '3d' && (
          <div className="flex rounded-lg border border-border overflow-hidden">
            {SHAPES_3D.map((s) => (
              <button
                key={s}
                onClick={() => setShape3D(s)}
                className={`px-3 py-1.5 text-xs transition ${
                  shape3D === s
                    ? 'bg-accent-gold/15 text-accent-gold'
                    : 'bg-elevated text-text-muted hover:text-text-primary'
                }`}
              >
                {t(`worldgen.threeD.shape.${s}`)}
              </button>
            ))}
          </div>
        )}

        {/* Overlay toggles */}
        <div className="flex items-center gap-1">
          <OverlayToggle active={showRivers} onClick={() => setShowRivers(!showRivers)} icon={Waves} title={t('worldgen.overlay.rivers')} />
          <OverlayToggle active={showLandmarks} onClick={() => setShowLandmarks(!showLandmarks)} icon={Flame} title={t('worldgen.overlay.landmarks')} />
          <OverlayToggle active={showWaypoints} onClick={() => setShowWaypoints(!showWaypoints)} icon={MapPin} title={t('worldgen.overlay.waypoints')} />
          {view !== 'carta' && (
            <OverlayToggle
              active={showSettlements}
              onClick={() => setShowSettlements(!showSettlements)}
              icon={Landmark}
              title="Ciudades — pincha una para abrir su plano"
            />
          )}
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
              <ExportItem icon={ScrollText} label="Carta dibujada (4K)" onClick={exportCarta} />
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
              projection={projection}
              showRivers={showRivers}
              showLandmarks={showLandmarks}
              showWaypoints={showWaypoints}
              showGrid={showGrid}
              waypoints={waypoints}
              selectedWaypointId={selectedWaypointId}
              onPlaceWaypoint={handlePlace}
              onRemoveWaypoint={dropWaypoint}
              onSelectWaypoint={setSelectedWaypointId}
              geography={geography}
              showSettlements={showSettlements}
              tool={paintable ? tool : undefined}
              onEdit={paintable ? applyEdit : undefined}
              onPickSettlement={pickSettlement}
              onOpenRegion={(x, y) => setRegionAt({ x, y })}
              revision={paintRev}
            />
          )}
          {data && view === 'carta' && (
            !geography ? <EngineSpinner /> : (
              <CartoMap
                world={data}
                theme={theme}
                geography={geography}
                layers={cartoLayers}
                density={1}
                reliefAmount={reliefAmount}
                title={world.title}
                subtitle={t('worldgen.export.atlasSuffix')}
                onPickSettlement={pickSettlement}
                annotations={annotations}
                onOpenRegion={(x, y) => setRegionAt({ x, y })}
                onInspect={panelTab === 'atlas' && data && geography
                  ? ((x, y) => {
                    // Anything with a name, not only the dots: a click on the
                    // Mar de X has to select the Mar de X, or half the places
                    // the manuscript can point at are unreachable by pointing.
                    const p = placeAt(buildAtlas(data, geography), data, x, y, 10);
                    setAtlasKey(p ? p.key : null);
                  })
                  : undefined}
              />
            )
          )}
          {data && view === '3d' && (
            <Suspense fallback={<EngineSpinner />}>
              <World3D
                world={data}
                geography={geography}
                theme={theme}
                waypoints={waypoints}
                showWaypoints={showWaypoints}
                showSettlements={showSettlements}
                skin={skin3D}
                shape={shape3D}
                onShape={setShape3D}
                exaggeration={exaggeration}
                tool={brush}
                onTool={(p) => setTool((prev) => ({ ...prev, ...p }))}
                onEdit={applyEdit}
                onEdits={applyEditGroup}
                revision={paintRev}
                flyTarget={flyTarget}
                onPickSettlement={pickSettlement}
                onPickWaypoint={(id) => {
                  setSelectedWaypointId(id);
                  setPanelTab('waypoints');
                }}
                onPlaceWaypoint={handlePlace}
                onRemoveWaypoint={dropWaypoint}
                onOpenRegion={(x, y) => setRegionAt({ x, y })}
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
        <aside className="w-[21rem] shrink-0 flex flex-col rounded-xl border border-border bg-surface/50 overflow-hidden">
          {/* Six tabs do not fit across a 336 px panel, and squeezing them was
              why the labels were unreadable. Two rows of three, each with room
              for its own word. */}
          <div className="grid grid-cols-3 border-b border-border">
            <PanelTab active={panelTab === 'params'} onClick={() => setPanelTab('params')} label={t('worldgen.params.title')} />
            <PanelTab active={panelTab === 'world'} onClick={() => setPanelTab('world')} label="Mundo" />
            <PanelTab
              active={panelTab === 'paint'}
              onClick={() => { setPanelTab('paint'); if (view === 'carta') setView('3d'); }}
              label={`Pincel${paintRev ? ` (${paintRev})` : ''}`}
            />
            <PanelTab active={panelTab === 'waypoints'} onClick={() => setPanelTab('waypoints')} label={`${t('worldgen.waypoints.title')}${waypoints.length ? ` (${waypoints.length})` : ''}`} />
            <PanelTab active={panelTab === 'journey'} onClick={() => { setPanelTab('journey'); setView('carta'); }} label="Viaje" />
            <PanelTab active={panelTab === 'atlas'} onClick={() => { setPanelTab('atlas'); setView('carta'); }} label="Índice" />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {panelTab === 'atlas' ? (
              data && geography ? (
                <AtlasPanel
                  world={data}
                  geography={geography}
                  links={manuscriptLinks ?? []}
                  selectedKey={atlasKey}
                  onSelect={setAtlasKey}
                  onRename={renameByKey}
                  onDelete={removeByKey}
                  onFlyTo={(x, y) => flyTo(x / data.width, y / data.height)}
                  onOpenLink={onOpenManuscriptLink}
                />
              ) : (
                <p className="text-[11px] text-white/45">
                  Abre la carta para usar el índice: hace falta la geografía humana.
                </p>
              )
            ) : panelTab === 'journey' ? (
              data && geography ? (
                <JourneyPanel
                  world={data}
                  geography={geography}
                  from={journeyFrom}
                  to={journeyTo}
                  picking={journeyPick}
                  onPick={setJourneyPick}
                  onSwap={() => { setJourneyFrom(journeyTo); setJourneyTo(journeyFrom); }}
                  onClear={() => { setJourneyFrom(null); setJourneyTo(null); setJourneyVia([]); setJourneyPick(null); }}
                  via={journeyVia}
                  onClearVia={() => setJourneyVia([])}
                  onRoute={(route, color) => setJourneyRoute({ route, color })}
                  paleo={paleoState}
                  onPaleo={setPaleoState}
                />
              ) : (
                <p className="text-[11px] text-white/45">
                  Abre la carta para medir distancias: hacen falta las calzadas y las ciudades.
                </p>
              )
            ) : panelTab === 'world' ? (
              <FiltersPanel
                params={params}
                onChange={setParams}
                onGenerate={handleGenerate}
                generating={gen.running}
                hasWorld={!!data}
              />
            ) : panelTab === 'paint' ? (
              <PaintPanel
                tool={tool}
                onChange={setTool}
                strokeCount={session.current?.edits.length ?? 0}
                canUndo={!!session.current?.canUndo}
                canRedo={!!session.current?.canRedo}
                onUndo={undoEdit}
                onRedo={redoEdit}
                onClear={clearEdits}
                onExport={() => {
                  const json = session.current?.serialize();
                  if (!json) return;
                  void navigator.clipboard?.writeText(json);
                  toast.success('Ediciones copiadas al portapapeles');
                }}
                cellKm={Math.round(40075 / (data?.width ?? 1024))}
                busy={painting}
              />
            ) : panelTab === 'params' ? (
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
                onDelete={dropWaypoint}
                placing={pinning}
                onTogglePlacing={() => {
                  // "Añadir chincheta" is no longer a mode of its own: it picks
                  // the Punto tool with Chincheta, which is the same gesture
                  // that places a town or a name, and works in 2D and in 3D.
                  if (pinning) { setTool((p) => ({ ...p, mode: 'off' })); return; }
                  setTool((p) => ({ ...p, mode: 'point', point: 'waypoint' }));
                  if (view === 'carta') setView('3d');
                  setPanelTab('paint');
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
        {geoBusy && <span className="ml-3 text-accent-gold/80">recalculando calzadas y fronteras…</span>}
        {brushIsOut && brush.mode === 'road' && (
          <span className="ml-3 text-accent-gold">
            {roadFrom ? `Camino desde ${roadFrom.name} — pincha la otra punta` : 'Pincha la población de partida'}
          </span>
        )}
        {geography && (
          <span className="ml-3">
            {geography.settlements.length} asentamientos · {geography.realms.length} reinos ·
            {' '}{geography.ruins.length} ruinas
            {view !== 'carta' && brush.mode !== 'off'
              ? ' · arrastra para pintar'
              : ' · pincha una ciudad para ver su plano · doble clic para bajar a la comarca'}
          </span>
        )}
      </div>

      {/* ---- Regional sheet: the scale between the world and the town ---- */}
      {data && geography && regionAt && (
        <RegionSheetView
          world={data}
          geography={geography}
          theme={theme}
          at={regionAt}
          onClose={() => setRegionAt(null)}
          onPickSettlement={setCityFor}
        />
      )}

      {/* ---- City plan ---- */}
      {data && cityFor && (
        <CityPlanView
          world={data}
          settlement={cityFor}
          theme={theme}
          onClose={() => setCityFor(null)}
          onDelete={() => removeByKey(editKey('settlement', cityFor.x, cityFor.y))}
          onRename={(name) => {
            renameByKey(editKey('settlement', cityFor.x, cityFor.y), name);
            // The open modal holds the settlement it was given, and the patched
            // geography hands back new objects — so the name in front of the
            // reader is updated here rather than waiting for a round trip.
            setCityFor((c) => (c ? { ...c, name } : c));
          }}
        />
      )}
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
