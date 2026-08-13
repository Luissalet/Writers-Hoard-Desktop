import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomSeed } from '../randomSeed';
import {
  Map as MapIcon, Box, Dices, Download, Waves, Flame, MapPin, Globe,
  Loader2, X, ChevronDown, Send, Mountain, ScrollText, Trees, Route, Landmark,
  Signpost, Compass, Flag, Search, Home,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { ConfirmDialog, EngineSpinner } from '@/engines/_shared';
import { generateId } from '@/utils/idGenerator';
import { worldMapOps, mapPinOps } from '@/engines/maps/operations';
import type {
  GeneratedWorld,
  SavedWorldRegion,
  WorldViewport,
  WorldWaypoint,
} from '../types';
import { WAYPOINT_COLORS } from '../types';
import type { ViewMode, WorldData, WorldParams } from '../core/types';
import {
  doubleClickSpanKm, EARTH_KM, type FlyTarget,
} from '../core/camera';
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
import LocatorPanel from './LocatorPanel';
import PaintPanel, { DEFAULT_PAINT_TOOL, type PaintTool } from './PaintPanel';
import FiltersPanel from './FiltersPanel';
import SavedRegionsPanel from './SavedRegionsPanel';
import SpatialEntityInspector from './SpatialEntityInspector';
import { PaintSession } from '../core/paintSession';
import { deserializeEdits, editKey, sitesPolicyFrom, targetFromKey } from '../core/edits';
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
import {
  resolveWorldLandmarks,
  resolveWorldSpatialEntity,
  type WorldSpatialEntity,
  type WorldSpatialStyleOverride,
} from '../core/spatialEntities';
import { regionKindVisible, semanticZoomProfile } from '../core/semanticZoom';
import { regionClient, requestRegion } from '../region/client';
import { bindCanonWorld, registerCanonPersistence } from '../canonSnapshots';

// Canon supertiles persist across sessions from the moment the engine loads
// (PENDIENTE §2b.1). Module scope on purpose: the registration must exist
// before the FIRST tile request, and every view that can ask for tiles lives
// under this component's bundle.
registerCanonPersistence();
import { requestCanonComposite, CANON_LOD_MAX_KM } from '../region/tileClient';
import type { RegionData } from '../region/types';

// three.js and the surface shader are the heaviest thing in the engine, so they
// still arrive on demand — but this IS the opening view now, so the chunk is
// requested the moment the module loads rather than on a first click.
const World3D = lazy(() => import('./World3D'));

const VIEW_MODES: ViewMode[] = ['atlas', 'elevation', 'temperature', 'precipitation', 'plates', 'flow'];
const SHAPES_3D: Shape3D[] = ['plane', 'globe'];
const SKINS_3D: { id: Skin3D; label: string; title: string }[] = [
  { id: 'satelite', label: 'worldgen.view.skin.satellite', title: 'worldgen.view.skin.satellite.title' },
  { id: 'dibujado', label: 'worldgen.view.skin.drawn', title: 'worldgen.view.skin.drawn.title' },
  { id: 'arcilla', label: 'worldgen.view.skin.clay', title: 'worldgen.view.skin.clay.title' },
];

export interface WaypointFocus {
  id: string;
  /** Monotonic token so the same waypoint can be re-focused later. */
  token: number;
}

export interface SpatialFocus {
  id: string;
  token: number;
}

export interface RegionFocus {
  id: string;
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
  /** Persist lightweight named regional views; generated regional pixels stay derived. */
  onSaveRegions: (regions: SavedWorldRegion[]) => Promise<void> | void;
  onThumbnail: (thumbnail: string) => Promise<void> | void;
  focusWaypoint: WaypointFocus | null;
  focusSpatial?: SpatialFocus | null;
  focusRegion?: RegionFocus | null;
}

export default function WorldView({
  projectId,
  world,
  manuscriptLinks,
  onOpenManuscriptLink,
  onSaveParams,
  onSaveEdits,
  onSaveRegions,
  onThumbnail,
  focusWaypoint,
  focusSpatial,
  focusRegion,
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
  /**
   * The last view that could be painted on.
   *
   * The panel tabs that need the carta (Índice, Viaje) send you there, and the
   * Pincel tab used to send you back to a hardcoded `'3d'` — so a reader working
   * in the 2D who glanced at the index came back to the globe, every time. What
   * "back" means is where you were, not a constant.
   */
  const lastPaintableView = useRef<'3d' | 'map'>('3d');
  if (view !== 'carta') lastPaintableView.current = view;
  const [themeId, setThemeId] = useState<string>('wonder');
  const [skin3D, setSkin3D] = useState<Skin3D>('satelite');
  const [cityFor, setCityFor] = useState<Settlement | null>(null);
  const [regionAt, setRegionAt] = useState<{ x: number; y: number; savedId?: string } | null>(null);
  const [savedRegions, setSavedRegions] = useState<SavedWorldRegion[]>(() => world.regions ?? []);
  const [viewport, setViewport] = useState<WorldViewport>({
    u: 0.5,
    v: 0.5,
    spanKm: 40075,
  });
  const [cartoLayers, setCartoLayers] = useState<Partial<CartoLayers>>({
    relief: true, forests: true, labels: true, settlements: true,
    roads: true, borders: false, frame: true, compass: true, scaleBar: true,
  });
  /**
   * Relief symbol density: what the reader drags, and what the Carta is
   * actually rebuilt from.
   *
   * They have to be two values. `reliefAmount` is a raw dependency of
   * CartoMap's from-scratch effect, which clears the settle timers and renders
   * the whole sheet SYNCHRONOUSLY at full resolution — and it is also part of
   * the tile-store generation key, so every intermediate step wipes and
   * re-rasterises every resident tile. Dragging 0,3 → 2,0 at a step of 0,1 is
   * eighteen full renders and eighteen store wipes, which is precisely the
   * "recalcularse a lo loco" the reader reported. The dragged value moves the
   * handle; the settled one, 240 ms after the hand stops, moves the map.
   */
  const [reliefAmount, setReliefAmount] = useState(1);
  const [reliefSettled, setReliefSettled] = useState(1);
  const reliefTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(reliefTimer.current), []);
  const bumpRelief = useCallback((v: number) => {
    setReliefAmount(v);
    window.clearTimeout(reliefTimer.current);
    reliefTimer.current = window.setTimeout(() => setReliefSettled(v), 240);
  }, []);
  const [viewMode, setViewMode] = useState<ViewMode>('atlas');
  const [projection, setProjection] = useState<Projection>('equirect');
  const [shape3D, setShape3D] = useState<Shape3D>('plane');
  const [showRivers, setShowRivers] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [showSettlements, setShowSettlements] = useState(true);
  /** Calzadas on the 2D map. On by default: the Camino brush lays roads
   *  between the ones already there, and a layer you have to find a switch for
   *  before you can see what you are drawing is not on by default at all. */
  const [showRoads, setShowRoads] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [panelTab, setPanelTab] = useState<
    'params' | 'waypoints' | 'paint' | 'world' | 'journey' | 'atlas' | 'regions' | 'places'
  >('params');
  const [atlasKey, setAtlasKey] = useState<string | null>(null);
  const [selectedSpatialKey, setSelectedSpatialKey] = useState<string | null>(null);
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
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  /** First end of a road being laid, waiting for its second click. */
  const [roadFrom, setRoadFrom] = useState<Settlement | null>(null);
  const [exaggeration, setExaggeration] = useState(30);
  const [exportOpen, setExportOpen] = useState(false);
  /** El localizador: Ctrl+F o la lupa, en las tres vistas. */
  const [locatorOpen, setLocatorOpen] = useState(false);
  // Declared up here with the rest of the view state rather than down in the
  // painting section, because whether a brush is out decides when the human
  // geography may be rebuilt — and that effect runs above it.
  const [tool, setTool] = useState<PaintTool>(DEFAULT_PAINT_TOOL);
  // Same reason: a stroke bumps this, and the geography effect has to notice.
  const [paintRev, setPaintRev] = useState(0);
  const [regionDetail, setRegionDetail] = useState<RegionData | null>(null);
  const [regionDetailBusy, setRegionDetailBusy] = useState(false);
  const [regionDetailStage, setRegionDetailStage] = useState('');

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
  const globalSpatialEntities = useMemo(
    () => {
      void paintRev;
      return data ? resolveWorldLandmarks(data, { includeHidden: true }) : [];
    },
    // Edits mutate the cached world in place; paintRev is its React revision.
    [data, paintRev],
  );

  const persistRegions = useCallback((next: SavedWorldRegion[]) => {
    setSavedRegions(next);
    void onSaveRegions(next);
  }, [onSaveRegions]);

  const saveRegion = useCallback((value: SavedWorldRegion) => {
    const existing = savedRegions.some((region) => region.id === value.id);
    persistRegions(existing
      ? savedRegions.map((region) => (region.id === value.id ? value : region))
      : [...savedRegions, value]);
  }, [persistRegions, savedRegions]);

  const openSavedRegion = useCallback((region: SavedWorldRegion) => {
    const width = data?.width ?? world.params.width;
    const height = data?.height ?? Math.max(1, Math.round(world.params.width / 2));
    setRegionAt({ x: region.x, y: region.y, savedId: region.id });
    setViewport({
      u: ((region.x / Math.max(1, width)) % 1 + 1) % 1,
      v: Math.min(1, Math.max(0, region.y / Math.max(1, height))),
      spanKm: region.spanKm,
    });
  }, [data, world.params.width]);

  const saveCurrentRegion = useCallback(() => {
    const now = Date.now();
    const region: SavedWorldRegion = {
      id: generateId('region'),
      title: t('worldgen.regions.defaultTitle').replace('{n}', String(savedRegions.length + 1)),
      x: viewport.u * (data?.width ?? world.params.width),
      y: viewport.v * (data?.height ?? Math.max(1, Math.round(world.params.width / 2))),
      spanKm: Math.min(400, Math.max(30, viewport.spanKm)),
      params: {
        res: 640,
        aspect: 1.55,
        detail: 0.85,
        settled: 0.62,
        habitation: 1,
        streamDensity: 0.72,
      },
      createdAt: now,
      updatedAt: now,
    };
    saveRegion(region);
    openSavedRegion(region);
  }, [data, openSavedRegion, saveRegion, savedRegions.length, viewport, world.params.width, t]);

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
  const [consumedSpatialToken, setConsumedSpatialToken] = useState(0);
  const [consumedRegionToken, setConsumedRegionToken] = useState(0);
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
  const semanticProfile = useMemo(
    () => semanticZoomProfile(viewport.spanKm),
    [viewport.spanKm],
  );

  /**
   * The paint session. DECLARED HERE, well above the painting section that
   * fills it, because the canon-source memo right below reads it DURING
   * RENDER — and a `const` binding referenced before its declaration line is
   * a TDZ ReferenceError at mount, which took the whole engine down once.
   * Order matters for anything a memo factory or a dependency array touches.
   */
  const session = useRef<PaintSession | null>(null);
  /** Which world object the current session was built over. The memo below
   *  must NEVER pair a fresh world with a stale session's pristine snapshot —
   *  regeneration changes `data` a render before the session effect catches
   *  up, and shipping that half-and-half world to the canon workers draws
   *  somebody else's strokes on the new country. */
  const sessionWorld = useRef<WorldData | null>(null);
  /** The seed the stored strokes belong to. */
  const editsSeed = useRef<string>(world.params.seed);
  /** Armed by Regenerar; consumed by the session effect when new data lands. */
  const cleanSlate = useRef(false);

  // A new world object (regenerate, load, restore) makes every cached canon
  // tile and idle worker of the previous one dead weight — free it eagerly.
  // At 1024-width a full canon cache is ~hundreds of MB; waiting for
  // count-based eviction to reach it was a slow leak with a fast ending.
  useEffect(() => {
    regionClient.newEpoch();
  }, [data]);

  /**
   * The world the CANONICAL tiles amplify: pristine elevation + the edit list,
   * so every stroke is re-applied at tile resolution instead of arriving as a
   * baked-in world-grid smudge (and never twice — see region/canonEdits.ts).
   * `painted` rides along: hand rivers/roads/markers reach the tiles as
   * first-class vectors. New object per stroke on purpose — every canon cache
   * keys on world identity, and a stroke really is a different country.
   */
  /**
   * The canon the deep tiles are cut from — and its IDENTITY is a cache key.
   *
   * `Map2D` hashes this object to decide whether the whole satellite pyramid is
   * still valid. It used to be rebuilt on every `paintRev`, which meant every
   * edit: a rename, a population, a pin, a style. None of those can change a
   * square metre of ground, and all of them closed every cached bitmap,
   * cancelled every in-flight tile and re-queued a pyramid that would come back
   * byte-identical — measured at street zoom, ~320 tiles thrown away and dozens
   * of multi-second canon builds re-run, for renaming a town.
   *
   * So the memo is keyed on the SERIALISED EDIT LIST, and returns the previous
   * object unchanged when that text has not moved. The edit list is the honest
   * dependency: two worlds with the same seed and the same edits have the same
   * ground, and that is the entire question a tile is asking.
   */
  const canonPrev = useRef<{ key: string; value: { world: WorldData; edits?: string } | null }>(
    { key: '\u0000', value: null },
  );
  const canonSource = useMemo(() => {
    void paintRev;
    if (!data) return null;
    const s = sessionWorld.current === data ? session.current : null;
    const edits = s && s.edits.length ? s.serialize() : undefined;
    const key = `${data.params.seed}:${data.width}:${edits ?? ''}`;
    if (canonPrev.current.key === key && canonPrev.current.value) return canonPrev.current.value;
    const value = edits
      ? { world: { ...data, elevation: s!.pristineElevation }, edits }
      : { world: data, edits: undefined };
    /**
     * EL MUNDO PRÍSTINO TAMBIÉN SE LIGA AL ALMACÉN. `bindCanonWorld` se
     * enseñaba sólo sobre `data` (el mundo editado, en `remember`), pero las
     * teselas hondas y el calentador viajan con ESTE objeto — el prístino —
     * y para el almacén un mundo sin vínculo no persiste ni siembra nada:
     * cuarenta y una superteselas «guardadas» a la basura y «sembradas 0»
     * eternas, con cada sesión de la Forja regenerando lo que su vecina
     * acababa de pagar (las capturas de Luis, 2026-08-12). El vínculo del
     * prístino — y el respaldo por semilla dentro de `bindCanonWorld` — es
     * lo que enciende el bus entre sesiones de verdad.
     */
    bindCanonWorld(value.world, world.id);
    canonPrev.current = { key, value };
    return value;
  }, [data, paintRev, world.id]);

  /** La política de sembrado vigente (tick + zonas), deserializada UNA vez por
   *  cambio de ediciones — no en cada render — para la hoja libre y la de
   *  comarca, que viajan con el mundo editado y no pueden mandar `edits`. */
  const worldSitesPolicy = useMemo(
    () => sitesPolicyFrom(canonSource?.edits ? deserializeEdits(canonSource.edits) : undefined),
    [canonSource],
  );

  // Close-range geography follows the shared viewport. Requests are debounced,
  // cancellable, worker-backed, and leave the previous patch visible until the
  // replacement arrives.
  //
  // LA COMARCA ES DEL MAPA 2D. Y DE NADIE MÁS.
  //
  // Cada vista tiene un oficio y sólo uno:
  //   · 3D    — la topografía a grandes rasgos. Cordilleras, cuencas, costas.
  //   · 2D    — el Google Maps: caminos, ciudades, cuevas, el detalle fino.
  //   · Carta — una lámina bonita para exportar.
  //
  // Antes el 3D también pedía comarca, y de ahí salía el bloqueo que Luis
  // diagnosticó: la cámara arrancaba cerca, se generaba el terreno regional,
  // y al alejarse cada reposo de cámara pedía OTRA comarca más ancha — entre
  // 170 y 400 km ni siquiera por la vía canónica cacheada, sino por el
  // generador libre, que rehace erosión e hidrología enteras. Cada resultado
  // subía una DataTexture flotante nueva a la GPU y tiraba la anterior. El
  // 3D no se quedaba "petado" por dibujar: se quedaba petado por estar
  // generando comarcas sin parar para enseñarlas a cuarenta kilómetros por
  // píxel, donde no se distingue ninguna.
  useEffect(() => {
    if (!data || !geography || view !== 'map' || !semanticProfile.showRegionalTerrain
        || viewport.spanKm > 700) {
      setRegionDetail(null);
      setRegionDetailBusy(false);
      return;
    }
    const controller = new AbortController();
    let handle: { promise: Promise<RegionData>; cancel: () => void } | null = null;
    const timer = window.setTimeout(() => {
      setRegionDetailBusy(true);
      // Ask for a padded patch only after the camera settles. The extra gutter
      // lets several small wheel/pan updates reuse the same cached lattice
      // instead of terminating and cloning a worker context for every pose.
      const spanKm = Math.min(400, Math.max(30, viewport.spanKm * 1.7));
      // Close windows come from the CANONICAL tiles — one countryside per
      // ground, shared with everything else that looks at it. Wider regional
      // windows keep the freeform sheet until the display pyramid (P4) takes
      // them over: at those spans the ~150 m canon is oversampled anyway, and
      // a cold multi-tile fill would cost more than it shows.
      if (spanKm <= CANON_LOD_MAX_KM && canonSource) {
        handle = requestCanonComposite(
          canonSource.world,
          geography,
          { u: viewport.u, v: viewport.v, spanKm, aspect: 1.55 },
          {
            signal: controller.signal,
            edits: canonSource.edits,
            onProgress: (stage) => setRegionDetailStage(stage),
          },
        );
      } else {
        handle = requestRegion(
          data,
          geography,
          {
            cx: viewport.u * data.width,
            cy: viewport.v * data.height,
            spanKm,
          },
          {
            signal: controller.signal,
            params: {
              res: semanticProfile.regionalResolution,
              aspect: 1.55,
              // La hoja ancha obedece la MISMA política de sembrado que el
              // canon: sin el tick ni zonas, sin granjas — a cualquier vano.
              sites: 'auto',
            },
            // EXPLÍCITA, no vía `edits`: esta hoja viaja con el mundo YA
            // editado, y mandarle la lista replicaría los trazos encima dos
            // veces. La política es lo único de las ediciones que necesita.
            sitesPolicy: worldSitesPolicy,
            onProgress: (stage) => setRegionDetailStage(stage),
          },
        );
      }
      handle.promise.then((region) => {
        if (!controller.signal.aborted) setRegionDetail(region);
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.warn('[worldgen] regional LOD failed', error);
      }).finally(() => {
        if (!controller.signal.aborted) setRegionDetailBusy(false);
      });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      handle?.cancel();
    };
  }, [
    data,
    geography,
    canonSource,
    worldSitesPolicy,
    semanticProfile.regionalResolution,
    semanticProfile.showRegionalTerrain,
    view,
    viewport.spanKm,
    viewport.u,
    viewport.v,
  ]);

  const regionalSpatialEntities = useMemo(() => {
    void paintRev;
    if (!data || !regionDetail) return [];
    return regionDetail.places
      .filter((place) => regionKindVisible(place.kind, semanticProfile.tier))
      .map((place) => resolveWorldSpatialEntity({
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
      }, data.painted));
  }, [data, paintRev, regionDetail, semanticProfile.tier]);

  const spatialEntities = useMemo(
    () => [...globalSpatialEntities, ...regionalSpatialEntities],
    [globalSpatialEntities, regionalSpatialEntities],
  );
  const selectedSpatialEntity = useMemo(
    () => spatialEntities.find((entity) => entity.key === selectedSpatialKey) ?? null,
    [selectedSpatialKey, spatialEntities],
  );

  if (focusSpatial && focusSpatial.token !== consumedSpatialToken) {
    const entity = spatialEntities.find((candidate) => candidate.key === focusSpatial.id);
    if (entity && data) {
      setConsumedSpatialToken(focusSpatial.token);
      setSelectedSpatialKey(entity.key);
      setPanelTab('places');
      setView('3d');
      setFlyTarget({
        u: entity.x / data.width,
        v: entity.y / data.height,
        token: focusSpatial.token,
      });
    }
  }
  if (focusRegion && focusRegion.token !== consumedRegionToken) {
    const region = savedRegions.find((candidate) => candidate.id === focusRegion.id);
    if (region && data) {
      setConsumedRegionToken(focusRegion.token);
      setRegionAt({ x: region.x, y: region.y, savedId: region.id });
      setViewport({
        u: ((region.x / data.width) % 1 + 1) % 1,
        v: Math.min(1, Math.max(0, region.y / data.height)),
        spanKm: region.spanKm,
      });
    }
  }
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
   * That split was right when the 2D map was a picture. It is not any more: the
   * map is one of the two places the world is EDITED, and the Camino brush lays
   * roads between the roads that are already there. Asking for `places` meant
   * `geography.roads` was the empty array, so the road layer drew nothing, and
   * the named seas, the ranges and the ruins were invisible in the only view
   * where you can point at them. So the map asks for `full` too — but in TWO
   * PASSES (see the effect below), because eighteen seconds of empty map is not
   * an improvement on no roads.
   */
  const needsFullGeo = view === 'carta' || view === 'map' || skin3D === 'dibujado'
    || panelTab === 'atlas' || panelTab === 'journey';
  /**
   * The 2D and the 3D need the geography for their GROUND, not only for dots:
   * the satellite tile fetcher bails without it (`Map2D` → `regionClient`), so
   * turning the town dots off used to leave the map stuck on the 40 km raster
   * with nothing on screen explaining why.
   */
  const needsGeo = needsFullGeo || showSettlements || view === '3d';
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
  /**
   * Can this view take a stroke.
   *
   * `panelTab === 'paint'` was in here, and it made the tool disappear the
   * moment you looked at another panel — which is also what left the Chinchetas
   * button saying "Cancelar" while clicking the map placed nothing, once
   * `pinning` was fixed to be reachable. The rule the comment above describes is
   * about the CARTA, which is a finished drawing; the panel is only where the
   * tool is chosen, and the effect below already puts the brush down on the one
   * surface that must not accept paint.
   */
  const paintable = view !== 'carta';
  const brush = paintable ? tool : DEFAULT_PAINT_TOOL;
  /** The Punto tool, set to Chincheta, and actually live. */
  /**
   * A pin is being placed.
   *
   * NOT `paintable && …`: the only place that reads this is the Chinchetas
   * panel, and `paintable` requires `panelTab === 'paint'`, so it was provably
   * always false there. That made the button's "Cancelar" state unreachable and
   * two catalogue strings unrenderable. What matters is whether the VIEW can
   * take the gesture, not which panel is open.
   */
  const pinning = view !== 'carta' && tool.mode === 'point' && tool.point === 'waypoint';
  /** Strokes on the world, for the tab badge. Read during render, so it follows
   *  `paintRev` — which every edit, undo, redo and clear bumps. */
  const strokeCount = session.current?.edits.length ?? 0;
  /**
   * El grifo de los lugares aleatorios, LEÍDO de la lista de ediciones: manda
   * el último `placesEverywhere`, y sin ninguno está cerrado — el defecto que
   * pidió Luis (2026-08-12: «no he pedido abadías, casas, monasterios»).
   * Derivado y no guardado aparte, para que Ctrl+Z lo revierta como a
   * cualquier otra edición y el tick nunca pueda mentir.
   */
  const randomPlacesOn = useMemo(() => {
    void paintRev;
    const s = sessionWorld.current === data ? session.current : null;
    let on = false;
    for (const e of s?.edits ?? []) if (e.kind === 'placesEverywhere') on = e.enabled;
    return on;
  }, [data, paintRev]);
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
  /** Which of the two geography passes has landed, so the second one knows to
   *  run. Null means neither: a fresh world, or one whose ground just changed. */
  const stagedDepth = useRef<GeoDepth | null>(null);

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
    // Las comarcas guardadas también son anotación de la CARTA: guardar un
    // valle y que la carta no sepa señalarlo era tener el marcapáginas en
    // otro libro.
    const regions: NonNullable<CartoAnnotations['regions']> = savedRegions.map((rg) => ({
      x: rg.x, y: rg.y, spanKm: rg.spanKm,
      aspect: rg.params?.aspect || 1.55,
      title: rg.title,
      active: rg.id === regionAt?.savedId,
    }));
    if (!pins.length && !r && !paleoState && !linked && !regions.length) return undefined;
    return {
      pins,
      linked,
      regions: regions.length ? regions : undefined,
      route: r && r.cells.length > 1 ? { cells: r.cells, color: journeyRoute.color } : undefined,
      paleo: paleoState && data ? (() => {
        const pm = paleoMap(data, paleoState);
        // Named here, where the world's own feature names are to hand: a bridge
        // between two continents is only interesting if you can say which two.
        if (geography) nameBridges(data, geography.features, pm);
        return pm;
      })() : undefined,
    };
  }, [journeyFrom, journeyTo, journeyVia, journeyRoute, paleoState, data, linked, geography,
    savedRegions, regionAt?.savedId]);
  useEffect(() => {
    setGeography(null);
    geoRev.current = -1;
    stagedDepth.current = null;
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
    // NOT WHILE A BRUSH IS OUT — but only the expensive half.
    //
    // Bailing on both was a trap of its own: `setGeoBusy(true)` ran before the
    // bail, so picking up a brush in the 1,2 s between the two passes stranded
    // the badge at "trazando calzadas…" for as long as the tool was out, AND
    // suppressed the very pass that produces the roads the Camino brush is
    // supposed to lay a road between. The cheap pass is 400 ms; it can run.
    const brushOut = brushingRef.current;
    const rev = data.revision ?? 0;
    // Two ways to be out of date, and they need different answers. A cheap patch
    // of the current revision is REPAIRED by a full pass; a missing or shallow
    // build is simply BUILT. Asking `getGeography` in the first case would hand
    // back the same patch it already has and the roads would never catch up.
    const stale = geographyIsStale(data, geoDepth);
    if (geography && geoRev.current === rev && !stale) return;

    /**
     * TWO PASSES, because they are two different waits.
     *
     * `places` is 1,2 s and it is everything you can point at; `full` is another
     * sixteen and it is the roads, the named seas and the ruins. Doing only the
     * second means a quarter of a minute of empty map before the first dot; doing
     * only the first is what left the 2D with no roads at all. So the cheap half
     * paints immediately and the expensive half lands behind it with the badge
     * up — and because the cache never downgrades, the second pass is paid once
     * per world and every view after it is free.
     */
    const step: GeoDepth = geoDepth === 'full' && stagedDepth.current !== 'places'
      && (!geography || geoRev.current !== rev)
      ? 'places'
      : geoDepth;
    const more = step !== geoDepth;
    /**
     * The deep pass waits for the brush to go away. So does a REBUILD.
     *
     * "The cheap pass is 400 ms, it can run" was wrong in the one case that
     * matters: `rebuildGeography` never downgrades, so once the deep pass has
     * landed a request for `places` is served by a FULL rebuild — nineteen
     * seconds, on pointerup, with the brush still in hand. Only the very first
     * build (no geography at all yet) is genuinely cheap enough to run under a
     * brush; everything else waits, which is what `brushIsOut` in the dependency
     * list is for.
     */
    if (brushOut && geography) { setGeoBusy(false); return; }
    setGeoBusy(true);
    // The deep pass blocks the main thread, so it waits for an idle moment
    // rather than landing on the frame that is still painting the first one.
    const run = () => {
      try {
        geoRev.current = rev;
        stagedDepth.current = step;
        setGeography(geographyIsStale(data, step)
          ? rebuildGeography(data, step)
          : getGeography(data, step));
      } finally {
        setGeoBusy(more);
      }
    };
    if (more) {
      const t = window.setTimeout(run, 30);
      return () => window.clearTimeout(t);
    }
    const idle = window.requestIdleCallback?.(run, { timeout: 1200 });
    const t = idle === undefined ? window.setTimeout(run, 240) : 0;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      else window.clearTimeout(t);
    };
  }, [needsGeo, geoDepth, brushIsOut, data, geography, paintRev]);

  // ---- painting ------------------------------------------------------------
  // A world is stored as seed + params + edit list, so the session holds the list
  // and a pristine snapshot; the world object itself is mutated in place and its
  // revision counter is what tells every cache and the map to redraw.
  /**
   * The carta puts the brush down. Glancing at another PANEL does not.
   *
   * This used to key on `paintable`, which includes `panelTab === 'paint'` — so
   * opening Lugar to check a name disarmed the tool and threw away a half-laid
   * road, with no warning going in and none coming back. The comment above says
   * the rule is about the carta, which is a finished drawing; that is the rule
   * this now enforces, and nothing else.
   */
  useEffect(() => {
    if (view === 'carta') setTool((t) => (t.mode === 'off' ? t : { ...t, mode: 'off' }));
    /**
     * FRONTERA IS A 2D GESTURE AND ONLY A 2D GESTURE.
     *
     * `paintable` is `view !== 'carta'`, so the globe was handed the frontier
     * tool too — and `commitPaintStroke` has no case for it, so the globe drew
     * a crosshair, drew a brush ring, tracked the drag, and swallowed the click.
     * Zero edits, no message, a tool that looks armed and is not.
     *
     * The four sub-tools are all about a line seen from directly above, and
     * three of them are multi-click gestures on a flat sheet; there is no
     * version of the curved lasso that means anything on a sphere the reader is
     * also rotating. So it goes down when the map does, the way it goes down for
     * the carta.
     */
    if (view !== 'map') setTool((t) => (t.mode === 'frontera' ? { ...t, mode: 'off' } : t));
  }, [view]);

  const [painting, setPainting] = useState(false);
  // (the session ref itself is declared up by the canon-source memo — see there)
  /**
   * The stored strokes, read ONCE.
   *
   * Saving them updates the world row, which hands this component a new `world`
   * prop; reading `world.edits` on every render would then rebuild the session
   * from what was just written and undo the reader's undo.
   */
  const savedEdits = useRef<string | undefined>(world.edits);
  useEffect(() => {
    if (!data) { session.current = null; sessionWorld.current = null; return; }
    // The cached world object carries whatever the last session painted on it,
    // so it is put back the way the generator left it before the list is
    // replayed — otherwise the strokes apply on top of themselves.
    restorePristine(data);
    // Strokes follow a WORLD, not a slot. Re-forging with the same seed is a
    // parameter tweak — the coastline you painted is still your coastline, so
    // the list replays (the original design). A NEW SEED is a new planet: a
    // ridge drawn for a continent that no longer exists is debris, so the
    // list — strokes, renames, all of it — stays with the old seed and the
    // stored row is emptied.
    if (cleanSlate.current || data.params.seed !== editsSeed.current) {
      cleanSlate.current = false;
      editsSeed.current = data.params.seed;
      savedEdits.current = undefined;
      saveEditsRef.current?.('[]');
    }
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
    sessionWorld.current = data;
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
        toast.error(t('worldgen.status.noLandRoute'));
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
  }, [brushIsOut, brush.mode, brush.roadMajor, roadFrom, data, geography, journeyPick, applyEdit, t]);

  /**
   * Putting the TOOL away abandons a half-drawn road. Changing panel does not.
   *
   * This keyed on `brush`, which is `DEFAULT_PAINT_TOOL` whenever the paint
   * panel is closed — so opening any other tab for a second threw away the
   * first end of a road you had already clicked. The tool is what the reader
   * chose; the panel is only where they chose it.
   */
  useEffect(() => {
    if (tool.mode !== 'road') setRoadFrom(null);
  }, [tool.mode]);

  /**
   * And leaving the journey panel abandons a half-picked journey.
   *
   * `roadFrom` had this and `journeyPick` did not, which made a stale "Desde"
   * the worst kind of hidden mode: click "Desde", change tab without picking,
   * and from then on EVERY click on a town in EVERY view silently set the
   * journey's origin instead of opening the town — while the status line went
   * on saying "pincha una ciudad para ver su plano". The only affordance lived
   * inside the panel, so it vanished exactly when the mode became invisible.
   */
  useEffect(() => {
    if (panelTab !== 'journey') setJourneyPick(null);
  }, [panelTab]);

  /**
   * Regenerating leaves the selections pointing at a world that is gone.
   *
   * Only the geography and the paint session were reset on a new world. The
   * journey's two ends, its route, the ancient sea level, the open city plan,
   * the index selection and the region sheet all survived — so after Regenerar
   * the panel still named two towns from the old planet and the carta still
   * drew their pins, now possibly in open ocean.
   */
  useEffect(() => {
    setJourneyFrom(null);
    setJourneyTo(null);
    setJourneyVia([]);
    setJourneyRoute({ route: null, color: '#a3261e' });
    setJourneyPick(null);
    setPaleoState(null);
    setAtlasKey(null);
    setSelectedSpatialKey(null);
    setCityFor(null);
    setRegionAt(null);
    // `roadFrom` was the one selection this list forgot. `tool.mode` survives a
    // regeneration, so with Camino still out the first town of a half-laid road
    // survived with it — a `Settlement` from a dead planet. The map drew the
    // pending ring on whichever NEW town happened to share its id, the status
    // line named a place that no longer existed, and the second click routed
    // between a live town and a set of coordinates pointing into the old world.
    setRoadFrom(null);
  }, [data]);

  /**
   * THE FRONTIER TOOL TURNS ITS OWN LAYER ON.
   *
   * `borders` starts false, and it is the layer the whole tool draws into: the
   * dashed line AND the political wash both hang off it. So the reader picked
   * Frontera, chose a country, dragged across a province, saw the live preview
   * follow the pointer — and the committed frontier landed on a hidden layer.
   * Every stroke worked. Nothing appeared.
   *
   * Turning it on rather than merely warning about it, because there is no
   * reading of "I have picked up the frontier brush" under which the reader
   * wants frontiers hidden. It is not turned back OFF afterwards: they may well
   * want to keep looking at what they drew, and silently undoing a toggle the
   * reader can see is its own small betrayal.
   */
  useEffect(() => {
    if (tool.mode !== 'frontera') return;
    setCartoLayers((l) => (l.borders === true ? l : { ...l, borders: true }));
  }, [tool.mode]);

  /**
   * A country index cannot outlive the roster it points into.
   *
   * `tool.realm` is an INDEX into `geography.realms` — that is what a stored
   * `realm` edit means, and what `applyPaintedRealms` reads back. Regenerate
   * with fewer capitals and the index can dangle: the panel showed a dash, no
   * chip lit, and every stroke was thrown away by the `v >= limit` guard deep
   * in the applier, with nothing anywhere to say why the brush had stopped
   * working.
   */
  useEffect(() => {
    const n = geography?.realms.length ?? 0;
    if (!n || tool.realm < n) return;
    setTool((p) => ({ ...p, realm: Math.max(0, n - 1) }));
  }, [geography, tool.realm]);

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

  const runGenerate = useCallback(() => {
    // REGENERAR means a fresh world, full stop. The strokes belonged to the
    // ground the reader was looking at; carrying them onto new ground made
    // the button feel haunted (reported twice). Same seed or new seed, the
    // slate cleans at the reader's explicit action — but it is CONSUMED only
    // when the new world actually arrives, so a failed generation cannot eat
    // the strokes of the world still on screen.
    cleanSlate.current = true;
    onSaveParams(params);
    generate(params);
  }, [params, onSaveParams, generate]);

  /**
   * And ASK first, if there is anything to lose.
   *
   * The button lives in two panels, one of which is where you go to switch
   * fjords off. One click erased every stroke, hand-drawn road, hand-drawn
   * river, rename and placed mark — hours of work — and PERSISTED the erasure,
   * with no undo, because the session is rebuilt from an empty list. The
   * confirmation copies the edit list to the clipboard on the way out, so even
   * a confirmed regenerate is recoverable.
   */
  const [confirmRegen, setConfirmRegen] = useState(false);
  const handleGenerate = useCallback(() => {
    if ((session.current?.edits.length ?? 0) > 0) { setConfirmRegen(true); return; }
    runGenerate();
  }, [runGenerate]);

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

  /** Point the shared camera somewhere, animated, without changing view. */
  const flyCamera = useCallback((u: number, v: number, spanKm?: number) => {
    setFlyTarget({ u, v, spanKm, token: Date.now() });
  }, []);

  /**
   * Ctrl+F abre el localizador en las TRES vistas, e Inicio devuelve el
   * encuadre entero en la carta y el globo — el 2D tiene su propia tecla
   * Inicio con pila de historial (`Map2D.flyHome`), así que aquí se calla
   * cuando el 2D está delante para no volar dos veces.
   */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA'
        || (e.target as HTMLElement | null)?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setLocatorOpen(true);
        return;
      }
      if (e.key === 'Home' && view !== 'map' && tag !== 'SELECT') {
        e.preventDefault();
        flyCamera(0.5, 0.5, EARTH_KM);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [view, flyCamera]);

  const flyTo = useCallback((u: number, v: number) => {
    flyCamera(u, v);
    setView('3d');
  }, [flyCamera]);

  // Read through a ref so `zoomToPoint` keeps ONE identity: it is a prop of all
  // three views, and a new identity per camera report would re-render them all
  // once per gesture settle for nothing.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /** The double-click contract, identical in every view: descend one league
   *  toward the ground under the cursor. The regional sheet is no longer on
   *  this gesture — it is an EXPORT you ask for, not a place you fall into. */
  const zoomToPoint = useCallback((x: number, y: number) => {
    if (!data) return;
    // Never outward. A floor higher than where the camera already is turns
    // "closer" into "further", which is what a 24 km floor did to every
    // double-click below 58 km of span. The invariant is measured in
    // `harness/map2d-cohesion.ts`.
    flyCamera(
      ((x / data.width) % 1 + 1) % 1,
      Math.min(1, Math.max(0, y / data.height)),
      doubleClickSpanKm(viewportRef.current.spanKm),
    );
  }, [data, flyCamera]);

  // ---- Exports -----------------------------------------------------------
  /**
   * The 2D map's own exporter. `Map2D` fills it in while it is mounted.
   *
   * `exportPng` composites the WORLD GRID: the whole planet at one pixel per
   * cell, with no towns, no roads, no borders, no names and no satellite
   * ground. On the satellite view that is not the map the reader is looking
   * at — a session spent siting towns and laying roads came out as a green
   * rectangle. Only the map knows what the map drew, so the map renders it.
   */
  const mapExportRef = useRef<((scale: number) => Promise<Blob | null>) | null>(null);

  /** An export is seconds of synchronous canvas work on the main thread. With
   *  nothing on screen to say so, the tab just stops answering and the reader
   *  clicks Exportar again — which is a second freeze on top of the first. */
  const [exporting, setExporting] = useState(false);

  /**
   * Hand the frame back to the browser before starting the render.
   *
   * A `requestAnimationFrame` callback still runs BEFORE the paint, so
   * resolving inside it would put the render in front of the paint and the
   * busy state would never appear. The frame, then a task: that is a painted
   * screen.
   */
  const yieldToPaint = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

  /** The satellite view as it stands, at `scale`× the pixels on screen. */
  const exportMapView = useCallback(async (scale: number) => {
    setExportOpen(false);
    const render = mapExportRef.current;
    // Only reachable if the map unmounted between opening the menu and
    // clicking. Say so: a menu item that does nothing at all reads as a broken
    // export, and the reader tries it again.
    if (!render) { toast.error(t('worldgen.export.failed')); return; }
    setExporting(true);
    await yieldToPaint();
    try {
      const blob = await render(scale);
      if (!blob) { toast.error(t('worldgen.export.failed')); return; }
      saveAs(blob, `${safeName(world.title)}-mapa${scale > 1 ? `-${scale}x` : ''}.png`);
    } catch {
      // A tainted canvas (satellite tiles from another origin) throws out of
      // `toBlob` instead of returning null. Silence there looks like a click
      // that did nothing at all.
      toast.error(t('worldgen.export.failed'));
    } finally {
      setExporting(false);
    }
  }, [world.title, t]);

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

  const exportCarta = useCallback(async () => {
    if (!data) return;
    // 4096×2048 of carta is a second or more of blocking canvas work, and it
    // used to run straight inside the click handler: the menu stayed open over
    // a tab that had stopped answering, with nothing anywhere on screen to say
    // the export had started. Close the menu, raise the flag, let the browser
    // paint it, and only then render.
    setExportOpen(false);
    setExporting(true);
    await yieldToPaint();
    try {
      const canvas = renderCartoCanvas(data, {
        theme,
        width: 4096,
        height: 2048,
        layers: cartoLayers,
        reliefAmount: reliefSettled,
        geography: geography ?? undefined,
        title: world.title,
        subtitle: t('worldgen.export.atlasSuffix'),
        typeScale: 1.5,
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      // A 4K canvas is where `toBlob` runs out of memory. Returning quietly
      // left the reader waiting for a download that was never coming.
      if (!blob) { toast.error(t('worldgen.export.failed')); return; }
      saveAs(blob, `${safeName(world.title)}-carta.png`);
    } finally {
      setExporting(false);
    }
  }, [data, theme, cartoLayers, reliefSettled, geography, world.title, t]);

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
    const existingMap = (await worldMapOps.getAll(projectId))
      .find((map) => map.sourceWorldId === world.id);
    const mapId = existingMap?.id ?? generateId('map');
    const now = Date.now();
    if (existingMap) {
      await worldMapOps.update(mapId, {
        title: `${world.title} — ${t('worldgen.export.atlasSuffix')}`,
        backgroundImage: bg,
        source: 'worldgen',
        sourceWorldId: world.id,
        sourceRevision: data.revision ?? 0,
      });
    } else {
      await worldMapOps.create({
        id: mapId,
        projectId,
        title: `${world.title} — ${t('worldgen.export.atlasSuffix')}`,
        backgroundImage: bg,
        source: 'worldgen',
        sourceWorldId: world.id,
        sourceRevision: data.revision ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    const currentPins = await mapPinOps.getAll(mapId);
    const waypointIds = new Set(waypoints.map((waypoint) => waypoint.id));
    await Promise.all(currentPins
      .filter((pin) => pin.sourceWaypointId && !waypointIds.has(pin.sourceWaypointId))
      .map((pin) => mapPinOps.delete(pin.id)));
    for (const wp of waypoints) {
      const existingPin = currentPins.find((pin) => pin.sourceWaypointId === wp.id);
      if (existingPin) {
        await mapPinOps.update(existingPin.id, {
          name: wp.name,
          position: { x: wp.u * 100, y: wp.v * 100 },
          description: wp.description,
        });
      } else {
        await mapPinOps.create({
          id: generateId('pin'),
          projectId,
          mapId,
          name: wp.name,
          icon: 'custom',
          position: { x: wp.u * 100, y: wp.v * 100 },
          description: wp.description,
          sourceWaypointId: wp.id,
        });
      }
    }
    toast.success(existingMap ? t('worldgen.export.mapUpdated') : t('worldgen.export.sentToMaps'));
  }, [data, projectId, world.id, world.title, waypoints, t]);

  // 'loading' is not a pipeline stage — it is the snapshot coming back off the
  // disk — so it does not go looking for a translation of a stage name.
  const stageLabel = !gen.running ? ''
    : gen.stage === 'loading' ? t('worldgen.status.loadingWorld')
      : t(`worldgen.stage.${gen.stage}`);
  const selectedWaypoint = useMemo(
    () => waypoints.find((w) => w.id === selectedWaypointId) ?? null,
    [waypoints, selectedWaypointId],
  );

  /**
   * The countries the frontier brush can hand ground to.
   *
   * `tool.realm` is the INDEX into this list, not `realm.id` — the same index
   * `AppliedEdits.realmCells` stores and `settlements.ts` reads back, so the
   * three agree by construction. Kept as its own memo so the panel does not
   * re-render on every field of every realm, only when the roster changes.
   */
  const realmChoices = useMemo(
    () => geography?.realms.map((r) => ({ id: r.id, name: r.name, hue: r.hue })),
    [geography],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="worldgen-view">
      {/* ---- Toolbar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View switch. The order is the order of importance. */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <ToolbarTab active={view === '3d'} onClick={() => setView('3d')} icon={Box} label={t('worldgen.view.world3d')} disabled={!data} />
          <ToolbarTab active={view === 'map'} onClick={() => setView('map')} icon={MapIcon} label={t('worldgen.view.map')} />
          <ToolbarTab active={view === 'carta'} onClick={() => setView('carta')} icon={ScrollText} label={t('worldgen.view.carta')} disabled={!data} />
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
            title={t('worldgen.view.cartoStyle')}
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
              <OverlayToggle active={cartoLayers.forests !== false} onClick={() => setCartoLayers((l) => ({ ...l, forests: l.forests === false }))} icon={Trees} title={t('worldgen.overlay.forests')} />
              <OverlayToggle active={cartoLayers.roads !== false} onClick={() => setCartoLayers((l) => ({ ...l, roads: l.roads === false }))} icon={Route} title={t('worldgen.overlay.roads')} />
              <OverlayToggle active={cartoLayers.settlements !== false} onClick={() => setCartoLayers((l) => ({ ...l, settlements: l.settlements === false }))} icon={Landmark} title={t('worldgen.overlay.settlements')} />
              <OverlayToggle active={cartoLayers.labels !== false} onClick={() => setCartoLayers((l) => ({ ...l, labels: l.labels === false }))} icon={Signpost} title={t('worldgen.overlay.labels')} />
              <OverlayToggle active={cartoLayers.borders === true} onClick={() => setCartoLayers((l) => ({ ...l, borders: l.borders !== true }))} icon={Flag} title={t('worldgen.overlay.borders')} />
              <OverlayToggle active={cartoLayers.frame !== false} onClick={() => setCartoLayers((l) => ({ ...l, frame: l.frame === false, compass: l.frame === false, scaleBar: l.frame === false }))} icon={Compass} title={t('worldgen.overlay.frame')} />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title={t('worldgen.view.reliefAmount')}>
              {t('worldgen.paint.mode.terrain')}
              <input
                type="range" min={0.3} max={2} step={0.1}
                value={reliefAmount}
                onChange={(e) => bumpRelief(Number(e.target.value))}
                className="w-20 accent-accent-gold"
              />
              {reliefAmount !== reliefSettled && <span className="text-accent-gold">·</span>}
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
                title={t(s.title)}
                className={`px-3 py-1.5 text-xs transition ${
                  skin3D === s.id
                    ? 'bg-accent-gold/15 text-accent-gold'
                    : 'bg-elevated text-text-muted hover:text-text-primary'
                }`}
              >
                {t(s.label)}
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
          <OverlayToggle
            active={locatorOpen}
            onClick={() => setLocatorOpen((o) => !o)}
            icon={Search}
            title={t('worldgen.locator.button')}
          />
          <OverlayToggle active={showRivers} onClick={() => setShowRivers(!showRivers)} icon={Waves} title={t('worldgen.overlay.rivers')} />
          <OverlayToggle active={showLandmarks} onClick={() => setShowLandmarks(!showLandmarks)} icon={Flame} title={t('worldgen.overlay.landmarks')} />
          <OverlayToggle active={showWaypoints} onClick={() => setShowWaypoints(!showWaypoints)} icon={MapPin} title={t('worldgen.overlay.waypoints')} />
          {view !== 'carta' && (
            <OverlayToggle
              active={showSettlements}
              onClick={() => setShowSettlements(!showSettlements)}
              icon={Landmark}
              title={t('worldgen.overlay.settlementsHint')}
            />
          )}
          {/* El grifo del sembrado regional (granjas, abadías, ventas…). NO es
              un filtro de vista: escribe una edición `placesEverywhere` y el
              canon tocado se re-fragua — apagado, el mundo sólo tiene lo que
              Luis puso. El pincel «Lugares» abre zonas concretas. */}
          {data && (
            <OverlayToggle
              active={randomPlacesOn}
              onClick={() => applyEdit({ kind: 'placesEverywhere', enabled: !randomPlacesOn })}
              icon={Home}
              title={t('worldgen.overlay.randomPlaces')}
            />
          )}
          {view === 'map' && (
            <OverlayToggle
              active={showRoads}
              onClick={() => setShowRoads(!showRoads)}
              icon={Route}
              title={t('worldgen.overlay.roadsHint')}
            />
          )}
          {/* Both switches drive the SAME state the Carta uses, so the two maps
              can never disagree about where a frontier is or what a sea is called. */}
          {view === 'map' && (
            <OverlayToggle
              active={cartoLayers.borders === true}
              onClick={() => setCartoLayers((l) => ({ ...l, borders: l.borders !== true }))}
              // A flag, not a globe. This button and the graticule two along
              // both wore `Globe`, side by side in the same strip, for the two
              // things on the map that are least alike: where countries end,
              // and the lines of latitude. The frontier tool turns THIS one on.
              icon={Flag}
              title={t('worldgen.overlay.borders')}
            />
          )}
          {view === 'map' && (
            <OverlayToggle
              active={cartoLayers.labels !== false}
              onClick={() => setCartoLayers((l) => ({ ...l, labels: l.labels === false }))}
              icon={Signpost}
              title={t('worldgen.overlay.labelsHint')}
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
            disabled={!data || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-elevated border border-border rounded-lg text-text-primary hover:border-accent-gold/50 transition disabled:opacity-40"
          >
            <Download size={13} />
            {t('worldgen.export.button')}
            <ChevronDown size={12} />
          </button>
          {exportOpen && data && (
            <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-lg border border-border bg-elevated shadow-xl shadow-black/40 py-1">
              {/* On the satellite view the map exports ITSELF: the world-grid
                  composite below is the right picture of the globe and of the
                  carta, and the wrong picture of the map on screen — it knows
                  nothing about the zoom, the towns, the roads or the ground. */}
              {view === 'map' ? (
                <>
                  <ExportItem icon={Download} label={t('worldgen.export.mapView')} onClick={() => void exportMapView(1)} />
                  <ExportItem icon={Download} label={t('worldgen.export.mapView2x')} onClick={() => void exportMapView(2)} />
                </>
              ) : (
                <ExportItem icon={Download} label={t('worldgen.export.png')} onClick={exportPng} />
              )}
              <ExportItem icon={ScrollText} label={t('worldgen.export.carta')} onClick={() => void exportCarta()} />
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
              selectedSpatialKey={selectedSpatialKey}
              regionalEntities={regionalSpatialEntities}
              regionDetail={regionDetail}
              canonWorld={canonSource?.world}
              canonEdits={canonSource?.edits}
              onPlaceWaypoint={handlePlace}
              onRemoveWaypoint={dropWaypoint}
              // Una chincheta arrastrada. Va a su tabla y no a la lista de
              // ediciones — ver `isWaypointTool` — así que se guarda como
              // cualquier otro cambio de la chincheta, con su fecha.
              onMoveWaypoint={(id, u, v) => {
                void editWaypoint(id, { u, v, updatedAt: Date.now() });
              }}
              onSelectWaypoint={setSelectedWaypointId}
              onSelectSpatialEntity={(entity: WorldSpatialEntity | null) => {
                setSelectedSpatialKey(entity?.key ?? null);
                if (entity) setPanelTab('places');
              }}
              geography={geography}
              // Without this the two new gestures fall through: Ctrl+wheel
              // zoomed the camera and Alt+click PAINTED instead of sampling,
              // while the hint strip advertised both.
              onTool={(patch) => setTool((prev) => ({ ...prev, ...patch }))}
              showSettlements={showSettlements}
              showRoads={showRoads}
              showBorders={cartoLayers.borders === true}
              showFeatures={cartoLayers.labels !== false}
              roadFrom={roadFrom}
              tool={paintable ? tool : undefined}
              onEdit={paintable ? applyEdit : undefined}
              onPickSettlement={pickSettlement}
              onZoomTo={zoomToPoint}
              viewport={viewport}
              onViewportChange={setViewport}
              flyTarget={flyTarget}
              revision={paintRev}
              exportRef={mapExportRef}
              // Las comarcas guardadas, dibujadas sobre el suelo: hasta ahora
              // vivían sólo en su panel, así que el lector guardaba un valle y
              // al volver al mapa no sabía dónde lo tenía.
              savedRegions={savedRegions}
              activeRegionId={regionAt?.savedId ?? null}
              onOpenSavedRegion={(id) => {
                const region = savedRegions.find((candidate) => candidate.id === id);
                if (region) openSavedRegion(region);
              }}
              // El Índice y el Viaje ya no obligan a la Carta: la ruta, las dos
              // puntas del viaje y los sitios que nombra el manuscrito se
              // dibujan aquí también.
              annotations={annotations}
            />
          )}
          {data && view === 'carta' && (
            !geography ? <EngineSpinner /> : (
              <CartoMap
                world={data}
                theme={theme}
                geography={geography}
                canonWorld={canonSource?.world}
                canonEdits={canonSource?.edits}
                layers={cartoLayers}
                density={1}
                reliefAmount={reliefSettled}
                title={world.title}
                subtitle={t('worldgen.export.atlasSuffix')}
                onPickSettlement={pickSettlement}
                annotations={annotations}
                onZoomTo={zoomToPoint}
                viewport={viewport}
                onViewportChange={setViewport}
                flyTarget={flyTarget}
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
                showLandmarks={showLandmarks}
                selectedSpatialKey={selectedSpatialKey}
                regionalEntities={regionalSpatialEntities}
                onSelectSpatialEntity={(entity) => {
                  setSelectedSpatialKey(entity?.key ?? null);
                  if (entity) setPanelTab('places');
                }}
                viewport={viewport}
                onViewportChange={setViewport}
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
                onZoomTo={zoomToPoint}
              />
            </Suspense>
          )}

          {/* El localizador, sobre la vista que esté delante. */}
          {data && (
            <LocatorPanel
              world={data}
              geography={geography}
              open={locatorOpen}
              onClose={() => setLocatorOpen(false)}
              onFly={(x, y) => {
                // Volar SIN cambiar de vista, y aterrizar a escala comarcal si
                // se venía de más lejos — encontrar un pueblo desde el globo
                // entero debe dejarte viéndolo, no a 40.000 km de él.
                const span = Math.min(viewportRef.current?.spanKm ?? EARTH_KM, 240);
                flyCamera(x / data.width, y / data.height, span);
              }}
            />
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

          {data && view === 'map' && regionDetailBusy && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-white/15 bg-[#0b0e14]/88 px-2 py-1 text-[10px] text-white/75 shadow-lg backdrop-blur-sm">
              <Loader2 size={11} className="animate-spin text-accent-gold" />
              {t('worldgen.status.regionDetail')} · {regionDetailStage || t('worldgen.status.preparing')}
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
          {/* Two compact rows keep every world workflow one click away. */}
          <div className="grid grid-cols-4 border-b border-border">
            <PanelTab active={panelTab === 'params'} onClick={() => setPanelTab('params')} label={t('worldgen.params.title')} />
            <PanelTab active={panelTab === 'world'} onClick={() => setPanelTab('world')} label={t('worldgen.itemNoun')} />
            <PanelTab
              active={panelTab === 'paint'}
              onClick={() => { setPanelTab('paint'); if (view === 'carta') setView(lastPaintableView.current); }}
              // `paintRev` is a redraw token, not a count: undo, redo AND
              // "limpiar" all bump it, so the badge climbed while the panel
              // below it correctly said the strokes were gone.
              label={`${t('worldgen.paint.title')}${strokeCount ? ` (${strokeCount})` : ''}`}
            />
            <PanelTab active={panelTab === 'waypoints'} onClick={() => setPanelTab('waypoints')} label={`${t('worldgen.waypoints.title')}${waypoints.length ? ` (${waypoints.length})` : ''}`} />
            {/*
              El Viaje y el Índice YA NO OBLIGAN A LA CARTA.
              Las dos pestañas hacían `setView('carta')` porque `annotations`
              sólo llegaba allí: planear una ruta echaba al lector de la vista
              satélite — con su pincel, su pirámide y sus nombres — a la lámina
              dibujada, y volver era cosa suya. El 2D dibuja ahora las
              chinchetas y la ruta, y sus poblaciones ya respondían al selector
              de viaje (`onPickSettlement`), así que sólo hay que sacar al
              lector de donde de verdad no se ve nada: el globo. Si ya está en
              un mapa plano, se queda donde estaba.
            */}
            <PanelTab active={panelTab === 'journey'} onClick={() => { setPanelTab('journey'); if (view === '3d') setView('map'); }} label={t('worldgen.journey.title')} />
            <PanelTab active={panelTab === 'atlas'} onClick={() => { setPanelTab('atlas'); if (view === '3d') setView('map'); }} label={t('worldgen.panel.atlas')} />
            <PanelTab
              active={panelTab === 'regions'}
              onClick={() => setPanelTab('regions')}
              label={`${t('worldgen.panel.regions')}${savedRegions.length ? ` (${savedRegions.length})` : ''}`}
            />
            <PanelTab active={panelTab === 'places'} onClick={() => setPanelTab('places')} label={t('worldgen.panel.place')} />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {panelTab === 'regions' ? (
              <SavedRegionsPanel
                regions={savedRegions}
                onOpen={openSavedRegion}
                onCreateHere={saveCurrentRegion}
                onRename={(id, title) => {
                  const now = Date.now();
                  persistRegions(savedRegions.map((region) => (
                    region.id === id ? { ...region, title, updatedAt: now } : region
                  )));
                }}
                onDelete={(id) => {
                  persistRegions(savedRegions.filter((region) => region.id !== id));
                  setRegionAt((current) => (current?.savedId === id ? null : current));
                }}
              />
            ) : panelTab === 'places' ? (
              selectedSpatialEntity && data ? (
                <SpatialEntityInspector
                  projectId={projectId}
                  worldId={world.id}
                  entity={selectedSpatialEntity}
                  onRename={(name) => renameByKey(selectedSpatialEntity.key, name)}
                  onRemove={() => removeByKey(selectedSpatialEntity.key)}
                  onRestore={() => {
                    const target = targetFromKey(selectedSpatialEntity.key);
                    if (target) applyEdit({
                      kind: 'restore',
                      target,
                      key: selectedSpatialEntity.key,
                    });
                  }}
                  onMove={(x, y) => {
                    const target = targetFromKey(selectedSpatialEntity.key);
                    if (target) applyEdit({
                      kind: 'move',
                      target,
                      key: selectedSpatialEntity.key,
                      x,
                      y,
                    });
                  }}
                  onStyle={(style: WorldSpatialStyleOverride) => {
                    const target = targetFromKey(selectedSpatialEntity.key);
                    if (target) applyEdit({
                      kind: 'style',
                      target,
                      key: selectedSpatialEntity.key,
                      style,
                    });
                  }}
                  onOpenRegion={() => setRegionAt({
                    x: selectedSpatialEntity.x,
                    y: selectedSpatialEntity.y,
                  })}
                  onReveal2D={() => {
                    setViewport({
                      u: selectedSpatialEntity.x / data.width,
                      v: selectedSpatialEntity.y / data.height,
                      spanKm: Math.min(400, viewport.spanKm),
                    });
                    setView('map');
                  }}
                  onReveal3D={() => {
                    setView('3d');
                    flyTo(
                      selectedSpatialEntity.x / data.width,
                      selectedSpatialEntity.y / data.height,
                    );
                  }}
                />
              ) : (
                <p className="text-[11px] text-text-muted">
                  {t('worldgen.panel.placeEmpty')}
                </p>
              )
            ) : panelTab === 'atlas' ? (
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
                // «Abre la carta» dejó de ser verdad: abrir el Índice ya pide
                // la geografía completa por sí solo (ver `needsFullGeo`) y el
                // 2D dibuja lo que el Índice señala. Lo único que falta aquí es
                // ESPERAR, así que eso es lo que dice.
                <p className="text-[11px] text-white/45">
                  {t('worldgen.panel.atlasBuilding')}
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
                  {t('worldgen.panel.journeyBuilding')}
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
                  toast.success(t('worldgen.paint.editsCopied'));
                }}
                cellKm={Math.round(40075 / (data?.width ?? 1024))}
                realms={realmChoices}
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
                  if (view === 'carta') setView(lastPaintableView.current);
                  // NOT `setPanelTab('paint')`: it threw the reader out of the
                  // pin list they were reading in order to place a pin, and it
                  // is what made `placing` provably always false — `pinning`
                  // required `panelTab === 'paint'`, which this tab is not.
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
        {geoBusy && (
          <span className="ml-3 text-accent-gold/80">
            {stagedDepth.current === 'places'
              ? t('worldgen.status.tracingRoads')
              : t('worldgen.status.recalculating')}
          </span>
        )}
        {/* The only sign of life during an export: the render blocks the main
            thread, so a spinner would not spin — a word that is on screen
            before the render starts is what tells the reader the tab is alive. */}
        {exporting && (
          <span className="ml-3 text-accent-gold/80">{t('worldgen.status.exporting')}</span>
        )}
        {brushIsOut && brush.mode === 'road' && (
          <span className="ml-3 text-accent-gold">
            {roadFrom
              ? t('worldgen.status.roadFrom').replace('{name}', roadFrom.name)
              : t('worldgen.status.roadStart')}
          </span>
        )}
        {geography && (
          <span className="ml-3">
            {/* A profundidad 'places' las ruinas generadas no se calculan
                (16,7 s de coste, decisión de worldgen-geografia): la lista
                vacía significa «no se sabe», no «cero». La barra decía
                «0 ruinas» en el 3D satélite sobre un mundo con 6, y el número
                saltaba a 6 al abrir Mapa o Carta. Misma familia que la
                lección #21: enseñar un recuento que esa vía no computa. */}
            {geography.depth === 'full'
              ? t('worldgen.status.geography')
                .replace('{settlements}', String(geography.settlements.length))
                .replace('{realms}', String(geography.realms.length))
                .replace('{ruins}', String(geography.ruins.length))
              : t('worldgen.status.geographyLite')
                .replace('{settlements}', String(geography.settlements.length))
                .replace('{realms}', String(geography.realms.length))}
            {view !== 'carta' && brush.mode !== 'off'
              ? ` · ${t('worldgen.status.dragToPaint')}`
              : ` · ${t('worldgen.status.clickTown')}`}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmRegen}
        destructive
        message={t('worldgen.status.regenConfirm').replace(
          '{edits}',
          t(strokeCount === 1 ? 'worldgen.paint.edits.one' : 'worldgen.paint.edits.many')
            .replace('{n}', String(strokeCount)),
        )}
        onConfirm={() => {
          setConfirmRegen(false);
          const json = session.current?.serialize();
          if (json) {
            void navigator.clipboard?.writeText(json).catch(() => undefined);
            toast.success(t('worldgen.paint.editsCopied'));
          }
          runGenerate();
        }}
        onCancel={() => setConfirmRegen(false)}
      />

      {/* ---- Regional sheet: the scale between the world and the town ---- */}
      {data && geography && regionAt && (
        <RegionSheetView
          world={data}
          geography={geography}
          theme={theme}
          at={regionAt}
          saved={regionAt.savedId
            ? savedRegions.find((region) => region.id === regionAt.savedId)
            : undefined}
          revision={paintRev}
          selectedSpatialKey={selectedSpatialKey}
          onSelectSpatialEntity={(entity) => {
            setSelectedSpatialKey(entity?.key ?? null);
          }}
          onEditEntity={applyEdit}
          onSaveRegion={(region) => {
            saveRegion(region);
            setRegionAt({ x: region.x, y: region.y, savedId: region.id });
          }}
          onClose={() => setRegionAt(null)}
          onFlyHere={(x, y, spanKm) => {
            setRegionAt(null);
            if (data) {
              flyCamera(
                ((x / data.width) % 1 + 1) % 1,
                Math.min(1, Math.max(0, y / data.height)),
                spanKm,
              );
            }
          }}
          onPickSettlement={setCityFor}
          // La hoja obedece al mismo grifo de lugares que el canon (tick +
          // zonas), pasado explícito porque su mundo viaja editado.
          sitesPolicy={worldSitesPolicy}
        />
      )}

      {/* ---- City plan ---- */}
      {data && cityFor && (
        <CityPlanView
          // Keyed on the town: opening a different one starts from ITS numbers
          // rather than inheriting the last one's unsaved population.
          key={cityFor.id}
          world={data}
          settlement={cityFor}
          theme={theme}
          onClose={() => setCityFor(null)}
          onDelete={() => removeByKey(editKey('settlement', cityFor.x, cityFor.y))}
          onPopulation={(population) => {
            applyEdit({
              kind: 'populate',
              target: 'settlement',
              key: editKey('settlement', cityFor.x, cityFor.y),
              population,
            });
            // Same reason as the rename below: the open modal holds the
            // settlement it was handed, and the rebuilt geography returns new
            // objects, so the number in front of the reader is updated here
            // rather than waiting for the round trip.
            setCityFor((c) => (c ? { ...c, population } : c));
          }}
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
