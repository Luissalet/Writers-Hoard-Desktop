// Places of a generated world a ledger line can point at: the atlas (towns,
// ruins, features, realms) plus the labels and named stamps the author painted,
// searched by name the way the map's locator does (accents folded, best fit first).
import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { foldForSearch, matchRank } from '@/engines/worldgen/core/searchText';
import type { GeneratedWorld } from '@/engines/worldgen/types';

export interface WorldPlaceHit {
  key: string;
  name: string;
  /** Atlas kind (`town`, `ruin`…), `label` or `stamp`. */
  kind: string;
  worldId: string;
  x: number;
  y: number;
}

interface PoolItem extends WorldPlaceHit { folded: string; importance: number }

const pools = new Map<string, PoolItem[]>();

async function poolFor(world: GeneratedWorld, eraId: string | undefined): Promise<PoolItem[] | null> {
  const key = `${world.id}|${eraId ?? ''}|${world.updatedAt}|${(world.edits ?? '').length}`;
  const cached = pools.get(key);
  if (cached) return cached;
  const { openWorldForReading } = await import('@/engines/worldgen/bridgeAccess');
  const opened = await openWorldForReading(world, 'full', eraId);
  if (!opened.ok) return null;
  const { data, atlas } = opened.world;
  const out: PoolItem[] = [];
  for (const place of atlas.places) {
    if (!place.name) continue;
    out.push({ key: place.key, name: place.name, kind: place.kind, worldId: world.id, x: place.x, y: place.y, folded: foldForSearch(place.name), importance: place.importance });
  }
  for (const label of data.painted?.labels ?? []) {
    out.push({ key: label.key ?? `label:${label.x},${label.y}`, name: label.text, kind: 'label', worldId: world.id, x: label.x, y: label.y, folded: foldForSearch(label.text), importance: 1.2 });
  }
  for (const stamp of data.painted?.stamps ?? []) {
    if (!stamp.name) continue;
    const moved = data.painted?.moves?.[stamp.key];
    out.push({ key: stamp.key, name: stamp.name, kind: 'stamp', worldId: world.id, x: moved?.x ?? stamp.x, y: moved?.y ?? stamp.y, folded: foldForSearch(stamp.name), importance: 1.1 });
  }
  if (pools.size > 8) pools.delete(pools.keys().next().value as string);
  pools.set(key, out);
  return out;
}

/** "12, 40" or "12 40": a point typed as world cells. */
export function parseCellPoint(text: string): { x: number; y: number } | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/**
 * Named places of the project's worlds that match the query, best fit first.
 * Returns `pending` for worlds still being generated on this machine.
 */
export async function searchWorldPlaces(projectId: string, query: string, options: { eraId?: string; worldId?: string; limit?: number } = {}): Promise<{ hits: WorldPlaceHit[]; pending: string[] }> {
  const q = foldForSearch(query.trim());
  if (!q) return { hits: [], pending: [] };
  const worlds = (await worldgenScopeOperations({ projectId, eraId: options.eraId }).worlds.getAll(projectId) as GeneratedWorld[])
    .filter((world) => !options.worldId || world.id === options.worldId);
  const pending: string[] = [];
  const ranked: Array<{ item: PoolItem; rank: number }> = [];
  for (const world of worlds) {
    const pool = await poolFor(world, options.eraId);
    if (!pool) { pending.push(world.id); continue; }
    for (const item of pool) {
      const rank = matchRank(item.folded, q);
      if (rank >= 0) ranked.push({ item, rank });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || b.item.importance - a.item.importance || a.item.name.length - b.item.name.length);
  const hits = ranked.slice(0, options.limit ?? 20).map(({ item }) => ({ key: item.key, name: item.name, kind: item.kind, worldId: item.worldId, x: item.x, y: item.y }));
  return { hits, pending };
}
