import { daysInYear, toDayNumber, type WorldCalendar, type WorldDate } from '@/engines/timeline/worldCalendar';
import type { ReadableWorld } from '../bridgeAccess';
import type { WorldEdit } from '../core/edits';
import { placesFromSettlements, simulateEconomy, tradeSitesFrom } from '../core/economy';
import { coinName, cognates } from '../core/language';
import { cultureMap, generateName, type CultureId, type FeatureKind } from '../core/naming';
import { FOG_HEARD, FOG_HIDDEN, FOG_SEEN, fogMask, fogShares, fogStrokeEdits } from '../core/readerFog';
import { DEFAULT_HUMAN_PARAMS, settlementCellCenter, type Settlement } from '../core/settlements';
import { findRoute, isOpenSea, simplifyRoute, type RoutePoint } from '../core/tradeRoutes';
import type { WorldData } from '../core/types';
import type { CartographerOrigin, InWorldMap } from './types';

interface Origin {
  key: CartographerOrigin;
  name: string;
  placeName: string;
  at: RoutePoint;
  culture: CultureId;
  placeKey: string;
}

interface Route {
  sea: boolean;
  points: RoutePoint[];
}

const mod = (x: number, width: number) => ((x % width) + width) % width;

export function settlementKey(place: Settlement): string {
  return place.sourceKey ?? ('settlement:' + place.x + ',' + place.y);
}

export function mapOrigins({ data, geo, atlas }: ReadableWorld): Origin[] {
  const cultures = new Map<CultureId, Settlement>();
  const byId = new Map(geo.settlements.map(place => [place.id, place]));
  const byKey = new Map(geo.settlements.map(place => [settlementKey(place), place]));
  for (const realm of geo.realms) {
    const capital = byId.get(realm.capital);
    if (capital && !cultures.has(realm.culture)) cultures.set(realm.culture, capital);
  }
  for (const place of geo.settlements) {
    if (!cultures.has(place.culture)) cultures.set(place.culture, place);
  }
  const source = data.domain?.source, bounds = data.domain?.bounds;
  const naming = cultureMap(data.params.seed, source?.width ?? data.width, source?.height ?? data.height, DEFAULT_HUMAN_PARAMS.cultureCount);
  return [
    ...Array.from(cultures, ([culture, settlement]): Origin => ({
      key: { kind: 'culture', id: culture },
      name: geo.languages.byId.get(geo.languageOf[culture])?.name ?? settlement.name,
      placeName: settlement.name, placeKey: settlementKey(settlement), at: settlementCellCenter(settlement), culture,
    })),
    ...atlas.places.filter(place => place.kind !== 'realm').map((place): Origin => ({
      key: { kind: 'place', id: place.key }, name: place.name, placeName: place.name, placeKey: place.key,
      at: settlementCellCenter(place),
      culture: byKey.get(place.key)?.culture ?? naming.cultureAt(place.x + (bounds?.x ?? 0), place.y + (bounds?.y ?? 0)),
    })),
  ];
}

export function findOrigin(world: ReadableWorld, key: CartographerOrigin) {
  return mapOrigins(world).find(origin => origin.key.kind === key.kind && origin.key.id === key.id);
}

function distance(world: WorldData, a: RoutePoint, b: RoutePoint): number {
  const dx = Math.abs(a.x - b.x);
  return Math.hypot(world.domain?.topology === 'finite' ? dx : Math.min(dx, world.width - dx), a.y - b.y);
}

export function economyMonth(calendar: WorldCalendar, date: WorldDate): number {
  const start = toDayNumber(calendar, { year: date.year });
  const day = toDayNumber(calendar, date) - start;
  return (date.year - 1) * 12 + Math.floor(12 * day / Math.max(1, daysInYear(calendar, date.year)));
}

/** Remember directions traders actually sailed or travelled over the past year. */
export function cartographerRoutes(
  { data, geo }: ReadableWorld, edits: readonly WorldEdit[], origin: Origin, month: number, reach: number,
): Route[] {
  const sites = tradeSitesFrom(edits);
  const places = placesFromSettlements(geo.settlements);
  const byId = new Map(places.map(place => [place.id, place]));
  const snapshots = simulateEconomy({
    world: data, places, seed: data.params.seed, manualSites: sites.manual, removedSites: sites.removed,
  }, 24, month - 23).slice(-12);
  const radius = Math.max(2, Math.min(data.width, data.height * 2) * reach);
  const connected = new Set(geo.settlements.filter(place =>
    distance(data, settlementCellCenter(place), origin.at) <= radius
    || (origin.key.kind === 'culture' && place.culture === origin.key.id && distance(data, settlementCellCenter(place), origin.at) <= radius * 2),
  ).map(place => place.id));
  const lanes = new Map<string, { from: number; to: number; bySea: boolean; amount: number }>();
  for (const snapshot of snapshots) for (const movement of snapshot.movements) {
    const { from, to, bySea, amount } = movement;
    if ((!connected.has(from) && !connected.has(to)) || (bySea && snapshot.month === month)) continue;
    const key = [Math.min(from, to), Math.max(from, to), bySea].join(':');
    const previous = lanes.get(key);
    lanes.set(key, { from, to, bySea, amount: amount / (1 + (month - snapshot.month) * 0.25) + (previous?.amount ?? 0) });
  }
  const wrap = data.domain?.topology !== 'finite';
  const routes: Route[] = [];
  for (const lane of [...lanes.values()].sort((a, b) => b.amount - a.amount)) {
    const a = byId.get(lane.from), b = byId.get(lane.to);
    if (!a || !b) continue;
    const gap = distance(data, a, b);
    if (gap > radius * (lane.bySea ? 4 : 2.5) || (!wrap && Math.abs(a.x - b.x) > data.width / 2)) continue;
    // Avoid the economy overlay's ruler-line fallback through land or water.
    const path = findRoute(data, a, b, lane.bySea, Math.max(12, gap * 3), Math.max(8, Math.min(90, Math.ceil(gap))));
    if (!path || (!wrap && path.some(point => point.x < 0 || point.x >= data.width))) continue;
    routes.push({ sea: lane.bySea, points: simplifyRoute(path, 0.65).map(settlementCellCenter) });
    if (routes.length === 30) break;
  }
  return routes;
}

