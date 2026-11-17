import { db } from '@/db';
import { deleteCodexEntry } from '@/db/operations';
import { createEntryFromMap } from '@/engines/maps/codexLink';
import { announceEraChange, hideEraDocument, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry, CodexEntryType } from '@/types';
import type { EntityLink } from '@/types/projectTools';
import { stableText } from '@/services/aiBridge/undoStamp';
import { generateId } from '@/utils/idGenerator';
import { targetFromKey } from './core/edits';
import { openWorldForReading } from './bridgeAccess';
import { deleteWorldLink, listWorldLinks, saveWorldLink, worldgenScopeOperations } from './era';
import type { WorldData } from './core/types';
import { Biome } from './core/types';
import type { HumanGeography } from './core/settlements';
import { mapMetric, metricDistanceKm } from './core/geoScale';
import { runtimeGeometry, runtimeU, runtimeV } from './core/runtimeGeometry';
import { SphereNoise } from './core/noise';
import { autoSites, GOODS, placesFromSettlements, simulateEconomy, siteFitness, tradeSitesFrom, type Good } from './core/economy';
import { deserializeEdits } from './core/edits';
import { weatherAt, type WeatherDate, type WorldWeather } from './core/weather';
import { daysInYear, toDayNumber } from '@/engines/timeline/worldCalendar';

export interface WorldPresenceCard {
  point: { x: number; y: number }; biome: number; elevationM: number;
  relief: 'water' | 'plain' | 'hills' | 'mountains';
  geology: 'volcanic' | 'limestone' | 'sediment' | 'bedrock';
  materials: ('timber' | 'stone' | 'clay' | 'reeds' | 'earth')[];
  diet: ('grain' | 'fish' | 'meat' | 'gathering')[];
  language: { id: string; name: string; ancestry: string[]; source: string } | null;
  trade: { market: string; goods: { good: Good; production: number; price: number }[] } | null;
  nearby: { kind: 'settlement' | 'ruin'; name: string; km: number; x: number; y: number }[];
  weather: WorldWeather | null;
}

