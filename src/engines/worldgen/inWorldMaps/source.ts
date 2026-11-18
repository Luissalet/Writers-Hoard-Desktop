import { formatWorldDate, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import type { WorldEraScope } from '@/services/worldEras/types';
import { openWorldForReading, type ReadableWorld } from '../bridgeAccess';
import { deserializeEdits, type WorldEdit } from '../core/edits';
import { domainBounds, readDomainDocument } from '../core/domainDocument';
import { projectDomainEdit } from '../core/domainReplay';
import { liveWorld } from '../core/liveWorlds';
import { worldRuntimeKey } from '../era';
import type { GeneratedWorld } from '../types';
import { buildKnowledge, cartographerLabels, cartographerRoutes, economyMonth, findOrigin } from './knowledge';
import { drawPlate } from './plate';
import type { InWorldMap } from './types';
import { InWorldMapError } from './store';

export interface CartographerSource {
  world: ReadableWorld;
  edits: WorldEdit[];
}

export async function openCartographerSource(row: GeneratedWorld, scope: WorldEraScope) {
  const serialized = liveWorld(worldRuntimeKey(row.id, scope.eraId))?.snapshot() ?? row.edits;
  const opened = await openWorldForReading({ ...row, edits: serialized }, 'full', scope.eraId, 'snapshot');
  if (!opened.ok) return opened;
  const domain = serialized ? readDomainDocument(serialized) : null;
  const edits = serialized ? deserializeEdits(serialized) : [];
  return { ok: true as const, source: {
    world: opened.world,
    edits: domain ? edits.map(edit => projectDomainEdit(edit, domainBounds(domain))) : edits,
  } };
}

export function routesForMap(source: CartographerSource, map: InWorldMap, calendar: WorldCalendar) {
  const origin = findOrigin(source.world, map.origin);
  if (!origin) throw new InWorldMapError('not-found', 'Cartographer origin no longer exists');
  const routes = cartographerRoutes(source.world, source.edits, origin, economyMonth(calendar, map.date), map.reach);
  return { origin, routes };
}

export function plateForMap(source: CartographerSource, map: InWorldMap, calendar: WorldCalendar, locale: 'es' | 'en', prepared = routesForMap(source, map, calendar)) {
  const { origin, routes } = prepared;
  const knowledge = buildKnowledge(source.world, origin, map, routes, source.edits);
  const labels = cartographerLabels(source.world, origin, knowledge);
  const plate = drawPlate(source.world.data, map, knowledge, routes, labels, {
    origin: origin.key.kind === 'culture' ? origin.name + ' · ' + origin.placeName : origin.name,
    date: formatWorldDate(calendar, map.date),
    unknown: locale === 'es' ? 'Tierra incógnita' : 'Terra incognita',
  });
  return { ...plate, shares: knowledge.shares, names: labels, routeCount: routes.length };
}
