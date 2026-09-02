import {
  useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { EngineSpinner, onDataChanged } from '@/engines/_shared';
import { generateId } from '@/utils/idGenerator';
import type { AtlasDivergence, AtlasPlace } from '../types';
import { hasCoordinates, tileRange, worldSize, wrapTileX, type LonLat, type Point } from '../geo';
import {
  fitBounds, fromScreen, isOnWorld, panBy, toScreen, viewOrigin, WORLD_EXTENT, zoomAt, zoomBy, type MapView, type Size,
} from '../mapState';
import { basemapPaths, countryLabels, loadBasemap, type Basemap } from '../basemap';
import { loadAtlasMapPrefs, saveAtlasMapPrefs, type AtlasMapPrefs } from '../mapPrefs';
import { loadAtlasRoutes, MAX_ROUTE_STOPS, routePoints, saveAtlasRoutes, type AtlasRoute } from '../routes';
import {
  MapToolbar, MeasurePanel, Pin, PlaceCard, RouteLines, RoutesPanel, UndoBar, type MeasurePoint, type RouteLine,
} from './AtlasMapChrome';
import { fillName } from './labels';

// ============================================================================
// The atlas map
// ============================================================================
//
// No mapping library: a container with a ResizeObserver, a view (centre +
// fractional zoom) and four layers stacked in it —
//
//   1. OSM raster tiles, only when the writer switches "detailed map" on:
//      the one thing here that touches the network, so it is opt-in per
//      project and off by default;
//   2. the offline vector basemap (country outlines) as one SVG path per
//      country, recomputed on every pan and zoom — hidden under the tiles;
//   3. the pin layer: HTML pins, the hierarchy lines and the routes, laid
//      out ONCE for a "layout view" and moved as a whole with a CSS
//      transform while the writer pans (see LAYOUT below);
//   4. an overlay for the measuring line, the card and the panels.
//
// Pointer handling is the usual pointer-capture dance: a press on the map
// pans, a press on a pin drags it, and a press that never moved more than
// three pixels is a click for whatever mode is active. Pin events are
// delegated from the layer by `data-pin-id`, so the pins themselves carry no
// closures and `memo` can skip them.
//
// LAYOUT. Two thousand pins re-rendered on every pointer move made a pan a
// slideshow. The pins are therefore positioned against `layoutView`, a
// snapshot of the view, and the layer is translated by the difference
// between that snapshot and the live view; the snapshot is only retaken when
// the zoom changes or the view has drifted more than a screen away, and pins
// are kept for one screen around the viewport so the ones sliding in during
// a pan are already there.

/** A request from the engine, applied once per `seq` (render-adjust, not an effect). */
export interface MapRequest {
  placeId: string;
  seq: number;
}

export interface AtlasMapProps {
  projectId: string;
  places: AtlasPlace[];
  divergences: AtlasDivergence[];
  selectedPlaceId: string | null;
  onSelect: (id: string | null) => void;
  /** "Edit" on the card: the engine switches to the list with the place open. */
  onEdit: (id: string) => void;
  /** A click in "add place" mode: the engine creates the row and opens its editor. */
  onCreateAt: (coords: LonLat) => void;
  /** New coordinates for a place (null clears them); a drag, "place on the map" and undo all go through here. */
  onMove: (id: string, coords: LonLat | null) => Promise<void>;
  /** The editor's "pick on the map": the next click is reported through onPick instead of being written. */
  pickRequest: MapRequest | null;
  onPick: (placeId: string, coords: LonLat) => void;
  /** Centre on a place and select it (a deep link while the map is the active tab). */
  focusRequest: MapRequest | null;
}

type Mode =
  | { kind: 'browse' }
  | { kind: 'add' }
  | { kind: 'place'; placeId: string; source: 'editor' | 'map' }
  | { kind: 'measure'; from?: MeasurePoint; to?: MeasurePoint }
  | { kind: 'route'; placeIds: string[] };

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface PinDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  at: LonLat;
}

interface UndoState {
  placeId: string;
  name: string;
  /** What the place had before; null when it had no coordinates. */
  previous: LonLat | null;
  messageKey: 'realAtlas.map.moved' | 'realAtlas.map.placed';
}