export function buildKnowledge(
  { data }: ReadableWorld, origin: Origin, map: InWorldMap, routes: readonly Route[], edits: readonly WorldEdit[],
) {
  const { width, height } = data;
  const wrap = data.domain?.topology !== 'finite';
  const capital = origin.at;
  const radius = Math.max(2, Math.min(width, height * 2) * map.reach);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dist = distance(data, capital, { x: x + 0.5, y: y + 0.5 });
    const i = y * width + x;
    const sea = isOpenSea(data, i);
    mask[i] = dist <= radius * (sea ? 0.6 : 1) ? FOG_SEEN
      : dist <= radius * (sea ? 1.05 : 1.75) ? FOG_HEARD : FOG_HIDDEN;
  }

  // Sea lanes have a wider penumbra: a pilot charts adjacent headlands.
  const corridor = Math.max(2, Math.min(14, radius / 8));
  const routeEdits = (op: 'heard' | 'seen') => routes.flatMap(route =>
    fogStrokeEdits(route.points, width, op, corridor * (op === 'seen' ? 1 : route.sea ? 3 : 1.8), null, wrap),
  );
  const trades = fogMask([...routeEdits('heard'), ...routeEdits('seen')], width, height, 'blank', null, undefined, wrap);
  const chapterEdits = map.chapter === undefined ? [] : edits;
  const offset = data.domain?.bounds;
  const manual = map.marks.flatMap(({ x, y, op, radius: brush }) => fogStrokeEdits([
    { x: x - (offset?.x ?? 0), y: y - (offset?.y ?? 0) },
  ], width, op, brush, null, wrap));
  const overrides = [...chapterEdits, ...manual];
  // Two starts distinguish an explicit Hide from a cell no stroke touched.
  const blank = overrides.length ? fogMask(overrides, width, height, 'blank', map.chapter, undefined, wrap) : null;
  const ink = overrides.length ? fogMask(overrides, width, height, 'ink', map.chapter, undefined, wrap) : null;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = blank && ink && blank[i] === ink[i] ? blank[i] : Math.max(mask[i], trades[i]);
  }
  return {
    mask, shares: fogShares(mask), capital, radius, wrap,
    at: (x: number, y: number) => {
      const row = Math.floor(y), col = wrap ? mod(Math.floor(x), width) : Math.floor(x);
      return row < 0 || row >= height || col < 0 || col >= width ? FOG_HIDDEN : mask[row * width + col];
    },
  };
}

export function cartographerLabels(world: ReadableWorld, origin: Origin, knowledge: ReturnType<typeof buildKnowledge>) {
  const { geo, data, atlas } = world;
  const language = geo.languages.byId.get(geo.languageOf[origin.culture]);
  const settlements = new Map(geo.settlements.map(place => [settlementKey(place), place]));
  const features = new Map(geo.features.map(feature => [feature.sourceKey, feature]));
  return atlas.places.flatMap(place => {
    if (place.kind === 'realm') return [];
    const anchor = place.key === origin.placeKey;
    const known = knowledge.at(place.x, place.y);
    if (known === FOG_HIDDEN || (!anchor && known === FOG_HEARD && place.importance < 0.55)) return [];
    const settlement = settlements.get(place.key);
    const feature = features.get(place.key);
    const etym = settlement?.etym ?? feature?.etym;
    const local = anchor || settlement?.culture === origin.culture || (!!etym && etym.langId === language?.id);
    let name = place.name;
    if (!local && language && etym) {
      name = cognates(etym, geo.languages, data.params.seed, place.key).find(cognate => cognate.langId === language.id)?.text ?? name;
    } else if (!local) {
      const kind: FeatureKind | undefined = settlement ? 'settlement' : place.kind === 'landmark' ? (place.type as FeatureKind) : feature?.kind;
      const key = 'exonym:' + place.key;
      if (language) name = coinName(language, geo.languages.proto, key, data.params.seed, settlement && {
        heads: [settlement.port ? 'harbour' : settlement.river ? 'ford' : settlement.rank === 'capital' ? 'fort' : 'town'],
      }).text;
      else if (kind) name = generateName(data.params.seed, key, { kind, culture: origin.culture });
    }
    return [{ key: place.key, ...settlementCellCenter(place), name, known, settlement: anchor || !!settlement,
      capital: anchor, importance: place.importance }];
  }).sort((a, b) => Number(b.capital) - Number(a.capital) || b.known - a.known || b.importance - a.importance);
}
