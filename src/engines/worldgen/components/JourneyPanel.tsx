import JourneyPlayback from './JourneyPlayback';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import {
  describeDuration, effectiveHoursPerDay, GROUND_CLASSES, MODE_KEY, SEASON_KEY, TRAVEL_PACES,
  type GroundClass, type Route, type Season, type TravelMode, type TravelPace, type TravelProfile,
} from '../core/travel';
import { seaLevelForIce, type PaleoState } from '../core/paleo';
import { useJourneyComputation, useJourneyPaleo } from '../useJourneyComputation';
import { useTranslation } from '@/i18n/useTranslation';
import type { GeneratedWorld } from '../types';
import { journeyNormalizedStops, journeyRecipeKey, type WorldJourney } from '../journeyTypes';
import { deleteWorldJourney, saveWorldJourney, saveWorldTravelSettings, type TravelFactorEdit } from '../journeyOperations';
import { ConfirmDialog } from '@/engines/_shared';
import JourneyCreativeCapture from './JourneyCreativeCapture';

/**
 * Two questions the reader asks a map and no map generator answers.
 *
 * HOW LONG DOES IT TAKE — a least-time route over the real gradient, surface,
 * road, river and ice, for every mode and season at once, because the useful
 * answer is not "nine days" but "nine days in summer and nineteen in winter,
 * and the cart cannot go at all".
 *
 * WHAT DID IT LOOK LIKE — sea level and ice moved together, because the water in
 * an ice sheet comes out of the ocean. That is geography, not history: no
 * peoples, no dates, just the shape of the ground when the sea was lower.
 */

interface JourneyPanelProps {
  worldRecord?: GeneratedWorld;
  onOpenJourney?: (journey: WorldJourney) => void;
  onJourneysChanged?: () => void | Promise<void>;
  world: WorldData;
  geography: HumanGeography;
  from: Settlement | null;
  to: Settlement | null;
  picking: 'from' | 'to' | 'via' | null;
  onPick: (which: 'from' | 'to' | 'via' | null) => void;
  via: Settlement[];
  onClearVia: () => void;
  onSwap: () => void;
  onClear: () => void;
  /** The route to draw on the map, or null to draw none. */
  onRoute: (route: Route | null, color: string) => void;
  /** The party's banner while the journey is played, or null. */
  onTraveller?: (traveller: { x: number; y: number; label: string; resting: boolean } | null) => void;
  paleo: PaleoState | null;
  onPaleo: (state: PaleoState | null) => void;
}

const MODES: TravelMode[] = ['foot', 'horse', 'cart', 'boat', 'ship'];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const HPD: Record<Season, number> = { spring: 10, summer: 11, autumn: 9, winter: 7 };
const MODE_COLOR: Record<TravelMode, string> = {
  foot: '#a3261e', horse: '#1b5e20', cart: '#0d47a1', boat: '#00695c', ship: '#4527a0',
};

export default function JourneyPanel(props: JourneyPanelProps) {
  return <JourneyPanelContent key={props.worldRecord ? `${props.worldRecord.projectId}:${props.worldRecord.id}` : 'unsaved'} {...props} />;
}