/** Derived narrator reference; authored names and economic edits remain the authority. */
export function describeWorldPresence(world: WorldData, geo: HumanGeography, point: { x: number; y: number }, date?: WeatherDate, edits = ''): WorldPresenceCard {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.y < 0 || point.y >= world.height
    || world.domain?.topology === 'finite' && (point.x < 0 || point.x >= world.width)) throw Error('weather_point_outside_world');
  const x = Math.floor(((point.x % world.width) + world.width) % world.width), y = Math.floor(point.y), i = y * world.width + x;
  const biome = world.biome[i], elevationM = Math.round(world.elevation[i] * 1000);
  const distance = (p: { x: number; y: number }) => metricDistanceKm(mapMetric(world), world.width, world.height, x, y, p.x, p.y);
  const nearby = [...geo.settlements.map(p => ({ ...p, kind: 'settlement' as const })), ...geo.ruins.map(p => ({ ...p, kind: 'ruin' as const }))]
    .map(p => ({ kind: p.kind, name: p.name, x: p.x, y: p.y, km: Math.round(distance(p) * 10) / 10 }))
    .filter(p => p.km <= 150).sort((a, b) => a.km - b.km || a.name.localeCompare(b.name)).slice(0, 8);
  const nearest = geo.settlements.map(p => ({ p, km: distance(p) })).sort((a, b) => a.km - b.km)[0];
  const realm = geo.realms.find(r => r.id === geo.realmOf[i]);
  const culture = realm?.culture ?? (nearest && nearest.km <= 150 ? nearest.p.culture : undefined);
  const spoken = culture ? geo.languages.byId.get(geo.languageOf[culture]) : undefined;
  const ancestry: string[] = [];
  let parent = spoken?.parent;
  while (parent && ancestry.length < geo.languages.all.length) { const p = geo.languages.byId.get(parent); if (!p) break; ancestry.unshift(p.name); parent = p.parent; }
  const water = elevationM <= 0 || !!world.lake[i];
  const geometry = runtimeGeometry(world);
  const u = geometry ? runtimeU(world.params, geometry, x + 0.5) : (x + 0.5) / world.width;
  const v = geometry ? runtimeV(world.params, geometry, y + 0.5) : (y + 0.5) / world.height;
  const karst = new SphereNoise(world.params.seed, 'karst').fbm(u, v, 5 * world.params.worldScale, 3);
  const geology = [Biome.Volcanic, Biome.AshPlain].includes(biome as 38 | 39) || world.boundary[i] > 0.28 ? 'volcanic'
    : biome === Biome.Karst || karst > 0.24 && elevationM > 80 && elevationM < 2400 && world.precipitation[i] >= 420 ? 'limestone'
      : elevationM < 200 || [Biome.Erg, Biome.Beach, Biome.SaltFlat].includes(biome as 28 | 16 | 17) ? 'sediment' : 'bedrock';
  const materials: WorldPresenceCard['materials'] = [], diet: WorldPresenceCard['diet'] = [];
  if (!water) {
    if (siteFitness(world, 'camp', x, y) > 0.2) materials.push('timber');
    if (geology !== 'sediment' || siteFitness(world, 'quarry', x, y) > 0.4) materials.push('stone');
    materials.push(world.precipitation[i] > 600 && geology === 'sediment' ? 'clay' : 'earth');
    if ([Biome.Marsh, Biome.SaltMarsh, Biome.Mangrove, Biome.GlowMarsh].includes(biome as 20 | 19 | 18 | 43)) materials.push('reeds');
    if (siteFitness(world, 'farm', x, y) > 0.25) diet.push('grain');
    if (siteFitness(world, 'pasture', x, y) > 0.25) diet.push('meat');
    if (siteFitness(world, 'camp', x, y) > 0.2) diet.push('gathering');
  }
  if (water || siteFitness(world, 'fishery', x, y) > 0.25) diet.push('fish');
  let trade: WorldPresenceCard['trade'] = null;
  if (nearest && nearest.km <= 150) {
    const authored = tradeSitesFrom(deserializeEdits(edits));
    const input = { world, places: placesFromSettlements(geo.settlements), seed: world.params.seed, manualSites: authored.manual, removedSites: authored.removed };
    const month = date ? Math.floor((toDayNumber(date.calendar, date.date) - toDayNumber(date.calendar, { year: date.date.year })) / daysInYear(date.calendar, date.date.year) * 12) : 0;
    const snapshot = simulateEconomy(input, 1, month, autoSites(input))[0];
    const market = snapshot?.places.find(p => p.id === nearest.p.id);
    if (market) trade = { market: nearest.p.name, goods: GOODS.filter(good => market.production[good] > 0 || market.consumed[good] > 0).map(good => ({ good, production: market.production[good], price: market.price[good] })) };
  }
  return { point: { x, y }, biome, elevationM, relief: water ? 'water' : elevationM > 1500 ? 'mountains' : elevationM > 350 ? 'hills' : 'plain', geology, materials, diet,
    language: spoken ? { id: spoken.id, name: spoken.name, ancestry, source: realm?.name ?? nearest!.p.name } : null,
    nearby, trade, weather: date ? weatherAt(world, { x, y }, date) : null };
}

export interface PlaceCardReceipt { worldId: string; card: CodexEntry; link: EntityLink }