/** Pixels a pointer may wander before a press stops being a click. */
const CLICK_SLOP = 3;
/** Wheel pixels per zoom level; a "page" of wheel is one level. */
const WHEEL_PIXELS_PER_LEVEL = 250;
/** Zoom from which pins carry their name. */
const LABEL_ZOOM = 5;
/** Above this many pins on screen the names come off (the selected one keeps its): a hillside of labels is unreadable and slow. */
const LABEL_LIMIT = 300;
/** Zoom from which the vector base shows country names, subject to their size on screen. */
const COUNTRY_LABEL_ZOOM = 2.5;
const COUNTRY_LABEL_MIN_PX = 48;
/** How long the undo bar for a moved pin stays. */
const UNDO_MS = 15_000;
/** OSM has nothing past 19. */
const MAX_TILE_ZOOM = 19;
/** Zoom used when centring on one place from a request or the search. */
const FOCUS_ZOOM = 8;
/** "Fit all" with one place must still show its country, not its street: the 110m basemap has nothing to draw at 12. */
const FIT_MAX_ZOOM = 7;
/** How long the view may sit unsaved after the last move. */
const SAVE_DEBOUNCE_MS = 600;

/** A layer fills the container; see the container's own comment on inline geometry. */
const LAYER = { position: 'absolute', inset: 0 } as const;

function focusView(view: MapView, place: LonLat): MapView {
  return { center: { lon: place.lon, lat: place.lat }, zoom: Math.max(view.zoom, FOCUS_ZOOM) };
}

/** The pin the event landed on, from the delegated layer. */
function pinIdOf(e: { target: EventTarget }): string | null {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-pin-id]') : null;
  return el?.dataset.pinId ?? null;
}

