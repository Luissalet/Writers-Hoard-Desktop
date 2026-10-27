import { editKey, realmEditKey, type EditTarget } from './edits';
import type { HumanGeography } from './settlements';
import type { WorldData } from './types';
import { domainSourceKey, type DomainCatalogue, type DomainIdentity } from './worldDomain';

export function domainPlaceKey(world: WorldData, kind: EditTarget, x: number, y: number, extra = ''): string {
  return editKey(kind, x + (world.domain?.bounds.x ?? 0), y + (world.domain?.bounds.y ?? 0), extra);
}

/** Capture the uncorrected base from the actual loaded fields, never from a replacement cold reconstruction. */
export function captureDomainCatalogue(world: WorldData, base: HumanGeography, legacy: string): DomainCatalogue {
  const entries: DomainIdentity[] = [];
  for (const place of base.settlements) entries.push({ kind: place.painted ? 'authored' : 'settlement', key: place.sourceKey ?? domainPlaceKey(world, 'settlement', place.x, place.y), id: place.id, ...(place.painted ? {} : { name: place.name }), at: { x: place.x + (world.domain?.bounds.x ?? 0), y: place.y + (world.domain?.bounds.y ?? 0) },
    refs: { ...(place.realm < 0 ? {} : { realmKey: realmEditKey(place.realm) }), cultureId: place.culture, languageId: base.languageOf[place.culture] } });
  for (const place of base.ruins) if (!place.painted) entries.push({ kind: 'ruin', key: place.sourceKey ?? domainPlaceKey(world, 'ruin', place.x, place.y), id: place.id, name: place.name, type: place.kind, at: { x: place.x + (world.domain?.bounds.x ?? 0), y: place.y + (world.domain?.bounds.y ?? 0) } });
  for (const place of base.features) entries.push({ kind: 'feature', key: place.sourceKey ?? domainPlaceKey(world, 'feature', place.x, place.y, `${place.kind}:`), name: place.name, at: { x: place.x + (world.domain?.bounds.x ?? 0), y: place.y + (world.domain?.bounds.y ?? 0) } });
  for (const place of base.realms) entries.push({ kind: 'realm', key: realmEditKey(place.id), id: place.id, name: place.name,
    refs: { capitalKey: base.settlements.find(s => s.id === place.capital)?.sourceKey, cultureId: place.culture, languageId: base.languageOf[place.culture] } });
  for (const place of world.landmarks) {
    const x = place.x + (world.domain?.bounds.x ?? 0), y = place.y + (world.domain?.bounds.y ?? 0);
    entries.push({ kind: 'landmark', key: `landmark:${place.type}:${Math.round(x)},${Math.round(y)}`, at: { x, y } });
  }
  for (const road of base.roads) {
    if (road.cells.length < 2) continue;
    const from = base.settlements.find(s => s.y * world.width + s.x === road.cells[0]);
    const to = base.settlements.find(s => s.y * world.width + s.x === road.cells.at(-1));
    if (from && to) entries.push({ kind: 'road', key: road.sourceKey ?? `road:${from.sourceKey}:${to.sourceKey}`, refs: { fromKey: from.sourceKey, toKey: to.sourceKey } });
  }
  return { version: 1, sourceKey: domainSourceKey(world.params, legacy), entries };
}

/** The preparing operation owns this delta; readers only consume the resulting catalogue. */
export function extendDomainCatalogue(world: WorldData, base: HumanGeography, catalogue: DomainCatalogue): DomainCatalogue {
  const known = new Set(catalogue.entries.map(entry => entry.key));
  const additions = captureDomainCatalogue(world, base, '').entries.filter(entry => {
    if (known.has(entry.key)) return false;
    known.add(entry.key);
    return true;
  });
  return additions.length ? { ...catalogue, entries: [...catalogue.entries, ...additions] } : catalogue;
}
