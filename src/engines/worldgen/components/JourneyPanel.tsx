import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import {
  planRoute, describeDuration, MODE_ES, SEASON_ES,
  type Route, type Season, type TravelMode,
} from '../core/travel';
import { paleoMap, describePaleo, seaLevelForIce, type PaleoMap, type PaleoState } from '../core/paleo';
import { useTranslation } from '@/i18n/useTranslation';

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
  paleo: PaleoState | null;
  onPaleo: (state: PaleoState | null) => void;
}

const MODES: TravelMode[] = ['foot', 'horse', 'cart', 'boat', 'ship'];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const HPD: Record<Season, number> = { spring: 10, summer: 11, autumn: 9, winter: 7 };
const MODE_COLOR: Record<TravelMode, string> = {
  foot: '#a3261e', horse: '#1b5e20', cart: '#0d47a1', boat: '#00695c', ship: '#4527a0',
};

export default function JourneyPanel({
  world, geography, from, to, picking, onPick, onSwap, onClear, onRoute,
  via, onClearVia, paleo, onPaleo,
}: JourneyPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TravelMode>('foot');
  const [season, setSeason] = useState<Season>('summer');
  const [showAll, setShowAll] = useState(false);
  const [showStages, setShowStages] = useState(false);

  const route = useMemo(() => {
    if (!from || !to) return null;
    return planRoute(world, geography, from, to, {
      mode, season, via: via.length ? via.map((v) => ({ x: v.x, y: v.y })) : undefined,
    });
  }, [world, geography, from, to, mode, season, via]);

  // The comparison table is the point of the feature, but it costs one A* per
  // cell, so it only runs when the reader asks to see it.
  const table = useMemo(() => {
    if (!from || !to || !showAll) return null;
    return MODES.map((m) => ({
      mode: m,
      seasons: SEASONS.map((s) => planRoute(world, geography, from, to, {
        mode: m, season: s, via: via.length ? via.map((v) => ({ x: v.x, y: v.y })) : undefined,
      })),
    }));
  }, [world, geography, from, to, showAll, via]);

  const paleoResult: PaleoMap | null = useMemo(
    () => (paleo ? paleoMap(world, paleo) : null),
    [world, paleo],
  );

  // The map's copy of the route is a side effect of this panel's state, so it is
  // published in an effect. An effect event always sees the latest parent
  // callback without making its identity a reason to publish the route again.
  const publishRoute = useEffectEvent(onRoute);
  useEffect(() => { publishRoute(route, MODE_COLOR[mode]); }, [route, mode]);

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      {/* ---- the journey ---- */}
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
              <Chip key={m} on={mode === m} onClick={() => setMode(m)}>{MODE_ES[m]}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {SEASONS.map((s) => (
              <Chip key={s} on={season === s} onClick={() => setSeason(s)}>{SEASON_ES[s]}</Chip>
            ))}
          </div>

          {route?.impossible ? (
            <p className="text-[11px] text-red-300/85 leading-snug">{route.impossible}</p>
          ) : route ? (
            <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
              <div className="text-lg text-white/90 leading-none">
                {describeDuration(route.hours, HPD[season])}
              </div>
              <div className="text-[10px] text-white/50">
                {t('worldgen.journey.byRoad').replace('{n}', Math.round(route.km).toLocaleString('es-ES'))} ·
                {' '}{t('worldgen.journey.straightLine').replace('{n}', Math.round(route.directKm).toLocaleString('es-ES'))} ·
                {' '}{t('worldgen.journey.roadShare').replace('{n}', String(Math.round(route.roadFraction * 100)))}
              </div>
              <div className="text-[10px] text-white/50">
                {t('worldgen.journey.perDay').replace('{n}', (route.km / (route.hours / HPD[season])).toFixed(0))}
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
                      <th key={s} className="font-normal px-1">{SEASON_ES[s].slice(0, 4)}.</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.mode} className="border-t border-white/5">
                      <td className="px-1 text-white/60 whitespace-nowrap">{MODE_ES[row.mode]}</td>
                      {row.seasons.map((r, i) => (
                        <td key={i} className="px-1 text-center text-white/75">
                          {r.impossible ? '—' : describeDuration(r.hours, HPD[SEASONS[i]])
                            .replace(' jornadas', 'j').replace(' jornada', 'j').replace(/ y \d+ h/, '')}
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
            {paleoResult && (
              <p className="text-[10px] text-white/55 leading-snug">
                {describePaleo(world, paleoResult)}
              </p>
            )}
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