export default function AtlasMap({
  projectId, places, divergences, selectedPlaceId, onSelect, onEdit, onCreateAt, onMove, pickRequest, onPick, focusRequest,
}: AtlasMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanDrag | null>(null);
  const cursorFrame = useRef<{ raf: number; at: LonLat | null } | null>(null);
  /** The last view not yet written to the settings row, flushed when the project changes or the map unmounts. */
  const pendingSave = useRef<{ projectId: string; prefs: Partial<AtlasMapPrefs> } | null>(null);

  const [prefs, setPrefs] = useState<AtlasMapPrefs | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [layoutView, setLayoutView] = useState<MapView | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [cursor, setCursor] = useState<LonLat | null>(null);
  const [pinDrag, setPinDrag] = useState<PinDrag | null>(null);
  const [panning, setPanning] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(null);
  const [seenPick, setSeenPick] = useState(0);
  const [seenFocus, setSeenFocus] = useState(0);
  const [routes, setRoutes] = useState<AtlasRoute[]>([]);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // --- loading: preferences, routes, basemap, container size -----------------

  useEffect(() => {
    let cancelled = false;
    loadAtlasMapPrefs(projectId).then((loaded) => { if (!cancelled) setPrefs(loaded); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Routes are read once per project and again whenever something else
  // wrote to Dexie (the bridge creating one, an undo): the settings row they
  // live in is not watched by any entity hook.
  useEffect(() => {
    let cancelled = false;
    const load = () => loadAtlasRoutes(projectId).then((loaded) => { if (!cancelled) setRoutes(loaded); });
    void load();
    const unsubscribe = onDataChanged(() => { void load(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    loadBasemap().then((loaded) => { if (!cancelled) setBasemap(loaded); }).catch((error: unknown) => {
      // The map still works — tiles, pins, measuring — just over a blank ocean.
      console.error('[real-atlas] basemap failed to load', error);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // React registers wheel listeners as passive, so preventDefault there is a
  // no-op and the page would scroll under the map: a native listener it is.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaY * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaY * WHEEL_PIXELS_PER_LEVEL
          : e.deltaY;
      setView((current) => current && zoomAt(
        current,
        { width: rect.width, height: rect.height },
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        -pixels / WHEEL_PIXELS_PER_LEVEL,
      ));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Persist where the map is, debounced: a pan is a hundred moves. What is
  // pending is kept in a ref so the effect below can flush it when the
  // project changes under the debounce — the route keeps this component
  // mounted across projects, and a view moved less than a second before
  // switching used to be lost.
  useEffect(() => {
    if (!prefs || !view) return;
    const patch = { tiles: prefs.tiles, hierarchy: prefs.hierarchy, view };
    pendingSave.current = { projectId, prefs: patch };
    const timer = window.setTimeout(() => {
      pendingSave.current = null;
      void saveAtlasMapPrefs(projectId, patch);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, prefs, view]);

  useEffect(() => () => {
    const pending = pendingSave.current;
    if (pending) {
      pendingSave.current = null;
      void saveAtlasMapPrefs(pending.projectId, pending.prefs);
    }
  }, [projectId]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => () => {
    if (cursorFrame.current) cancelAnimationFrame(cursorFrame.current.raf);
  }, []);

  // --- derived --------------------------------------------------------------

  const located = useMemo(() => places.filter(hasCoordinates), [places]);
  const unplaced = useMemo(() => places.filter((p) => !hasCoordinates(p)), [places]);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const divergenceCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of divergences) {
      if (row.placeId) counts.set(row.placeId, (counts.get(row.placeId) ?? 0) + 1);
    }
    return counts;
  }, [divergences]);
  const placeName = (id?: string) => (id ? byId.get(id)?.name : undefined);
  const ready = size.width > 0 && size.height > 0;

  // --- render-adjust: first view, and requests from the engine -------------

  // The route keeps this component mounted across a change of project, so
  // nothing of the other project — its view, a half-finished drag, an undo
  // bar naming its place — may show over this one's places.
  const [prefsFor, setPrefsFor] = useState(projectId);
  if (prefsFor !== projectId) {
    setPrefsFor(projectId);
    setPrefs(null);
    setView(null);
    setLayoutView(null);
    setMode({ kind: 'browse' });
    setCursor(null);
    setPinDrag(null);
    setUndo(null);
    setCardOpen(false);
    setRoutes([]);
    setRoutesOpen(false);
    setSelectedRouteId(null);
  }
  if (!view && prefs && ready) {
    setView(prefs.view ?? fitBounds(located.length ? located : WORLD_EXTENT, size, 48, FIT_MAX_ZOOM));
  }
  if (pickRequest && pickRequest.seq !== seenPick) {
    setSeenPick(pickRequest.seq);
    setMode({ kind: 'place', placeId: pickRequest.placeId, source: 'editor' });
    setFocusPlaceId(pickRequest.placeId);
    setCardOpen(false);
  }
  if (focusRequest && focusRequest.seq !== seenFocus) {
    setSeenFocus(focusRequest.seq);
    setFocusPlaceId(focusRequest.placeId);
    setCardOpen(true);
  }
  if (view && focusPlaceId) {
    setFocusPlaceId(null);
    const target = byId.get(focusPlaceId);
    if (target && hasCoordinates(target)) setView(focusView(view, target));
  }

  // The layout snapshot (see LAYOUT above): retaken on zoom, on resize and
  // once the live view has drifted a screen away from it.
  const origin = view ? viewOrigin(view, size) : { x: 0, y: 0 };
  let shift = { x: 0, y: 0 };
  if (view) {
    if (layoutView && layoutView.zoom === view.zoom) {
      const layoutOrigin = viewOrigin(layoutView, size);
      const world = worldSize(view.zoom);
      // A centre that wrapped past the antimeridian moved the origin by a
      // whole world; the pins did not.
      let dx = layoutOrigin.x - origin.x;
      dx -= world * Math.round(dx / world);
      shift = { x: dx, y: layoutOrigin.y - origin.y };
    }
    if (!layoutView || layoutView.zoom !== view.zoom || Math.abs(shift.x) > size.width || Math.abs(shift.y) > size.height) {
      setLayoutView(view);
    }
  }

  const selectedPlace = selectedPlaceId ? byId.get(selectedPlaceId) ?? null : null;
  // A place that lost its coordinates (or was deleted) has no card to show.
  if (cardOpen && !(selectedPlace && hasCoordinates(selectedPlace))) setCardOpen(false);
  if (selectedRouteId && !routes.some((route) => route.id === selectedRouteId)) setSelectedRouteId(null);

  // --- helpers ----------------------------------------------------------------

  const containerPoint = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };
  const lonLatAt = (clientX: number, clientY: number): LonLat | null =>
    view ? fromScreen(view, size, containerPoint(clientX, clientY)) : null;

  const exitMode = () => {
    setMode({ kind: 'browse' });
    setCursor(null);
  };

  /** The live end of the measuring line: one state update per frame, however fast the pointer reports. */
  const scheduleCursor = (at: LonLat | null) => {
    if (cursorFrame.current) {
      cursorFrame.current.at = at;
      return;
    }
    const frame = { at, raf: 0 };
    frame.raf = requestAnimationFrame(() => {
      cursorFrame.current = null;
      setCursor(frame.at);
    });
    cursorFrame.current = frame;
  };

  const updatePrefs = (patch: Partial<AtlasMapPrefs>) =>
    setPrefs((current) => current && { ...current, ...patch });

  /** A write that failed must say so: the pin would otherwise snap back with no explanation. */
  const move = async (id: string, coords: LonLat | null): Promise<boolean> => {
    try {
      await onMove(id, coords);
      return true;
    } catch (error) {
      console.error('[real-atlas] move failed', error);
      toast.error(t('realAtlas.map.moveFailed'));
      return false;
    }
  };

  const moveWithUndo = async (place: AtlasPlace, coords: LonLat, messageKey: 'realAtlas.map.moved' | 'realAtlas.map.placed') => {
    const previous = hasCoordinates(place) ? { lon: place.lon, lat: place.lat } : null;
    if (await move(place.id, coords)) setUndo({ placeId: place.id, name: place.name, previous, messageKey });
  };

  const undoMove = async () => {
    if (!undo) return;
    setUndo(null);
    // The place may have been deleted while the bar was up.
    if (!byId.has(undo.placeId)) return;
    if (await move(undo.placeId, undo.previous)) toast.info(t('realAtlas.map.undone'));
  };

  const persistRoutes = async (next: AtlasRoute[]) => {
    setRoutes(next);
    try {
      await saveAtlasRoutes(projectId, next);
    } catch (error) {
      console.error('[real-atlas] routes failed to save', error);
      toast.error(t('realAtlas.routes.saveFailed'));
    }
  };

  const finishRoute = () => {
    if (mode.kind !== 'route') return;
    if (mode.placeIds.length < 2) {
      toast.info(t('realAtlas.routes.needTwo'));
      return;
    }
    // A stop deleted while the route was being clicked together is not
    // persisted as a dead id; and the route that remains must still be one.
    const placeIds = mode.placeIds.filter((id) => byId.has(id));
    if (placeIds.length < 2) {
      toast.info(t('realAtlas.routes.needTwo'));
      return;
    }
    const route: AtlasRoute = {
      id: generateId('route'),
      name: t('realAtlas.routes.defaultName').replace('{n}', String(routes.length + 1)),
      placeIds,
    };
    exitMode();
    setSelectedRouteId(route.id);
    void persistRoutes([...routes, route]);
  };

  const chooseRoute = (id: string) => {
    setSelectedRouteId(id);
    const route = routes.find((r) => r.id === id);
    const points = route ? routePoints(route, byId) : [];
    if (points.length && view) setView(fitBounds(points, size, 64, FIT_MAX_ZOOM));
  };

  /** A press that did not move: what it means depends on the mode. */
  const clickAt = (coords: LonLat, placeId?: string) => {
    switch (mode.kind) {
      case 'browse':
        // Only the card closes: the selection is what the editor on the other
        // tab is showing, and a stray click must not throw its draft away.
        setCardOpen(false);
        return;
      case 'add':
        exitMode();
        onCreateAt(coords);
        return;
      case 'place': {
        const target = byId.get(mode.placeId);
        exitMode();
        if (!target) return;
        if (mode.source === 'editor') onPick(target.id, coords);
        else {
          onSelect(target.id);
          void moveWithUndo(target, coords, 'realAtlas.map.placed');
        }
        return;
      }
      case 'measure': {
        const point: MeasurePoint = placeId ? { ...coords, placeId } : coords;
        if (!mode.from || mode.to) setMode({ kind: 'measure', from: point });
        else setMode({ kind: 'measure', from: mode.from, to: point });
        setCursor(null);
        return;
      }
      case 'route':
        // A route is clicked together from pins; the map itself is not a stop.
        if (placeId && mode.placeIds[mode.placeIds.length - 1] !== placeId) {
          // The stored blob is cut at the same count, so a longer route
          // would silently lose its tail on the next load.
          if (mode.placeIds.length >= MAX_ROUTE_STOPS) {
            toast.info(t('realAtlas.routes.tooMany').replace('{max}', String(MAX_ROUTE_STOPS)));
            return;
          }
          setMode({ kind: 'route', placeIds: [...mode.placeIds, placeId] });
        }
        return;
    }
  };

  // --- pointer: the map itself ---------------------------------------------------

  const onMapPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !view) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  };

  const onMapPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CLICK_SLOP) {
        drag.moved = true;
        setPanning(true);
      }
      if (drag.moved) setView((current) => current && panBy(current, dx, dy));
      return;
    }
    // Live end of the measuring line while the second point is being chosen.
    if (mode.kind === 'measure' && mode.from && !mode.to) scheduleCursor(lonLatAt(e.clientX, e.clientY));
  };

  const onMapPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    panRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
    if (drag.moved || e.type === 'pointercancel') return;
    const coords = lonLatAt(e.clientX, e.clientY);
    if (coords) clickAt(coords);
  };

  const onMapDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Two quick measuring clicks are two points, not a zoom.
    if (!view || mode.kind !== 'browse') return;
    setView(zoomAt(view, size, containerPoint(e.clientX, e.clientY), 1));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The shortcuts belong to the canvas itself. A key pressed on anything
    // inside it — a button of the routes panel, the search box, a pin — is
    // that thing's: Enter on "finish" used to finish the route here AND
    // cancel the click, and Escape here would close a card the panel's own
    // Escape had already handled.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Escape') {
      // Building a route, Escape steps back one stop at a time — the way the
      // worldgen map's lasso does — and only leaves the mode once nothing is
      // left to lose; a whole itinerary is too much to throw away on a reflex.
      if (mode.kind === 'route' && mode.placeIds.length > 0) {
        setMode({ kind: 'route', placeIds: mode.placeIds.slice(0, -1) });
      } else {
        exitMode();
        setCardOpen(false);
      }
    } else if (e.key === 'Enter' && mode.kind === 'route') finishRoute();
    else if (e.key === '+' || e.key === '=') setView((v) => v && zoomBy(v, 1));
    else if (e.key === '-') setView((v) => v && zoomBy(v, -1));
    else if (e.key.startsWith('Arrow')) {
      const step = 80;
      const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
      const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      setView((v) => v && panBy(v, dx, dy));
    } else return;
    e.preventDefault();
  };

  // --- pointer: pins, delegated from their layer ---------------------------------

  const onPinPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const id = pinIdOf(e);
    const place = id ? byId.get(id) : undefined;
    if (!place || !hasCoordinates(place)) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    // While measuring or building a route a pin is a target, never a drag.
    if (mode.kind === 'measure' || mode.kind === 'route') {
      clickAt({ lon: place.lon, lat: place.lat }, place.id);
      return;
    }
    (e.target as Element).closest<HTMLElement>('[data-pin-id]')?.setPointerCapture(e.pointerId);
    setPinDrag({ id: place.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, at: { lon: place.lon, lat: place.lat } });
  };

  const onPinPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pinDrag || pinDrag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const at = lonLatAt(e.clientX, e.clientY);
    if (!at) return;
    const moved = pinDrag.moved || Math.hypot(e.clientX - pinDrag.startX, e.clientY - pinDrag.startY) >= CLICK_SLOP;
    setPinDrag({ ...pinDrag, moved, at });
  };

  const onPinPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pinDrag || pinDrag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const captured = (e.target as Element).closest<HTMLElement>('[data-pin-id]');
    if (captured?.hasPointerCapture(e.pointerId)) captured.releasePointerCapture(e.pointerId);
    const drag = pinDrag;
    setPinDrag(null);
    const place = byId.get(drag.id);
    if (e.type === 'pointercancel' || !place) return;
    if (drag.moved) {
      // Past the poles there is no world to drop a pin on: it snaps back.
      if (!view || !isOnWorld(view, size, containerPoint(e.clientX, e.clientY))) {
        toast.info(t('realAtlas.map.dropOutside'));
        return;
      }
      void moveWithUndo(place, drag.at, 'realAtlas.map.moved');
      return;
    }
    onSelect(place.id);
    setCardOpen(true);
  };

  /** The browser took the capture away (the pin unmounted, a system gesture): the drag is over, nothing is written. */
  const onPinLostCapture = () => setPinDrag(null);

  /** Enter or Space on a focused pin: a keyboard click has no pointer events, so it arrives here with detail 0. */
  const onPinClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.detail !== 0) return;
    const id = pinIdOf(e);
    const place = id ? byId.get(id) : undefined;
    if (!place || !hasCoordinates(place)) return;
    e.stopPropagation();
    if (mode.kind === 'measure' || mode.kind === 'route') {
      clickAt({ lon: place.lon, lat: place.lat }, place.id);
      return;
    }
    onSelect(place.id);
    setCardOpen(true);
  };

  // --- toolbar actions ------------------------------------------------------------

  const choosePlace = (place: AtlasPlace) => {
    onSelect(place.id);
    if (hasCoordinates(place)) {
      setView((v) => v && focusView(v, place));
      setCardOpen(true);
    } else {
      setMode({ kind: 'place', placeId: place.id, source: 'map' });
    }
  };

  const toggleMode = (kind: 'add' | 'measure') => {
    if (mode.kind === kind) exitMode();
    else {
      setMode(kind === 'add' ? { kind } : { kind, from: undefined });
      setCardOpen(false);
    }
  };

  const measureFrom = (place: AtlasPlace & { lat: number; lon: number }) => {
    setMode({ kind: 'measure', from: { lon: place.lon, lat: place.lat, placeId: place.id } });
    setCardOpen(false);
  };

  const toggleRoutes = () => {
    if (routesOpen && mode.kind === 'route') exitMode();
    setRoutesOpen((open) => !open);
  };

  // --- layout -----------------------------------------------------------------------

  const tiles = prefs?.tiles ?? false;
  const hierarchy = prefs?.hierarchy ?? false;
  const dragId = pinDrag?.id ?? null;
  const dragAt = pinDrag?.at ?? null;

  // Screen position (in layout coordinates) of every located place, the one
  // being dragged following the pointer. Only those within a screen of the
  // viewport become pins, but the lines need all of them — a parent off the
  // edge still anchors its children's lines.
  const laidOut = useMemo(() => {
    if (!layoutView) return { screenOf: new Map<string, Point>(), positioned: [] as { place: AtlasPlace & { lat: number; lon: number }; x: number; y: number }[] };
    const screenOf = new Map<string, Point>();
    const positioned = [];
    for (const place of located) {
      const at = dragId === place.id && dragAt ? dragAt : place;
      const p = toScreen(layoutView, size, at);
      screenOf.set(place.id, p);
      if (dragId === place.id || (p.x >= -size.width && p.x <= 2 * size.width && p.y >= -size.height && p.y <= 2 * size.height)) {
        positioned.push({ place, x: p.x, y: p.y });
      }
    }
    return { screenOf, positioned };
  }, [located, layoutView, size, dragId, dragAt]);
  const { screenOf, positioned } = laidOut;

  const tileLayer = view && tiles ? tileElements(view, size, origin) : null;
  const paths = useMemo(
    () => (view && !tiles && basemap ? basemapPaths(basemap, view, size) : []),
    [view, tiles, basemap, size],
  );
  const labels = view && !tiles && basemap && view.zoom >= COUNTRY_LABEL_ZOOM
    ? countryLabels(basemap, view, size, COUNTRY_LABEL_MIN_PX)
    : [];

  const measure = mode.kind === 'measure' ? mode : null;
  const measureEnd = measure?.to ?? (measure?.from ? cursor : null);
  const measureLine = view && measure?.from && measureEnd
    ? { a: toScreen(view, size, measure.from), b: toScreen(view, size, measureEnd) }
    : null;

  const building = mode.kind === 'route' ? mode.placeIds : null;
  const routeLines = useMemo((): RouteLine[] => {
    if (!layoutView) return [];
    const toPoints = (ids: readonly string[]) => routePoints({ placeIds: [...ids] }, byId).map((p) => toScreen(layoutView, size, p));
    const lines: RouteLine[] = routes.map((route) => ({ id: route.id, points: toPoints(route.placeIds), selected: route.id === selectedRouteId }));
    if (building && building.length) lines.push({ id: '__building', points: toPoints(building), selected: true, building: true });
    return lines;
  }, [layoutView, size, routes, selectedRouteId, building, byId]);

  const banner = mode.kind === 'add'
    ? t('realAtlas.map.banner.add')
    : mode.kind === 'place'
      ? fillName(t('realAtlas.map.banner.place'), placeName(mode.placeId) ?? '')
      : mode.kind === 'measure'
        ? (mode.from && !mode.to
            ? t('realAtlas.map.banner.measureTo')
            : mode.from && mode.to
              ? t('realAtlas.map.banner.measureAgain')
              : t('realAtlas.map.banner.measureFrom'))
        : mode.kind === 'route'
          ? t('realAtlas.map.banner.route')
          : null;

  const cursorClass = mode.kind === 'browse'
    ? (panning ? 'cursor-grabbing' : 'cursor-grab')
    : 'cursor-crosshair';
  // Pins are scenery while the writer is aiming at the map itself.
  const pinsInert = mode.kind === 'add' || mode.kind === 'place';
  const selectedId = selectedPlace?.id ?? null;
  const selectedScreen = selectedPlace && hasCoordinates(selectedPlace) && view ? toScreen(view, size, selectedPlace) : undefined;
  const labelsOn = !!view && view.zoom >= LABEL_ZOOM && positioned.length <= LABEL_LIMIT;

  // The pin elements are rebuilt every render, but `Pin` is memoised and its
  // props only change on a re-layout: during a pan React compares two
  // thousand prop bags and renders nothing, which is cheap enough.
  const pinElements = positioned.map(({ place, x, y }) => (
    <Pin
      key={place.id}
      place={place}
      x={x}
      y={y}
      selected={place.id === selectedId}
      divergences={divergenceCount.get(place.id) ?? 0}
      showLabel={labelsOn || place.id === selectedId}
      inert={pinsInert}
      dragging={place.id === dragId}
    />
  ));

  const hierarchyLines = hierarchy ? positioned.map(({ place, x, y }) => {
    const parent = place.parentId ? screenOf.get(place.parentId) : undefined;
    return parent ? (
      <line key={place.id} x1={parent.x} y1={parent.y} x2={x} y2={y} stroke="var(--color-text-dim)" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
    ) : null;
  }) : null;

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={t('realAtlas.tabs.map')}
      tabIndex={0}
      onPointerDown={onMapPointerDown}
      onPointerMove={onMapPointerMove}
      onPointerUp={onMapPointerUp}
      onPointerCancel={onMapPointerUp}
      onDoubleClick={onMapDoubleClick}
      onKeyDown={onKeyDown}
      // Geometry inline, look in classes: the layers must stack and the pins
      // must land on their coordinates with no stylesheet at all (the test
      // harness has none), so nothing that positions is left to Tailwind.
      style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}
      className={`touch-none select-none rounded-xl border border-border bg-deep outline-none focus-visible:ring-1 focus-visible:ring-accent-gold ${cursorClass}`}
    >
      {!view && ready && <EngineSpinner />}

      {/* 1. Raster tiles (opt-in). */}
      {tileLayer && <div style={LAYER} className="pointer-events-none">{tileLayer}</div>}

      {/* 2. Vector basemap. */}
      {view && !tiles && (
        <svg style={LAYER} className="pointer-events-none" width={size.width} height={size.height} aria-hidden="true">
          <g data-layer="basemap" fill="var(--color-elevated)" stroke="var(--color-border)" strokeWidth={1} strokeLinejoin="round" fillRule="evenodd">
            {paths.map((country) => <path key={country.name} d={country.d} />)}
          </g>
          {labels.map((label) => (
            <text key={`${label.name}@${label.copy}`} x={label.x} y={label.y} textAnchor="middle" fontSize={10} fill="var(--color-text-dim)" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {label.name}
            </text>
          ))}
        </svg>
      )}

      {/* 3. Pins, hierarchy lines and routes: laid out once, moved as a whole. */}
      {view && (
        <div
          data-layer="pins"
          style={{ ...LAYER, transform: `translate(${shift.x}px, ${shift.y}px)`, pointerEvents: 'none' }}
          onPointerDown={onPinPointerDown}
          onPointerMove={onPinPointerMove}
          onPointerUp={onPinPointerUp}
          onPointerCancel={onPinPointerUp}
          onLostPointerCapture={onPinLostCapture}
          onClick={onPinClick}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={size.width} height={size.height} aria-hidden="true">
            {hierarchyLines}
            <RouteLines routes={routeLines} />
          </svg>
          {pinElements}
        </div>
      )}

      {/* 4. The measuring rule, in live coordinates. */}
      {measureLine && (
        <svg style={LAYER} className="pointer-events-none" width={size.width} height={size.height} aria-hidden="true">
          <g stroke="var(--color-accent-gold)" fill="var(--color-accent-gold)">
            <line x1={measureLine.a.x} y1={measureLine.a.y} x2={measureLine.b.x} y2={measureLine.b.y} strokeWidth={2} strokeDasharray="6 4" />
            <circle cx={measureLine.a.x} cy={measureLine.a.y} r={4} />
            <circle cx={measureLine.b.x} cy={measureLine.b.y} r={4} />
          </g>
        </svg>
      )}

      {/* Chrome. The toolbar stops pointer events so a click on it never pans. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-1.5 p-2">
        <div onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <MapToolbar
            places={places}
            unplaced={unplaced}
            tiles={tiles}
            hierarchy={hierarchy}
            adding={mode.kind === 'add'}
            measuring={mode.kind === 'measure'}
            routesOpen={routesOpen}
            onChoose={choosePlace}
            onFitAll={() => setView(fitBounds(located.length ? located : WORLD_EXTENT, size, 48, FIT_MAX_ZOOM))}
            onToggleTiles={() => updatePrefs({ tiles: !tiles })}
            onToggleHierarchy={() => updatePrefs({ hierarchy: !hierarchy })}
            onToggleAdd={() => toggleMode('add')}
            onToggleMeasure={() => toggleMode('measure')}
            onToggleRoutes={toggleRoutes}
            onZoom={(delta) => setView((v) => v && zoomBy(v, delta))}
            onPlace={(place) => { setMode({ kind: 'place', placeId: place.id, source: 'map' }); setCardOpen(false); }}
          />
        </div>
        {banner && (
          <p className="pointer-events-none self-start rounded-md border border-accent-gold/40 bg-elevated/90 px-2.5 py-1 text-xs text-accent-gold shadow">
            {banner}
          </p>
        )}
        {view && located.length === 0 && mode.kind === 'browse' && (
          <p className="pointer-events-none self-start rounded-md bg-elevated/80 px-2.5 py-1 text-xs text-text-dim">{t('realAtlas.map.emptyHint')}</p>
        )}
      </div>

      {cardOpen && selectedPlace && hasCoordinates(selectedPlace) && selectedScreen && (
        <PlaceCard
          place={selectedPlace}
          divergences={divergenceCount.get(selectedPlace.id) ?? 0}
          x={selectedScreen.x}
          y={selectedScreen.y}
          width={size.width}
          height={size.height}
          onEdit={() => onEdit(selectedPlace.id)}
          onMeasureFrom={() => measureFrom(selectedPlace)}
          onClose={() => setCardOpen(false)}
        />
      )}

      {measure?.from && measure.to && (
        <MeasurePanel from={measure.from} to={measure.to} placeName={placeName} onClose={exitMode} />
      )}

      {routesOpen && (
        <RoutesPanel
          routes={routes}
          places={places}
          selectedRouteId={selectedRouteId}
          building={building}
          onSelect={chooseRoute}
          onRename={(id, name) => void persistRoutes(routes.map((route) => (route.id === id ? { ...route, name } : route)))}
          onDelete={(id) => {
            if (selectedRouteId === id) setSelectedRouteId(null);
            void persistRoutes(routes.filter((route) => route.id !== id));
          }}
          onStart={() => { setMode({ kind: 'route', placeIds: [] }); setCardOpen(false); }}
          onFinish={finishRoute}
          onCancel={exitMode}
          onClose={toggleRoutes}
        />
      )}

      {undo && (
        <UndoBar
          message={fillName(t(undo.messageKey), undo.name)}
          onUndo={() => void undoMove()}
          onDismiss={() => setUndo(null)}
        />
      )}

      {tiles && (
        <p className="pointer-events-none absolute bottom-1 right-2 z-10 rounded bg-deep/70 px-1.5 text-[10px] text-text-muted">
          © OpenStreetMap contributors
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * The OSM tiles covering the view. Tiles exist at integer zooms; the nearest
 * one is scaled by 2^(zoom − z) so a fractional zoom still lines up with the
 * vector layers above it. Columns past either edge of the world wrap round
 * to the other side (`wrapTileX`), so a view on the antimeridian is whole.
 * Keys are z/x/y so a pan re-positions the same <img> elements rather than
 * re-requesting them.
 */
function tileElements(view: MapView, size: Size, origin: Point) {
  const z = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.round(view.zoom)));
  const scale = worldSize(view.zoom) / worldSize(z);
  const tilePx = 256 * scale;
  const range = tileRange(
    { x0: origin.x / scale, y0: origin.y / scale, x1: (origin.x + size.width) / scale, y1: (origin.y + size.height) / scale },
    z,
  );
  const elements = [];
  for (let ty = range.yMin; ty <= range.yMax; ty += 1) {
    for (let tx = range.xMin; tx <= range.xMax; tx += 1) {
      const column = wrapTileX(tx, z);
      elements.push(
        <img
          key={`${z}/${tx}/${ty}`}
          src={`https://tile.openstreetmap.org/${z}/${column}/${ty}.png`}
          alt=""
          loading="lazy"
          draggable={false}
          style={{ left: tx * tilePx - origin.x, top: ty * tilePx - origin.y, width: tilePx, height: tilePx }}
          className="absolute max-w-none"
        />,
      );
    }
  }
  return elements;
}
