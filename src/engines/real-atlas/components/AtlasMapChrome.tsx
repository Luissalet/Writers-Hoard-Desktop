import { memo, useState, type ReactNode } from 'react';
import {
  Check, Crosshair, Globe, GitBranch, MapPinOff, Maximize, Minus, Pencil, Plus, Route as RouteIcon, Ruler, Search, Sparkles,
  Trash2, Undo2, X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import type { AtlasPlace } from '../types';
import { matchPlaces } from '../search';
import {
  bearingDeg, compassPoint, formatDistance, formatDuration, hasCoordinates, haversineKm, travelEstimates,
  type LonLat, type Point,
} from '../geo';
import { routeTotals, type AtlasRoute } from '../routes';
import { KIND_STYLE } from './kinds';
import { divergenceCountLabel } from './labels';

// The map's furniture: toolbar, pins, the floating card, the measure panel,
// the routes panel and the undo bar. All module-level components (the
// compiler rule), all presentational — state and geometry stay in
// AtlasMap.tsx.

const toolButton = (active: boolean) =>
  `flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition ${
    active
      ? 'border-accent-gold bg-accent-gold/15 text-accent-gold'
      : 'border-border bg-surface/90 text-text-muted hover:border-accent-gold/40 hover:text-text-primary'
  }`;

export function ToolButton({ active = false, label, hint, onClick, children }: {
  active?: boolean; label: string; hint?: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} title={hint ?? label} aria-label={label} onClick={onClick} className={toolButton(active)}>
      {children}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

/** A bearing readout in the reader's letters: "ENE (67°)". */
function bearingLabel(bearing: number, cardinals: string): string {
  return `${compassPoint(bearing, cardinals)} (${Math.round(bearing)}°)`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_LIMIT = 8;

export function SearchBox({ places, onChoose }: { places: readonly AtlasPlace[]; onChoose: (place: AtlasPlace) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const hits = matchPlaces(places, query, SEARCH_LIMIT);
  const choose = (place: AtlasPlace) => {
    onChoose(place);
    setQuery('');
    setOpen(false);
  };
  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) choose(hits[0]);
          if (e.key === 'Escape') { setQuery(''); setOpen(false); }
        }}
        placeholder={t('realAtlas.map.search')}
        aria-label={t('realAtlas.map.search')}
        className="h-8 w-44 rounded-lg border border-border bg-surface/90 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-dim outline-none transition focus:border-accent-gold"
      />
      {open && query.trim() && (
        <ul className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-elevated shadow-xl">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-text-dim">{t('realAtlas.map.noMatches')}</li>
          ) : hits.map((place) => (
            <li key={place.id}>
              {/* onMouseDown, not onClick: the input's blur closes the list before a click lands. */}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(place); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-accent-gold/10"
              >
                <span className="min-w-0 flex-1 truncate">{place.name}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-dim">
                  {hasCoordinates(place) ? t(`realAtlas.kind.${place.kind}`) : t('realAtlas.map.noCoords')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Places without coordinates
// ---------------------------------------------------------------------------

export function UnplacedMenu({ places, onPlace }: { places: readonly AtlasPlace[]; onPlace: (place: AtlasPlace) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t('realAtlas.map.unplaced').replace('{count}', String(places.length));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('realAtlas.map.unplacedHint')}
        aria-expanded={open}
        className={toolButton(open)}
      >
        <MapPinOff size={14} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-elevated shadow-xl">
          <p className="border-b border-border px-3 py-2 text-[11px] text-text-dim">{t('realAtlas.map.unplacedHint')}</p>
          <ul className="max-h-64 overflow-y-auto py-1">
            {places.map((place) => (
              <li key={place.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{place.name}</span>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onPlace(place); }}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-accent-gold/40 px-2 py-0.5 text-[11px] text-accent-gold transition hover:bg-accent-gold/10"
                >
                  <Crosshair size={11} />
                  {t('realAtlas.map.placeOnMap')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export interface ToolbarProps {
  places: readonly AtlasPlace[];
  unplaced: readonly AtlasPlace[];
  tiles: boolean;
  hierarchy: boolean;
  adding: boolean;
  measuring: boolean;
  routesOpen: boolean;
  onChoose: (place: AtlasPlace) => void;
  onFitAll: () => void;
  onToggleTiles: () => void;
  onToggleHierarchy: () => void;
  onToggleAdd: () => void;
  onToggleMeasure: () => void;
  onToggleRoutes: () => void;
  onZoom: (delta: number) => void;
  onPlace: (place: AtlasPlace) => void;
}

export function MapToolbar(p: ToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
      <SearchBox places={p.places} onChoose={p.onChoose} />
      <ToolButton label={t('realAtlas.map.fitAll')} onClick={p.onFitAll}><Maximize size={14} /></ToolButton>
      <ToolButton label={t('realAtlas.map.tiles')} hint={t('realAtlas.map.tilesHint')} active={p.tiles} onClick={p.onToggleTiles}><Globe size={14} /></ToolButton>
      <ToolButton label={t('realAtlas.map.hierarchy')} hint={t('realAtlas.map.hierarchyHint')} active={p.hierarchy} onClick={p.onToggleHierarchy}><GitBranch size={14} /></ToolButton>
      <ToolButton label={t('realAtlas.map.addPlace')} hint={t('realAtlas.map.addPlaceHint')} active={p.adding} onClick={p.onToggleAdd}><Plus size={14} /></ToolButton>
      <ToolButton label={t('realAtlas.map.measure')} hint={t('realAtlas.map.measureHint')} active={p.measuring} onClick={p.onToggleMeasure}><Ruler size={14} /></ToolButton>
      <ToolButton label={t('realAtlas.routes.title')} hint={t('realAtlas.routes.hint')} active={p.routesOpen} onClick={p.onToggleRoutes}><RouteIcon size={14} /></ToolButton>
      <div className="flex overflow-hidden rounded-lg border border-border bg-surface/90">
        <button type="button" aria-label={t('realAtlas.map.zoomIn')} title={t('realAtlas.map.zoomIn')} onClick={() => p.onZoom(1)} className="flex h-8 w-8 items-center justify-center text-text-muted transition hover:text-text-primary"><Plus size={14} /></button>
        <button type="button" aria-label={t('realAtlas.map.zoomOut')} title={t('realAtlas.map.zoomOut')} onClick={() => p.onZoom(-1)} className="flex h-8 w-8 items-center justify-center border-l border-border text-text-muted transition hover:text-text-primary"><Minus size={14} /></button>
      </div>
      {p.unplaced.length > 0 && <UnplacedMenu places={p.unplaced} onPlace={p.onPlace} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

export interface PinProps {
  place: AtlasPlace;
  x: number;
  y: number;
  selected: boolean;
  divergences: number;
  showLabel: boolean;
  /** Pins that are only scenery in the current mode do not take the pointer. */
  inert: boolean;
  dragging: boolean;
}

/**
 * One pin. No handlers of its own: the pin layer in AtlasMap.tsx delegates
 * pointer events by `data-pin-id`, which is what lets `memo` hold — with a
 * closure per pin, every render of the map re-rendered two thousand buttons.
 */
export const Pin = memo(function Pin({ place, x, y, selected, divergences, showLabel, inert, dragging }: PinProps) {
  const { t } = useTranslation();
  const { icon: Icon, color } = KIND_STYLE[place.kind] ?? KIND_STYLE.other;
  return (
    <button
      type="button"
      data-pin-id={place.id}
      title={place.name}
      aria-label={place.name}
      aria-pressed={selected}
      // Geometry and hit-testing inline, look in classes: the pin's anchor must
      // hold without a stylesheet, and the layer it sits in takes no pointer
      // events itself, so the pin has to say it does.
      style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: selected || dragging ? 3 : 2, pointerEvents: inert ? 'none' : 'auto' }}
      className={`group touch-none select-none ${dragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
    >
      <span
        className={`relative flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-md shadow-black/40 transition-transform group-hover:scale-110 ${
          place.fictional ? 'border-dashed border-text-primary' : 'border-deep'
        } ${selected ? 'ring-2 ring-accent-gold ring-offset-2 ring-offset-deep' : ''}`}
        style={{ backgroundColor: color }}
      >
        <Icon size={14} className="text-deep" />
        {divergences > 0 && (
          <span
            title={divergenceCountLabel(t, divergences)}
            className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-deep bg-accent-amber"
          />
        )}
        {place.fictional && (
          <span title={t('realAtlas.place.fictional')} className="absolute -bottom-1 -left-1 rounded-full bg-deep p-px text-accent-plum-light">
            <Sparkles size={9} />
          </span>
        )}
      </span>
      {showLabel && (
        <span
          className={`absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium ${selected ? 'text-accent-gold' : 'text-text-primary'}`}
          style={{ textShadow: '0 0 3px var(--color-deep), 0 0 6px var(--color-deep)' }}
        >
          {place.name}
        </span>
      )}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Floating card for the selected place
// ---------------------------------------------------------------------------

export function PlaceCard({ place, divergences, x, y, width, height, onEdit, onMeasureFrom, onClose }: {
  place: AtlasPlace; divergences: number; x: number; y: number; width: number; height: number;
  onEdit: () => void; onMeasureFrom: () => void; onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const CARD_W = 240;
  const CARD_H = 150;
  const left = Math.min(Math.max(x + 18, 8), Math.max(8, width - CARD_W - 8));
  const top = Math.min(Math.max(y - 24, 8), Math.max(8, height - CARD_H - 8));
  const coords = hasCoordinates(place)
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(place.lat)}, ${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(place.lon)}`
    : '';
  return (
    <div
      role="dialog"
      aria-label={place.name}
      style={{ left, top, width: CARD_W }}
      className="pointer-events-auto absolute z-10 rounded-lg border border-border bg-elevated/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-serif text-sm font-semibold text-accent-gold">{place.name}</h4>
          <p className="text-[10px] uppercase tracking-wide text-text-dim">
            {t(`realAtlas.kind.${place.kind}`)}{place.fictional ? ` · ${t('realAtlas.place.fictional')}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className="shrink-0 text-text-dim transition hover:text-text-primary"><X size={14} /></button>
      </div>
      <p className="mt-1 font-mono text-[11px] text-text-muted">{coords}</p>
      <p className="text-[11px] text-text-dim">{divergenceCountLabel(t, divergences)}</p>
      <div className="mt-2 flex gap-1.5">
        <button type="button" onClick={onEdit} className="flex items-center gap-1 rounded-md bg-accent-gold/10 px-2 py-1 text-[11px] text-accent-gold transition hover:bg-accent-gold/20">
          <Pencil size={11} />{t('common.edit')}
        </button>
        <button type="button" onClick={onMeasureFrom} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:border-accent-gold/40 hover:text-text-primary">
          <Ruler size={11} />{t('realAtlas.map.card.measureFrom')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

export interface MeasurePoint extends LonLat {
  placeId?: string;
}

/** Below this the two points are the same place: no bearing, no stages, just "0 m". */
const NEGLIGIBLE_KM = 0.05;

function StagesCell({ days }: { days: number | undefined }) {
  const { t } = useTranslation();
  if (days === undefined) return null;
  return days === 1
    ? t('realAtlas.map.measure.stagesOne')
    : t('realAtlas.map.measure.stages').replace('{count}', String(days));
}

export function MeasurePanel({ from, to, placeName, onClose }: {
  from: MeasurePoint; to: MeasurePoint; placeName: (id?: string) => string | undefined; onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const km = haversineKm(from, to);
  const negligible = km < NEGLIGIBLE_KM;
  const label = (p: MeasurePoint) => placeName(p.placeId) ?? t('realAtlas.map.measure.point');
  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-3 z-10 w-72 rounded-lg border border-border bg-elevated/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-text-muted">{label(from)} → {label(to)}</p>
        <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className="shrink-0 text-text-dim transition hover:text-text-primary"><X size={14} /></button>
      </div>
      <p className="mt-1 font-serif text-xl font-semibold text-accent-gold">{formatDistance(km, locale)}</p>
      {!negligible && (
        <p className="text-[11px] text-text-dim">
          {t('realAtlas.map.measure.bearing')}: {bearingLabel(bearingDeg(from, to), t('realAtlas.map.cardinals'))}
        </p>
      )}
      <table className="mt-2 w-full text-[11px]">
        <caption className="mb-1 text-left text-[10px] uppercase tracking-wide text-text-dim">{t('realAtlas.map.measure.travel')}</caption>
        <tbody>
          {travelEstimates(km).map((estimate) => (
            <tr key={estimate.mode} className="border-t border-border/60">
              <td className="py-0.5 text-text-muted">{t(`realAtlas.map.travel.${estimate.mode}`)}</td>
              <td className="py-0.5 text-right font-mono text-text-primary">{formatDuration(estimate.hours, locale)}</td>
              <td className="py-0.5 pl-2 text-right text-text-dim">
                {!negligible && <StagesCell days={estimate.days} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-text-dim">{t('realAtlas.map.measure.hint')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routes: the lines on the map and the side panel
// ---------------------------------------------------------------------------

export interface RouteLine {
  id: string;
  /** Screen points of the stops that have coordinates, in order. */
  points: Point[];
  selected: boolean;
  /** The route being clicked together right now: dashed, no arrows. */
  building?: boolean;
}

/**
 * Every route as a polyline with an arrow at the end of each leg. Rendered
 * inside the pin layer's SVG so it moves with the pins during a pan; the
 * markers are defined here once.
 */
export function RouteLines({ routes }: { routes: readonly RouteLine[] }) {
  if (!routes.length) return null;
  return (
    <g data-layer="routes">
      <defs>
        <marker id="atlas-route-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-accent-gold)" />
        </marker>
        <marker id="atlas-route-arrow-dim" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-text-dim)" />
        </marker>
      </defs>
      {routes.map((route) => {
        const stroke = route.selected || route.building ? 'var(--color-accent-gold)' : 'var(--color-text-dim)';
        const legs = [];
        for (let i = 1; i < route.points.length; i += 1) {
          const a = route.points[i - 1];
          const b = route.points[i];
          legs.push(
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={route.selected || route.building ? 2.5 : 1.5}
              strokeLinecap="round"
              strokeDasharray={route.building ? '6 4' : undefined}
              opacity={route.selected || route.building ? 0.95 : 0.55}
              markerEnd={route.building ? undefined : `url(#${route.selected ? 'atlas-route-arrow' : 'atlas-route-arrow-dim'})`}
            />,
          );
        }
        return <g key={route.id} data-route-id={route.id}>{legs}</g>;
      })}
    </g>
  );
}

function RouteRow({ route, places, selected, onSelect, onRename, onDelete }: {
  route: AtlasRoute; places: readonly AtlasPlace[]; selected: boolean;
  onSelect: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const { t, locale } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(route.name);
  const [pendingDelete, setPendingDelete] = useState(false);
  const totals = routeTotals(route, places);
  const byId = new Map(places.map((place) => [place.id, place]));
  const stopName = (id: string) => byId.get(id)?.name ?? t('realAtlas.routes.missingStop');
  const commitName = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== route.name) onRename(trimmed);
    else setName(route.name);
  };
  return (
    <li className={`rounded-lg border ${selected ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-surface/60'}`}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setName(route.name); setRenaming(false); }
              e.stopPropagation();
            }}
            aria-label={t('realAtlas.routes.rename')}
            className="h-6 min-w-0 flex-1 rounded border border-border bg-elevated px-1.5 text-xs text-text-primary outline-none focus:border-accent-gold"
          />
        ) : (
          <button type="button" onClick={onSelect} className={`min-w-0 flex-1 truncate text-left text-xs ${selected ? 'text-accent-gold' : 'text-text-primary'}`}>
            {route.name || t('realAtlas.routes.untitled')}
          </button>
        )}
        <span className="shrink-0 font-mono text-[11px] text-text-muted">{formatDistance(totals.km, locale)}</span>
        <button type="button" onClick={() => { setName(route.name); setRenaming(true); }} aria-label={t('realAtlas.routes.rename')} title={t('realAtlas.routes.rename')} className="shrink-0 p-1 text-text-dim transition hover:text-text-primary"><Pencil size={11} /></button>
        <button type="button" onClick={() => setPendingDelete(true)} aria-label={t('realAtlas.routes.delete')} title={t('realAtlas.routes.delete')} className="shrink-0 p-1 text-text-dim transition hover:text-danger"><Trash2 size={11} /></button>
      </div>
      {selected && (
        <div className="border-t border-border/60 px-2 py-1.5 text-[11px]">
          <p className="text-text-dim">
            {t('realAtlas.routes.stops').replace('{count}', String(route.placeIds.length))}
            {totals.missing.length > 0 && ` · ${t('realAtlas.routes.missing').replace('{count}', String(totals.missing.length))}`}
          </p>
          <table className="mt-1 w-full">
            <tbody>
              {totals.estimates.map((estimate) => (
                <tr key={estimate.mode} className={route.mode === estimate.mode ? 'text-accent-gold' : 'text-text-muted'}>
                  <td className="py-0.5">{t(`realAtlas.map.travel.${estimate.mode}`)}</td>
                  <td className="py-0.5 text-right font-mono">{formatDuration(estimate.hours, locale)}</td>
                  <td className="py-0.5 pl-2 text-right text-text-dim">{totals.km >= NEGLIGIBLE_KM && <StagesCell days={estimate.days} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totals.legs.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-text-dim">{t('realAtlas.routes.legs')}</summary>
              <ol className="mt-1 space-y-0.5">
                {totals.legs.map((leg, i) => (
                  <li key={i} className="flex items-baseline gap-1 text-text-muted">
                    <span className="min-w-0 flex-1 truncate">{stopName(leg.fromId)} → {stopName(leg.toId)}</span>
                    <span className="shrink-0 font-mono text-text-primary">{formatDistance(leg.km, locale)}</span>
                    <span className="shrink-0 text-text-dim">{compassPoint(leg.bearingDeg, t('realAtlas.map.cardinals'))}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('realAtlas.routes.deleteConfirm').replace('{name}', () => route.name)}
        onConfirm={() => { setPendingDelete(false); onDelete(); }}
        onCancel={() => setPendingDelete(false)}
      />
    </li>
  );
}

export interface RoutesPanelProps {
  routes: readonly AtlasRoute[];
  places: readonly AtlasPlace[];
  selectedRouteId: string | null;
  /** Ids clicked so far while a new route is being built, or null when not building. */
  building: readonly string[] | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onClose: () => void;
}

export function RoutesPanel(p: RoutesPanelProps) {
  const { t } = useTranslation();
  const byId = new Map(p.places.map((place) => [place.id, place]));
  return (
    <aside
      aria-label={t('realAtlas.routes.title')}
      className="pointer-events-auto absolute bottom-3 right-3 top-14 z-10 flex w-72 flex-col rounded-lg border border-border bg-elevated/95 shadow-xl shadow-black/40 backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h4 className="font-serif text-sm font-semibold text-text-primary">{t('realAtlas.routes.title')}</h4>
        <button type="button" onClick={p.onClose} aria-label={t('common.close')} title={t('common.close')} className="text-text-dim transition hover:text-text-primary"><X size={14} /></button>
      </div>
      {p.building ? (
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs text-accent-gold">{t('realAtlas.routes.buildingHint')}</p>
          <ol className="mt-1 max-h-32 overflow-y-auto text-[11px] text-text-muted">
            {p.building.map((id, i) => <li key={`${id}-${i}`} className="truncate">{i + 1}. {byId.get(id)?.name ?? t('realAtlas.routes.missingStop')}</li>)}
          </ol>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={p.onFinish}
              disabled={p.building.length < 2}
              className="flex items-center gap-1 rounded-md bg-accent-gold/15 px-2 py-1 text-[11px] font-semibold text-accent-gold transition hover:bg-accent-gold/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check size={11} />{t('realAtlas.routes.finish')}
            </button>
            <button type="button" onClick={p.onCancel} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:text-text-primary">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-b border-border px-3 py-2">
          <button type="button" onClick={p.onStart} className="flex items-center gap-1 rounded-md bg-accent-gold/10 px-2 py-1 text-[11px] text-accent-gold transition hover:bg-accent-gold/20">
            <Plus size={11} />{t('realAtlas.routes.new')}
          </button>
        </div>
      )}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {p.routes.length === 0 && !p.building && <li className="px-1 py-2 text-xs text-text-dim">{t('realAtlas.routes.empty')}</li>}
        {p.routes.map((route) => (
          <RouteRow
            key={route.id}
            route={route}
            places={p.places}
            selected={route.id === p.selectedRouteId}
            onSelect={() => p.onSelect(route.id)}
            onRename={(name) => p.onRename(route.id, name)}
            onDelete={() => p.onDelete(route.id)}
          />
        ))}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Undo bar for a moved pin
// ---------------------------------------------------------------------------

export function UndoBar({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-elevated px-3.5 py-2 shadow-lg shadow-black/30"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs text-text-primary">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex items-center gap-1.5 rounded-md border border-accent-gold/40 px-2.5 py-1 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold/10"
      >
        <Undo2 size={13} />
        {t('realAtlas.map.undo')}
      </button>
      <button type="button" onClick={onDismiss} className="text-text-dim transition hover:text-text-primary" aria-label={t('common.dismiss')} title={t('common.dismiss')}>
        <X size={14} />
      </button>
    </div>
  );
}
