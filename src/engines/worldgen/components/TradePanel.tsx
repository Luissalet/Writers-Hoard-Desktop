import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GOODS, SITE_KINDS, SITE_SIZES, STAPLES, goodsSummary, portTrade, type EconomyPlace, type EconomySnapshot, type Good, type SiteKind, type SiteSize, type TradeSite } from '../core/economy';
import { SITE_COLORS } from '../cartography/tradeMarks';

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/**
 * The trade lens: month by month, who is fed and who will go short, what goods
 * cost against the usual, what is on the move, and where goods are made.
 */
export default function TradePanel({ places, sites, snapshots, month, onMonth, placing, onPlacing, onRemoveSite, onFocus, removedSites = [], onRestoreSite }: {
  places: EconomyPlace[];
  sites: TradeSite[];
  snapshots: EconomySnapshot[];
  month: number;
  onMonth: (month: number) => void;
  placing: { kind: SiteKind; size: SiteSize } | null;
  onPlacing: (placing: { kind: SiteKind; size: SiteSize } | null) => void;
  onRemoveSite: (id: string) => void;
  onFocus: (x: number, y: number) => void;
  /** Ids of generated sites switched off, and a way to switch one back on. */
  removedSites?: string[];
  onRestoreSite?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'places' | 'goods' | 'sites'>('places');
  const [playing, setPlaying] = useState(false);
  const [kind, setKind] = useState<SiteKind>('mine');
  const [size, setSize] = useState<SiteSize>('M');
  const [placeId, setPlaceId] = useState<number | null>(null);
  const last = Math.max(0, snapshots.length - 1);
  const snap = snapshots[Math.min(month, last)];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      // Stops at the last month rather than looping: the clock is a story's, not a screensaver's.
      if (month >= last) { setPlaying(false); return; }
      onMonth(month + 1);
    }, 700);
    return () => window.clearInterval(timer);
  }, [playing, month, last, onMonth]);
  const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const goods = useMemo(() => (snap ? goodsSummary(snap, sites) : []), [snap, sites]);
  const ranked = useMemo(() => {
    if (!snap) return [];
    const soonest = (p: EconomySnapshot['places'][number]) => Math.min(24, ...STAPLES.map((g) => p.shortIn[g] ?? 24));
    return [...snap.places].sort((a, b) => Number(a.fed) - Number(b.fed) || soonest(a) - soonest(b) || (byId.get(b.id)?.population ?? 0) - (byId.get(a.id)?.population ?? 0));
  }, [snap, byId]);
  if (!snap) return <p className="text-[11px] text-white/45">{t('worldgen.trade.noPlaces')}</p>;
  const goodName = (good: Good) => t(`worldgen.trade.good.${good}`);
  const shownSites = placeId === null ? sites.filter((site) => !site.auto) : sites.filter((site) => site.placeId === placeId);
  return (
    <div className="flex flex-col gap-2 text-[11px] text-white/80" data-testid="trade-panel">
      <div className="flex items-center gap-1.5">
        <button type="button" data-testid="trade-play" onClick={() => { if (month >= last) onMonth(0); setPlaying((p) => !p); }}
          className="rounded bg-amber-400/85 px-2 py-0.5 text-[11px] font-medium text-black">{playing ? t('worldgen.trade.pause') : t('worldgen.trade.play')}</button>
        <button type="button" data-testid="trade-next" disabled={month >= last} onClick={() => { setPlaying(false); onMonth(Math.min(last, month + 1)); }}
          className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20 disabled:opacity-40">{t('worldgen.trade.next')}</button>
        <button type="button" onClick={() => { setPlaying(false); onMonth(0); }} className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20">{t('worldgen.trade.reset')}</button>
        <span className="ml-auto text-[10px] text-white/55" data-testid="trade-caption">
          {t('worldgen.trade.month').replace('{n}', String(month + 1))} · {t('worldgen.trade.onTheMove').replace('{n}', String(snap.onTheMove))}
        </span>
      </div>
      <input type="range" min={0} max={last} step={1} value={month} data-testid="trade-month"
        onChange={(e) => { setPlaying(false); onMonth(Number(e.target.value)); }} className="w-full accent-amber-400" />
      <div className="grid grid-cols-3 gap-1">
        {(['places', 'goods', 'sites'] as const).map((v) => (
          <button key={v} type="button" data-testid={`trade-view-${v}`} onClick={() => setView(v)}
            className={`rounded px-1.5 py-1 ${view === v ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'}`}>{t(`worldgen.trade.view.${v}`)}</button>
        ))}
      </div>
      {view === 'places' && placeId !== null && byId.get(placeId) && (() => {
        // The chosen place's sea trade: what it has landed and shipped so far, and with whom.
        const place = byId.get(placeId)!;
        const sea = portTrade(snapshots, place, month);
        const list = (goods: Partial<Record<Good, number>>) => (Object.entries(goods) as [Good, number][]).filter(([, n]) => n >= 0.05).sort((a, b) => b[1] - a[1]).map(([good, n]) => `${goodName(good)} ${fmt(n)}`).join(' · ');
        return (
          <div className="rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[10px] text-white/65" data-testid="trade-port">
            <div className="mb-0.5 flex items-center gap-1 font-medium text-white/85">{place.name} · {sea.port ? t('worldgen.trade.port.is') : t('worldgen.trade.port.none')}
              <button type="button" onClick={() => setPlaceId(null)} className="ml-auto underline text-white/50">{t('worldgen.trade.port.close')}</button></div>
            {sea.port && (
              <>
                <div data-testid="trade-port-landed">{t('worldgen.trade.port.landed')}: {list(sea.landed) || t('worldgen.trade.port.nothing')}</div>
                <div data-testid="trade-port-shipped">{t('worldgen.trade.port.shipped')}: {list(sea.shipped) || t('worldgen.trade.port.nothing')}</div>
                {sea.partners.length > 0 && <div>{t('worldgen.trade.port.partners')}: {sea.partners.slice(0, 5).map((p) => byId.get(p.id)?.name ?? String(p.id)).join(', ')}</div>}
              </>
            )}
          </div>
        );
      })()}
      {view === 'places' && (
        <div className="flex flex-col gap-1" data-testid="trade-places">
          <span className="text-[10px] text-white/45">{t('worldgen.trade.fedCount').replace('{fed}', String(snap.places.filter((p) => p.fed).length)).replace('{n}', String(snap.places.length))}</span>
          {ranked.slice(0, 60).map((p) => {
            const place = byId.get(p.id);
            // Running out is told for the staples; the rest show as dear.
            const short = (Object.entries(p.shortIn) as [Good, number][]).filter(([good]) => STAPLES.includes(good)).sort((a, b) => a[1] - b[1]).slice(0, 2);
            const dear = GOODS.filter((good) => p.price[good] >= 1.5).slice(0, 2);
            return (
              <button key={p.id} type="button" data-testid={`trade-place-${p.id}`}
                onClick={() => { setPlaceId(p.id); if (place) onFocus(place.x + 0.5, place.y + 0.5); }}
                className={`flex flex-col items-start rounded px-1.5 py-1 text-left ${placeId === p.id ? 'bg-amber-400/15' : 'hover:bg-white/10'}`}>
                <span className="flex w-full items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${p.fed ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-white/45">{place ? place.population.toLocaleString() : ''}</span>
                </span>
                {(short.length > 0 || dear.length > 0 || !p.fed) && (
                  <span className="text-[10px] text-white/55">
                    {!p.fed && <span className="text-red-300">{t('worldgen.trade.hungry')} · </span>}
                    {p.fed && Object.keys(p.eatenInstead).length > 0 && <span className="text-amber-200">{t('worldgen.trade.eatsInstead').replace('{goods}', (Object.keys(p.eatenInstead) as Good[]).map(goodName).join(', '))} · </span>}
                    {short.map(([good, months]) => (months < 1 ? t('worldgen.trade.outOf').replace('{good}', goodName(good)) : t('worldgen.trade.shortIn').replace('{good}', goodName(good)).replace('{n}', fmt(months)))).join(' · ')}
                    {short.length > 0 && dear.length > 0 ? ' · ' : ''}
                    {dear.map((good) => t('worldgen.trade.dear').replace('{good}', goodName(good)).replace('{x}', fmt(p.price[good]))).join(' · ')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {view === 'goods' && (
        <div className="flex flex-col gap-1" data-testid="trade-goods">
          {goods.map((g) => (
            <div key={g.good} className="rounded bg-white/[0.05] px-2 py-1" data-testid={`trade-good-${g.good}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{goodName(g.good)}</span>
                <span className="ml-auto text-[10px] text-white/55">{t('worldgen.trade.priceRange').replace('{min}', fmt(g.priceMin)).replace('{max}', fmt(g.priceMax))}</span>
              </div>
              <div className="text-[10px] text-white/50">
                {g.missing
                  ? <span className="text-amber-200">{t('worldgen.trade.missing').replace('{site}', g.hint ? t(`worldgen.trade.site.${g.hint}`) : '')}</span>
                  : t('worldgen.trade.madeIn').replace('{n}', String(g.madeIn))}
              </div>
            </div>
          ))}
        </div>
      )}
      {view === 'sites' && (
        <div className="flex flex-col gap-1.5" data-testid="trade-sites">
          <div className="grid grid-cols-4 gap-1">
            {SITE_KINDS.map((k) => (
              <button key={k} type="button" data-testid={`trade-kind-${k}`} onClick={() => setKind(k)}
                className={`flex items-center gap-1 rounded px-1 py-1 text-[10px] ${kind === k ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'}`}>
                <span className="inline-block h-2 w-2 rotate-45" style={{ background: SITE_COLORS[k] }} />{t(`worldgen.trade.site.${k}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {SITE_SIZES.map((s) => (
              <button key={s} type="button" data-testid={`trade-size-${s}`} onClick={() => setSize(s)}
                className={`rounded px-2 py-0.5 text-[10px] ${size === s ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'}`}>{s}</button>
            ))}
            <button type="button" data-testid="trade-place-site" onClick={() => onPlacing(placing ? null : { kind, size })}
              className={`ml-auto rounded px-2 py-0.5 text-[10px] ${placing ? 'bg-amber-300 text-black' : 'bg-white/10 hover:bg-white/20'}`}>
              {placing ? t('worldgen.trade.placing') : t('worldgen.trade.placeOnMap')}
            </button>
          </div>
          <span className="text-[10px] text-white/45">
            {placeId === null
              ? t('worldgen.trade.yourSites').replace('{n}', String(shownSites.length)).replace('{auto}', String(sites.filter((site) => site.auto).length))
              : t('worldgen.trade.sitesOf').replace('{place}', byId.get(placeId)?.name ?? '')}
            {placeId !== null && <button type="button" onClick={() => setPlaceId(null)} className="ml-1 underline">{t('worldgen.trade.showYours')}</button>}
          </span>
          {placeId !== null && (() => {
            const place = byId.get(placeId);
            const prefix = place ? `auto:${Math.floor(place.x)},${Math.floor(place.y)}:` : null;
            const off = prefix ? removedSites.filter((id) => id.startsWith(prefix)) : [];
            return off.length > 0 && (
              <div className="rounded bg-white/[0.04] px-1.5 py-1 text-[10px] text-white/55" data-testid="trade-removed">
                {t('worldgen.trade.switchedOff').replace('{n}', String(off.length))}
                {off.map((id) => (
                  <button key={id} type="button" data-testid={`trade-restore-${id}`} onClick={() => onRestoreSite?.(id)} className="ml-2 underline">
                    {t(`worldgen.trade.site.${id.split(':')[2]}`)} · {t('worldgen.trade.restore')}
                  </button>
                ))}
              </div>
            );
          })()}
          {shownSites.map((site) => (
            <div key={site.id} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-white/10" data-testid={`trade-site-${site.id}`}>
              <span className="inline-block h-2 w-2 rotate-45" style={{ background: SITE_COLORS[site.kind] }} />
              <button type="button" className="truncate text-left" onClick={() => onFocus(site.x + 0.5, site.y + 0.5)}>
                {t(`worldgen.trade.site.${site.kind}`)} {site.size} · {site.placeId !== null ? byId.get(site.placeId)?.name ?? '' : ''}{site.auto ? '' : ` · ${t('worldgen.trade.yours')}`}
              </button>
              <button type="button" data-testid={`trade-remove-${site.id}`} onClick={() => onRemoveSite(site.id)} className="ml-auto text-[10px] text-red-300 hover:text-red-200">{t('worldgen.trade.remove')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
