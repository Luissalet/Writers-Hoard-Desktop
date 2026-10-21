import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Route } from '../core/travel';
import { travelAnchors, travellerAt, type TravellerState } from '../core/journeyPlayback';

const SPEEDS = [0.5, 1, 2, 4] as const;

/**
 * Play a planned journey day by day: a banner moves along the route, stopping
 * for each night where the planner put it, with what the party is doing. The
 * map draws the banner; this panel holds the clock.
 */
export default function JourneyPlayback({ route, worldWidth, fromName, toName, onTraveller }: {
  route: Route; worldWidth: number; fromName: string; toName: string;
  onTraveller: (traveller: { x: number; y: number; label: string; resting: boolean } | null) => void;
}) {
  const { t } = useTranslation();
  const anchors = useMemo(() => travelAnchors(route, worldWidth), [route, worldWidth]);
  const [day, setDay] = useState(0);
  const dayRef = useRef(0);
  useEffect(() => { dayRef.current = day; }, [day]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [active, setActive] = useState(false);
  const state = active ? travellerAt(route, worldWidth, day, anchors) : null;
  const caption = (s: TravellerState): string => {
    const dayN = String(Math.max(1, Math.ceil(s.day)));
    if (s.phase === 'start') return t('worldgen.journey.play.start').replace('{place}', fromName);
    if (s.phase === 'arrived') return t('worldgen.journey.play.arrived').replace('{place}', toName).replace('{n}', String(Math.ceil(route.days)));
    if (s.phase === 'rest') return t('worldgen.journey.play.rest').replace('{n}', dayN);
    if (s.phase === 'night' && s.stage) {
      const near = s.stage.nearest && s.stage.nearest.km < 60 ? s.stage.nearest.name : '';
      return (s.stage.rough || !near ? t('worldgen.journey.play.camp').replace('{terrain}', s.stage.terrain) : t('worldgen.journey.play.shelter').replace('{place}', near)).replace('{n}', String(s.stage.night));
    }
    return t('worldgen.journey.play.travel').replace('{n}', dayN).replace('{place}', toName);
  };
  const label = state ? caption(state) : '';
  // The map's banner follows the clock.
  const publish = useRef(onTraveller);
  useEffect(() => { publish.current = onTraveller; });
  useEffect(() => {
    publish.current(state ? { x: state.x, y: state.y, label, resting: state.phase === 'rest' || state.phase === 'night' } : null);
  }, [state?.x, state?.y, label, state?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => publish.current(null), []);
  // Leaving a route behind clears its clock.
  const [seenRoute, setSeenRoute] = useState(route);
  if (seenRoute !== route) { setSeenRoute(route); setDay(0); setPlaying(false); setActive(false); }
  useEffect(() => {
    if (!playing) return;
    let frame = 0, last = performance.now(), current = dayRef.current;
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      current = Math.min(route.days, current + dt * speed);
      setDay(current);
      if (current >= route.days) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, route.days]);
  if (route.impossible || route.cells.length < 2) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded border border-white/10 bg-black/20 p-2" data-testid="journey-playback">
      <div className="flex items-center gap-2">
        <button type="button" data-testid="journey-play" aria-pressed={playing}
          onClick={() => { setActive(true); if (day >= route.days - 1e-6) setDay(0); setPlaying((p) => !p); }}
          className="rounded bg-amber-400/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-400/30">
          {playing ? t('worldgen.journey.play.pause') : t('worldgen.journey.play.play')}
        </button>
        <select aria-label={t('worldgen.journey.play.speed')} value={speed} onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])}
          className="rounded border border-white/15 bg-[#191d25] px-1 py-0.5 text-[10px] text-white/80">
          {SPEEDS.map((s) => <option key={s} value={s}>{t('worldgen.journey.play.perSecond').replace('{n}', String(s))}</option>)}
        </select>
        {active && <button type="button" onClick={() => { setPlaying(false); setActive(false); setDay(0); }} className="ml-auto text-[10px] text-white/55 underline">{t('worldgen.journey.play.stop')}</button>}
      </div>
      <input type="range" min={0} max={route.days} step={0.05} value={day} aria-label={t('worldgen.journey.play.day')} data-testid="journey-play-day"
        onChange={(event) => { const v = Number(event.target.value); setActive(true); setPlaying(false); setDay(v >= route.days - 0.05 ? route.days : v); }} className="w-full accent-amber-400" />
      <p className="text-[10px] text-amber-100/85 min-h-[1.2em]" role="status" data-testid="journey-play-caption">{label}</p>
    </div>
  );
}