/** One confirmed mutation: a normal Codex card and the atlas' existing manuscript link. */
export async function createPlaceCard(scope: WorldEraScope, worldId: string, place: { key: string; name: string }, type: CodexEntryType): Promise<PlaceCardReceipt> {
  const source = await worldgenScopeOperations(scope).worlds.getOne(worldId);
  if (!source || source.projectId !== scope.projectId) throw Error('world_missing');
  if (!targetFromKey(place.key)) throw Error('place_key_invalid');
  const opened = await openWorldForReading(source, 'full', scope.eraId);
  if (!opened.ok) throw Error(opened.message);
  const currentPlace = opened.world.atlas.byKey.get(place.key);
  if (!currentPlace || currentPlace.name !== place.name) throw Error('place_changed');
  const result = await db.transaction('rw', db.tables, async () => {
    const world = await worldgenScopeOperations(scope).worlds.getOne(worldId);
    if (!world || world.projectId !== scope.projectId) throw Error('world_missing');
    if (stableText([world.params, world.edits]) !== stableText([source.params, source.edits])) throw Error('place_changed');
    const project = await db.projects.get(scope.projectId);
    if (!project?.enabledEngines.includes('worldgen')) throw Error('worldgen_engine_disabled');
    if (!targetFromKey(place.key)) throw Error('place_key_invalid');
    const id = await createEntryFromMap(scope, place.name, type);
    const card = (await readEraRow<CodexEntry>(scope, 'codexEntries', id))!;
    const now = Date.now();
    const link: EntityLink = {
      id: generateId('entity-link'), projectId: scope.projectId,
      sourceEngineId: 'worldgen', sourceEntityType: 'world-spatial', sourceEntityId: `${worldId}::${place.key}`, sourceTitle: card.title,
      targetEngineId: 'codex', targetEntityType: 'codex-entry', targetEntityId: id, targetTitle: card.title,
      relation: 'represents', provenance: 'manual', createdAt: now, updatedAt: now,
    };
    await saveWorldLink(scope, worldId, link);
    return { worldId, card, link };
  });
  announceEraChange(scope.projectId);
  return result;
}

/** Refuse the whole reversal if either half has changed; never remove a later edit. */
export async function undoPlaceCard(scope: WorldEraScope, receipt: PlaceCardReceipt): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const world = await worldgenScopeOperations(scope).worlds.getOne(receipt.worldId);
    const card = await readEraRow<CodexEntry>(scope, 'codexEntries', receipt.card.id);
    const links = await listWorldLinks(scope, receipt.worldId);
    const link = links.find(row => row.id === receipt.link.id);
    if (!world || world.projectId !== scope.projectId || receipt.card.projectId !== scope.projectId || receipt.link.projectId !== scope.projectId
      || stableText(card) !== stableText(receipt.card) || stableText(link) !== stableText(receipt.link)
      || links.some(row => row.targetEntityId === receipt.card.id && row.id !== receipt.link.id)) throw Error('place_card_changed');
    if (await db.sceneCasts.filter(row => row.characterId === receipt.card.id).count()
      || await db.annotationReferences.where('targetEntityId').equals(receipt.card.id).count()) throw Error('place_card_referenced');
    // The card may be unchanged while another editor has since used it. Do not
    // cascade away those pins, relationships, prose references or sibling-era links.
    for (const table of db.tables) {
      if (['documentHistory', 'documentArchives', 'worldEraAssets', 'writingSnapshots'].includes(table.name)) continue;
      const rows = table.name === 'projects' ? [await db.projects.get(scope.projectId)] : table.schema.idxByName.projectId ? await table.where('projectId').equals(scope.projectId).toArray() : [];
      for (const row of rows) {
        if (!row || table.name === 'codexEntries' && row.id === receipt.card.id || table.name === 'entityLinks' && row.id === receipt.link.id
          || table.name === 'worldEraVariants' && row.entityId === receipt.card.id && row.eraId === scope.eraId && row.kind === 'codex') continue;
        const liveRow = table.name === 'worldEraVariants' ? { ...row, history: undefined } : row;
        if (stableText(liveRow).replaceAll(stableText(receipt.link), 'null').includes(receipt.card.id)) throw Error(`place_card_referenced:${table.name}`);
      }
    }
    await deleteWorldLink(scope, receipt.worldId, receipt.link.id);
    if (scope.eraId) {
      const current = await readWorldDocument(scope, 'codex', receipt.card.id);
      if (!current) throw Error('place_card_changed');
      await hideEraDocument(scope, 'codex', receipt.card.id, current.version);
    } else await deleteCodexEntry(receipt.card.id);
  });
  announceEraChange(scope.projectId);
}