function JourneyPanelContent({
  world, geography, from, to, picking, onPick, onSwap, onClear, onRoute, onTraveller,
  via, onClearVia, paleo, onPaleo, worldRecord, onOpenJourney, onJourneysChanged,
}: JourneyPanelProps) {
  const { t, locale } = useTranslation();
  const scope = useWorldEraScope(worldRecord?.projectId);
  const [mode, setMode] = useState<TravelMode>('foot');
  const [season, setSeason] = useState<Season>('summer');
  const [showAll, setShowAll] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [customOptions, setCustomOptions] = useState<Pick<WorldJourney['options'], 'hoursPerDay' | 'planetRadiusKm'>>({});
  /** How hard the party pushes; the world remembers the author's usual pace. */
  const [pace, setPace] = useState<TravelPace>(worldRecord?.travelPace ?? 'steady');
  /** One mode per leg between stops; empty entries follow the journey's mode. */
  const [legModes, setLegModes] = useState<(TravelMode | '')[]>([]);
  /** The world's own speeds and ground costs, edited here and saved with the world. */
  const [profile, setProfile] = useState<TravelProfile>(worldRecord?.travelProfile ?? {});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [journeyName, setJourneyName] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [savedLocally, setSavedLocally] = useState<WorldJourney[]>([]);
  const [openedJourney, setOpenedJourney] = useState<WorldJourney | null>(null);
  const [deletingJourney, setDeletingJourney] = useState<WorldJourney | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [deletedJourneys, setDeletedJourneys] = useState<WorldJourney[]>([]);
  const legCount = via.length + 1;
  /** Per-leg modes are positional: when a stop goes, they would slide onto other legs, so they start again. */
  // Only when the stored modes outnumber the legs: an opened trip brings its own, matching count.
  useEffect(() => { setLegModes((current) => (current.length > legCount ? [] : current)); }, [legCount]);
  const activeLegModes = legModes.slice(0, legCount);
  const mixedModes = activeLegModes.some(value => value && value !== mode);
  const planOptions: WorldJourney['options'] = {
    ...customOptions, mode, season,
    ...(pace !== 'steady' ? { pace } : {}),
    ...(mixedModes ? { legModes: Array.from({ length: legCount }, (_, index) => activeLegModes[index] || mode) } : {}),
    ...(Object.keys(profile).length ? { profile } : {}),
  };
  const hoursPerDay = effectiveHoursPerDay(planOptions);
  /**
   * Travel settings belong to the world; an opened itinerary is planned with
   * the settings it was saved with. Only the author's own edits of the pace or
   * the factors are written to the world, one field at a time and merged with
   * what is stored, so opening an old trip never rewrites the world and an
   * agent's change to another factor survives.
   */
  const pending = useRef<{ pace?: TravelPace; factors: Map<string, TravelFactorEdit> }>({ factors: new Map() });
  const flushTimer = useRef(0);
  const flushSettings = () => {
    if (!worldRecord) return;
    const edits = pending.current; pending.current = { factors: new Map() };
    const change: Parameters<typeof saveWorldTravelSettings>[2] = {};
    if (edits.pace) change.pace = edits.pace === 'steady' ? null : edits.pace;
    if (edits.factors.size) change.factors = [...edits.factors.values()];
    if (!Object.keys(change).length) return;
    void saveWorldTravelSettings({ projectId: worldRecord.projectId, eraId: scope.eraId }, worldRecord.id, change)
      .then(() => setSettingsError(false))
      .catch(() => setSettingsError(true));
  };
  /** The latest flush, for the timer and for leaving the panel with an edit still on its way. */
  const flushRef = useRef(flushSettings);
  useEffect(() => { flushRef.current = flushSettings; });
  const scheduleSave = () => { window.clearTimeout(flushTimer.current); flushTimer.current = window.setTimeout(() => flushRef.current(), 450); };
  useEffect(() => () => { window.clearTimeout(flushTimer.current); flushRef.current(); }, []);
  /** Adopt the world's settings when they change elsewhere, unless a trip is open or an edit is on its way. */
  useEffect(() => {
    if (!worldRecord || openedJourney) return;
    if (pending.current.pace || pending.current.factors.size) return;
    setPace(worldRecord.travelPace ?? 'steady');
    setProfile(worldRecord.travelProfile ?? {});
  }, [worldRecord?.travelRevision, worldRecord?.id, openedJourney]); // eslint-disable-line react-hooks/exhaustive-deps
  const choosePace = (next: TravelPace) => { setPace(next); pending.current.pace = next; scheduleSave(); };
  /** Back to the built-in physics for the factors shown here; others the world has stay. */
  const resetProfile = () => {
    for (const table of ['speed', 'ground'] as const) for (const key of Object.keys(profile[table] ?? {})) pending.current.factors.set(`${table}:${key}`, { table, key, value: 1 });
    setProfile({}); scheduleSave();
  };
  const setFactor = (table: 'speed' | 'ground', key: TravelMode | GroundClass, value: number) => {
    pending.current.factors.set(`${table}:${key}`, { table, key, value });
    scheduleSave();
    setProfile(current => {
      const next = { ...(current[table] ?? {}) } as Record<string, number>;
      if (Math.abs(value - 1) < 0.001) delete next[key]; else next[key] = Math.round(value * 100) / 100;
      const out: TravelProfile = { ...current };
      if (Object.keys(next).length) (out as Record<string, unknown>)[table] = next; else delete out[table];
      return out;
    });
  };
  const savedJourneys = [...new Map([...savedLocally, ...(worldRecord?.journeys ?? [])].map(journey => [journey.id, journey])).values()]
    .filter(journey => !deletedJourneys.some(deleted => deleted.id === journey.id && JSON.stringify(deleted) === JSON.stringify(journey)));
  const currentRecipeKey = worldRecord ? journeyRecipeKey({ ...worldRecord, params: world.params }) : '';

  const saveJourney = async () => {
    if (savingRef.current || !worldRecord || !from || !to || !journeyName.trim()) return;
    savingRef.current = true; setSaving(true); setSaveError(false);
    const now = Date.now();
    const journey: WorldJourney = {
      id: crypto.randomUUID(), name: journeyName.trim(),
      stops: journeyNormalizedStops([from, ...via, to], world),
      options: planOptions, recipeKey: currentRecipeKey, createdAt: now, updatedAt: now,
    };
    try {
      await saveWorldJourney(worldRecord.id, worldRecord.projectId, journey, scope.eraId);
      setSavedLocally(current => [...current, journey]); setJourneyName(''); setOpenedJourney(journey);
      // The write has committed. A failed parent refresh must not turn a retry into a duplicate save.
      try { await onJourneysChanged?.(); } catch { /* Local committed row remains available until refresh. */ }
    } catch { setSaveError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const confirmDeleteJourney = async () => {
    if (savingRef.current || !worldRecord || !deletingJourney) return;
    savingRef.current = true; setSaving(true); setDeleteError(false);
    try {
      await deleteWorldJourney(worldRecord.id, worldRecord.projectId, deletingJourney, scope.eraId);
      setDeletedJourneys(current => [...current, deletingJourney]);
      setSavedLocally(current => current.filter(journey => journey.id !== deletingJourney.id));
      if (openedJourney?.id === deletingJourney.id) setOpenedJourney(null);
      setDeletingJourney(null);
      try { await onJourneysChanged?.(); } catch { /* The confirmed deletion remains reflected locally. */ }
    } catch { setDeleteError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const calculation = useJourneyComputation(world, geography, from, to, via, planOptions, showAll, locale);
  const { route, table } = calculation;
  const paleoCalculation = useJourneyPaleo(world, paleo, locale);

  // The map's copy of the route is a side effect of this panel's state, so it is
  // published in an effect. An effect event always sees the latest parent
  // callback without making its identity a reason to publish the route again.
  const publishRoute = useEffectEvent(onRoute);
  useEffect(() => { if (route || !calculation.hasEndpoints) publishRoute(route, MODE_COLOR[mode]); }, [route, mode, calculation.hasEndpoints]);

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      {worldRecord && (
        <section className="flex flex-col gap-2 border-b border-white/10 pb-3" aria-label={t('worldgen.journey.saved')}>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-white/50">{t('worldgen.journey.saved')}</span>
            <select aria-label={t('worldgen.journey.openSaved')} value="" disabled={saving || !onOpenJourney}
              className="rounded border border-white/20 bg-[#191d25] px-2 py-1.5 text-white/90"
              onChange={event => {
                const journey = savedJourneys.find(row => row.id === event.target.value);
                if (!journey) return;
                setMode(journey.options.mode); setSeason(journey.options.season);
                setCustomOptions({ hoursPerDay: journey.options.hoursPerDay, planetRadiusKm: journey.options.planetRadiusKm });
                // The trip's own snapshot, shown and planned with; the world is not touched.
                setPace(journey.options.pace ?? 'steady'); setLegModes(journey.options.legModes ?? []);
                setProfile(journey.options.profile ?? {});
                setOpenedJourney(journey); onPick(null); onOpenJourney?.(journey);
              }}>
              <option value="">{t('worldgen.journey.openSaved')}</option>
              {savedJourneys.map(journey => <option key={journey.id} value={journey.id}>{journey.name}</option>)}
            </select>
          </label>
          {!savedJourneys.length && <p className="text-white/45">{t('worldgen.journey.savedEmpty')}</p>}
          {openedJourney && <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-white/65">{openedJourney.name}</p>
            <button type="button" disabled={saving} className="shrink-0 rounded px-2 py-1 text-white/70 hover:bg-white/10 disabled:opacity-40" data-testid="journey-close"
              onClick={() => setOpenedJourney(null)}>{t('worldgen.journey.close')}</button>
            <button type="button" disabled={saving} className="shrink-0 rounded px-2 py-1 text-red-200/80 hover:bg-red-400/10 disabled:opacity-40"
              onClick={() => { setDeletingJourney(openedJourney); setDeleteError(false); }}>{t('worldgen.journey.delete')}</button>
          </div>}
          {openedJourney && <p className="text-[10px] leading-snug text-white/45" data-testid="journey-trip-settings">{t('worldgen.journey.tripSettings')}</p>}
          {openedJourney && openedJourney.recipeKey !== currentRecipeKey && <p role="status" className="text-amber-200/85">{t('worldgen.journey.recipeChanged')}</p>}
          {from && to && <form onSubmit={event => { event.preventDefault(); void saveJourney(); }} className="flex flex-col gap-1.5">
            <input aria-label={t('worldgen.journey.name')} placeholder={t('worldgen.journey.name')} value={journeyName} disabled={saving}
              onChange={event => setJourneyName(event.target.value)} maxLength={160}
              className="rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white/90" />
            <button type="submit" disabled={saving || !journeyName.trim()} className="rounded bg-amber-400/20 px-2 py-1.5 text-amber-100 hover:bg-amber-400/30 disabled:opacity-40">
              {t(saving ? 'worldgen.journey.saving' : 'worldgen.journey.save')}
            </button>
            {saveError && <p role="alert" className="text-red-300">{t('worldgen.journey.saveError')}</p>}
          </form>}
          <p className="text-white/40 leading-snug">{t('worldgen.journey.savedNote')}</p>
        </section>
      )}
      <ConfirmDialog open={!!deletingJourney} destructive title={t('worldgen.journey.delete')}
        message={t('worldgen.journey.deleteConfirm').replace('{name}', deletingJourney?.name ?? '') + (deleteError ? `\n\n${t('worldgen.journey.deleteError')}` : '')}
        onConfirm={confirmDeleteJourney} onCancel={() => { if (!savingRef.current) { setDeletingJourney(null); setDeleteError(false); } }} />
      {/* ---- the journey ---- */}
      {worldRecord && calculation.capture && <JourneyCreativeCapture
        world={worldRecord} route={calculation.capture.route} stops={calculation.capture.stops}
        mode={calculation.capture.mode} season={calculation.capture.season} width={world.width} height={world.height}
        sourcePending={!route || !!route.impossible}
      />}
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase tracking-wider text-white/35">{t('worldgen.journey.title')}</div>
        <EndButton
          label={t('worldgen.journey.from')} place={from} active={picking === 'from'}
          onClick={() => onPick(picking === 'from' ? null : 'from')}
        />
        <EndButton
          label={t('worldgen.journey.to')} place={to} active={picking === 'to'}
          onClick={() => onPick(picking === 'to' ? null : 'to')}
        />
        <button
          onClick={() => onPick(picking === 'via' ? null : 'via')}
          className={`flex items-center justify-between px-2 py-1.5 rounded border text-left transition ${
            picking === 'via' ? 'border-amber-400/70 bg-amber-400/10' : 'border-white/15 hover:border-white/35'
          }`}
        >
          <span className="text-[9px] uppercase tracking-wider text-white/35">{t('worldgen.journey.via')}</span>
          <span className="text-[11px] text-white/85 truncate ml-2">
            {via.length ? via.map((v) => v.name).join(' · ') : t('worldgen.journey.direct')}
          </span>
        </button>
        {picking && (
          <p className="text-[10px] text-amber-300/80">
            {t('worldgen.journey.pickHint')}
          </p>
        )}
        <div className="flex gap-1">
          <button onClick={onSwap} disabled={!from || !to}
            className="flex-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-[10px] disabled:opacity-30">
            {t('worldgen.journey.swap')}
          </button>
          <button onClick={onClearVia} disabled={!via.length}
            className="flex-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-[10px] disabled:opacity-30">
            {t('worldgen.journey.clearVia')}
          </button>
          <button onClick={onClear} disabled={!from && !to}
            className="flex-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-[10px] disabled:opacity-30">
            {t('worldgen.journey.clear')}
          </button>
        </div>
      </div>

      {from && to && (
        <>
          <div className="flex flex-wrap gap-1">
            {MODES.map((m) => (
              <Chip key={m} on={mode === m} onClick={() => setMode(m)}>{t(MODE_KEY[m])}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {SEASONS.map((s) => (
              <Chip key={s} on={season === s} onClick={() => setSeason(s)}>{t(SEASON_KEY[s])}</Chip>
            ))}
          </div>
          <div className="flex flex-col gap-1" role="group" aria-label={t('worldgen.journey.pace')}>
            <span className="text-[9px] uppercase tracking-wider text-white/35">{t('worldgen.journey.pace')}</span>
            <div className="flex flex-wrap gap-1">
              {TRAVEL_PACES.map((p) => (
                <Chip key={p} on={pace === p} onClick={() => choosePace(p)}>{t(`worldgen.journey.pace.${p}`)}</Chip>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-white/40">{t(`worldgen.journey.pace.${pace}.hint`)}</p>
          </div>
          {via.length > 0 && (
            <div className="flex flex-col gap-1" aria-label={t('worldgen.journey.legs')}>
              <span className="text-[9px] uppercase tracking-wider text-white/35">{t('worldgen.journey.legs')}</span>
              {Array.from({ length: legCount }, (_, index) => {
                const stops = [from!, ...via, to!];
                return (
                  <label key={index} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-white/60">{stops[index].name} → {stops[index + 1].name}</span>
                    <select aria-label={t('worldgen.journey.legMode').replace('{n}', String(index + 1))} value={activeLegModes[index] || mode}
                      onChange={(event) => setLegModes(current => { const next = Array.from({ length: legCount }, (_, k) => current[k] ?? ''); next[index] = event.target.value as TravelMode; return next; })}
                      className="rounded border border-white/20 bg-[#191d25] px-1.5 py-0.5 text-white/90">
                      {MODES.map((m) => <option key={m} value={m}>{t(MODE_KEY[m])}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
          <button type="button" onClick={() => setSettingsOpen(open => !open)} aria-expanded={settingsOpen}
            className="text-left text-[10px] text-amber-300/80 hover:text-amber-300">
            {t('worldgen.journey.settings')}{settingsOpen ? ' ▴' : ' ▾'}
          </button>
          {settingsOpen && (
            <div className="flex flex-col gap-2 rounded border border-white/10 p-2" data-testid="journey-travel-settings">
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/60">{t('worldgen.journey.hoursPerDay')}</span>
                <input type="number" min={1} max={20} step={0.5} aria-label={t('worldgen.journey.hoursPerDay')}
                  value={customOptions.hoursPerDay ?? HPD[season]}
                  onChange={(event) => { const value = Number(event.target.value); setCustomOptions(current => ({ ...current, hoursPerDay: Number.isFinite(value) && value > 0 && value <= 24 && value !== HPD[season] ? value : undefined })); }}
                  className="w-16 rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-right text-white/90" />
              </label>
              <span className="text-[9px] uppercase tracking-wider text-white/35">{t('worldgen.journey.speeds')}</span>
              {MODES.map((m) => (
                <Factor key={m} label={t(MODE_KEY[m])} value={profile.speed?.[m] ?? 1} onChange={(value) => setFactor('speed', m, value)} />
              ))}
              <span className="text-[9px] uppercase tracking-wider text-white/35">{t('worldgen.journey.ground')}</span>
              {GROUND_CLASSES.map((g) => (
                <Factor key={g} label={t(`worldgen.journey.ground.${g}`)} value={profile.ground?.[g] ?? 1} onChange={(value) => setFactor('ground', g, value)} />
              ))}
              <p className="text-[10px] leading-snug text-white/40">{t('worldgen.journey.settingsNote')}</p>
              {(profile.speed || profile.ground) && <button type="button" onClick={resetProfile} className="self-start text-[10px] text-white/55 underline">{t('worldgen.journey.settingsReset')}</button>}
              {settingsError && <p role="alert" className="text-red-300">{t('worldgen.journey.settingsError')}</p>}
            </div>
          )}

          {calculation.busy && <p role="status" className="text-amber-200/75">{route && showAll
            ? t('worldgen.journey.comparing').replace('{n}', String(calculation.completed))
            : t('worldgen.journey.calculating')}</p>}
          {calculation.error && <p role="alert" className="text-red-300">{t('worldgen.journey.calculationError')}{' '}
            <button onClick={calculation.retry} className="underline">{t('common.retry')}</button></p>}
          {route?.impossible ? (
            <p className="text-[11px] text-red-300/85 leading-snug">{route.impossible}</p>
          ) : route ? (
            <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
              <div className="text-lg text-white/90 leading-none">
                {/* The whole journey, rest days included, so a hard pace never reads faster than it is. */}
                {describeDuration(route.hours + (route.restDays ?? 0) * hoursPerDay, hoursPerDay, t)}
              </div>
              {(route.restDays ?? 0) > 0 && (
                <div className="text-[10px] text-amber-200/80" data-testid="journey-rest-days">
                  {t('worldgen.journey.restDays').replace('{n}', String(route.restDays))}
                </div>
              )}
              <div className="text-[10px] text-white/50">
                {t('worldgen.journey.byRoad').replace('{n}', Math.round(route.km).toLocaleString('es-ES'))} ·
                {' '}{t('worldgen.journey.straightLine').replace('{n}', Math.round(route.directKm).toLocaleString('es-ES'))} ·
                {' '}{t('worldgen.journey.roadShare').replace('{n}', String(Math.round(route.roadFraction * 100)))}
              </div>
              <div className="text-[10px] text-white/50">
                {t('worldgen.journey.perDay').replace('{n}', (route.hours > 0 ? route.km / (route.hours / hoursPerDay) : 0).toFixed(0))}
                {route.crossings.length > 0 && ` · ${t('worldgen.journey.riverCrossings').replace('{n}', String(route.crossings.length))}`}
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                {route.legs.slice(0, 6).map((l, i) => (
                  <div key={i} className="flex justify-between text-[10px] text-white/45">
                    <span>{l.terrain}</span>
                    <span className="tabular-nums">{Math.round(l.km)} km</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-white/45 leading-snug mt-1">
                {Math.round(route.lowestM)} – {Math.round(route.highestM)} m ·
                {' '}{t('worldgen.journey.ascent').replace('{n}', (route.ascentM / 1000).toFixed(1))}
              </div>
              {route.realms.length > 0 && (
                <div className="text-[10px] text-white/45 leading-snug">
                  {route.realms.length === 1 ? t('worldgen.journey.allWithin') : t('worldgen.journey.crosses')}
                  {route.realms.join(' → ')}
                </div>
              )}
              <JourneyPlayback route={route} worldWidth={world.width}
                fromName={from?.name ?? openedJourney?.stops[0]?.name ?? ''}
                toName={to?.name ?? openedJourney?.stops.at(-1)?.name ?? ''}
                onTraveller={(traveller) => onTraveller?.(traveller)} />
              {route.stages.length > 0 && (
                <>
                  <button
                    onClick={() => setShowStages((v) => !v)}
                    className="text-left text-[10px] text-amber-300/80 hover:text-amber-300 mt-1"
                  >
                    {t('worldgen.journey.nights').replace('{n}', String(route.stages.length))} ·
                    {' '}{t('worldgen.journey.roughNights').replace('{n}', String(route.stages.filter((x) => x.rough).length))}
                    {showStages ? ' ▴' : ' ▾'}
                  </button>
                  {showStages && (
                    <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto pr-1">
                      {route.stages.map((st) => (
                        <div key={st.night} className="text-[10px] leading-snug">
                          <span className="text-white/35 tabular-nums">{st.night}.</span>{' '}
                          <span className={st.rough ? 'text-amber-200/70' : 'text-white/65'}>
                            {st.rough ? t('worldgen.journey.roughIn') : t('worldgen.journey.stayIn')}{st.terrain}
                          </span>
                          {st.nearest && st.nearest.km < 60 && (
                            <span className="text-white/35">
                              {' '}· {t('worldgen.journey.nearest')
                                .replace('{name}', st.nearest.name)
                                .replace('{km}', String(Math.round(st.nearest.km)))}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          <button
            onClick={() => setShowAll((v) => !v)}
            className="px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-[10px]"
          >
            {showAll ? t('worldgen.journey.hideTable') : t('worldgen.journey.compareAll')}
          </button>

          {table && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[9px] tabular-nums">
                <thead>
                  <tr className="text-white/35">
                    <th className="text-left font-normal px-1"> </th>
                    {SEASONS.map((s) => (
                      <th key={s} className="font-normal px-1">{t(`${SEASON_KEY[s]}.abbr`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.mode} className="border-t border-white/5">
                      <td className="px-1 text-white/60 whitespace-nowrap">{t(MODE_KEY[row.mode])}</td>
                      {row.seasons.map((r, i) => (
                        <td key={i} className="px-1 text-center text-white/75">
                          {/* Forma compacta por clave («9j» / “9d”), no cirugía
                              de cadenas sobre la frase larga: aquel
                              .replace(' jornadas','j') sólo funcionaba en
                              español. */}
                          {r.impossible ? '—'
                            : r.hours < (customOptions.hoursPerDay ?? HPD[SEASONS[i]])
                              ? describeDuration(r.hours, customOptions.hoursPerDay ?? HPD[SEASONS[i]], t)
                              : t('worldgen.travel.dur.daysShort')
                                .replace('{n}', String(Math.floor(r.hours / (customOptions.hoursPerDay ?? HPD[SEASONS[i]]))))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---- time depth ---- */}
      <div className="border-t border-white/10 pt-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-white/35">{t('worldgen.journey.timeDepth')}</span>
          <button
            onClick={() => onPaleo(paleo ? null : { seaLevelM: -125, ice: 1 })}
            className={`px-2 py-0.5 rounded text-[9px] ${paleo ? 'bg-accent-gold/25 text-white/90' : 'bg-white/8 hover:bg-white/15'}`}
          >
            {paleo ? t('worldgen.journey.paleoOn') : t('worldgen.journey.paleoOff')}
          </button>
        </div>
        <p className="text-[10px] text-white/40 leading-snug">
          {t('worldgen.journey.paleoNote')}
        </p>
        {paleo && (
          <>
            <Slider
              label={t('worldgen.journey.ice')}
              value={paleo.ice} min={0} max={1} step={0.05}
              format={(v) => (v <= 0 ? t('worldgen.journey.iceToday') : t('worldgen.journey.icePercent').replace('{n}', String(Math.round(v * 100))))}
              onChange={(v) => onPaleo({ ice: v, seaLevelM: seaLevelForIce(v) })}
            />
            <Slider
              label={t('worldgen.journey.seaLevel')}
              value={paleo.seaLevelM} min={-140} max={80} step={5}
              format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v)} m`}
              onChange={(v) => onPaleo({ ...paleo, seaLevelM: v })}
            />
            <div className="flex gap-1">
              <button onClick={() => onPaleo({ seaLevelM: -125, ice: 1 })}
                className="flex-1 px-1.5 py-1 rounded bg-white/8 hover:bg-white/15 text-[9px]">
                {t('worldgen.journey.glacialMax')}
              </button>
              <button onClick={() => onPaleo({ seaLevelM: 70, ice: 0 })}
                className="flex-1 px-1.5 py-1 rounded bg-white/8 hover:bg-white/15 text-[9px]">
                {t('worldgen.journey.noIce')}
              </button>
            </div>
            {paleoCalculation.busy && <p role="status" className="text-white/50">{t('worldgen.journey.calculating')}</p>}
            {paleoCalculation.error && <p role="alert" className="text-red-300">{t('worldgen.journey.calculationError')}{' '}
              <button onClick={paleoCalculation.retry} className="underline">{t('common.retry')}</button></p>}
            {paleoCalculation.description && <p className="text-[10px] text-white/55 leading-snug">{paleoCalculation.description}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function EndButton({ label, place, active, onClick }: {
  label: string; place: Settlement | null; active: boolean; onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between px-2 py-1.5 rounded border text-left transition ${
        active ? 'border-amber-400/70 bg-amber-400/10' : 'border-white/15 hover:border-white/35'
      }`}
    >
      <span className="text-[9px] uppercase tracking-wider text-white/35">{label}</span>
      <span className="text-[11px] text-white/85 truncate ml-2">
        {place ? place.name : t('worldgen.journey.choose')}
      </span>
    </button>
  );
}

/** A travel factor as a percentage slider: 100% is the built-in value. */
function Factor({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[1fr_5rem_2.75rem] items-center gap-2">
      <span className="truncate text-white/60">{label}</span>
      <input type="range" min={25} max={400} step={5} value={Math.round(value * 100)} aria-label={label}
        onChange={(event) => onChange(Number(event.target.value) / 100)} className="accent-amber-400" />
      <span className="text-right tabular-nums text-white/70">{Math.round(value * 100)}%</span>
    </label>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded-sm border text-[9px] transition ${
        on ? 'border-amber-400/70 text-white/90 bg-amber-400/10' : 'border-white/20 text-white/55 hover:border-white/45'
      }`}
    >
      {children}
    </button>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/70">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
    </label>
  );
}
