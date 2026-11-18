import { useTranslation } from '@/i18n/useTranslation';
import { BIOME_KEY } from '../core/biomeKeys';
import type { WorldPresenceCard } from '../placeCards';
import { weatherCopy } from '../weatherCopy';
import WorldWeather from './WorldWeather';

export default function WorldPresence({ card, title }: { card: WorldPresenceCard; title?: string }) {
  const { t, locale } = useTranslation(), copy = weatherCopy(locale);
  return <section aria-label={copy.title} className="space-y-5 text-xs leading-relaxed text-text-secondary" data-testid="world-presence">
    <h2 className="text-base font-semibold text-text-primary">{title ? `${copy.title} · ${title}` : copy.title}</h2>
    <div><h3 className="mb-1 font-semibold text-text-primary">{copy.ground}</h3><p>{copy[card.relief]} · {card.elevationM} m · {t(`worldgen.biome.${BIOME_KEY[card.biome] ?? 'ocean'}`)}</p><p>{copy[card.geology]}</p></div>
    <dl className="space-y-3"><div><dt className="font-semibold text-text-primary">{copy.materials}</dt><dd>{card.materials.map(p => copy[p]).join(', ') || copy.noResources}</dd></div>
      <div><dt className="font-semibold text-text-primary">{copy.diet}</dt><dd>{card.diet.map(p => copy[p]).join(', ') || copy.noResources}</dd></div>
      <div><dt className="font-semibold text-text-primary">{copy.language}</dt><dd>{card.language ? <>{card.language.name} · {card.language.source}<p>{[...card.language.ancestry, card.language.name].join(' → ')}</p></> : copy.unknown}</dd></div>
      <div><dt className="font-semibold text-text-primary">{copy.trade}</dt><dd>{card.trade ? <><p>{card.trade.market}</p><ul>{card.trade.goods.map(row => <li key={row.good}>{copy[row.good]} · {copy.price}: {row.price.toFixed(2)}{row.production > 0 ? ` · ${copy.produces}: ${Math.round(row.production)}` : ''}</li>)}</ul></> : copy.noMarket}</dd></div>
    </dl>
    <div><h3 className="mb-1 font-semibold text-text-primary">{copy.nearby}</h3>{card.nearby.length ? <ul>{card.nearby.map((p, index) => <li key={index}>{p.name} · {copy[p.kind]} · {p.km} km</li>)}</ul> : <p>{copy.noneNearby}</p>}</div>
    {card.weather && <WorldWeather weather={card.weather} />}
    <p>{copy.inference}</p>{card.weather && <p>{copy.weatherModel}</p>}
  </section>;
}
