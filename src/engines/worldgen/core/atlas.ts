// ============================================
// World Generator — The map as an index of the manuscript
// ============================================
// Every other feature in this engine could, in principle, be bought from
// ProFantasy or Wonderdraft. This one cannot, because it needs something no map
// program has: the book.
//
// A place in this world already has a stable identity — the same position-derived
// key the rename and delete edits use, which survives regeneration because the
// same seed puts the same city in the same place. Hanging scenes, characters and
// events off those keys turns the map from a picture into a NAVIGATION SURFACE
// for the novel: hover a town and see who is from there, which chapters happen
// there, and what happened and when.
//
// The link data belongs to the host application, not here. This module owns the
// place registry, the key scheme, the lookup and the summaries; the app owns the
// manuscript and hands links in. That boundary is deliberate — the world engine
// must stay usable, and testable, with no manuscript at all.

import { editKey, realmEditKey, type EditTarget } from './edits';
import {
  resolveWorldLandmarks,
  resolveWorldSpatialEntity,
  type WorldSpatialEntity,
} from './spatialEntities';
import type { HumanGeography } from './settlements';
import type { WorldData } from './types';

export type AtlasPlaceKind =
  | 'settlement' | 'ruin' | 'realm' | 'feature' | 'landmark'
  /** Something that only exists on a regional sheet: a hamlet, a mill, a fall. */
  | 'region';

export type AtlasPlace = WorldSpatialEntity;

/** What the manuscript hangs on a place. The host application supplies these. */
export interface ManuscriptLink {
  placeKey: string;
  kind: 'scene' | 'chapter' | 'character' | 'event' | 'note' | 'item';
  /** The host's own id, handed back on click so it can open the thing. */
  id: string;
  title: string;
  /**
   * The place's name at the moment the link was made.
   *
   * Stored purely so a link can be repaired later. A key is a position, and a
   * position is exactly what a change of parameters moves; a NAME is coined from
   * the seed and the language family, so the same town usually keeps it. When
   * both are available, the name is the better identity by a wide margin.
   */
  placeName?: string;
  /** "Capítulo 12", "capítulo 3 · escena 2", a date — whatever the host uses. */
  where?: string;
  /** Sort key within a place: chapter order, timeline position. */
  order?: number;
  /** For characters: born here, lives here, died here, passed through. */
  relation?: 'birth' | 'home' | 'death' | 'visit' | 'origin' | 'setting' | 'mention';
}

/**
 * CLAVES de catálogo, no texto: el motor guarda la clave y la vista la pasa por
 * `t()`. Las tablas `_ES` con español a fuego eran motor fuera de i18n.
 */
export const RELATION_KEY: Record<NonNullable<ManuscriptLink['relation']>, string> = {
  birth: 'worldgen.atlas.relation.birth', home: 'worldgen.atlas.relation.home',
  death: 'worldgen.atlas.relation.death', visit: 'worldgen.atlas.relation.visit',
  origin: 'worldgen.atlas.relation.origin', setting: 'worldgen.atlas.relation.setting',
  mention: 'worldgen.atlas.relation.mention',
};

export const LINK_KIND_KEY: Record<ManuscriptLink['kind'], string> = {
  scene: 'worldgen.atlas.linkKind.scene', chapter: 'worldgen.atlas.linkKind.chapter',
  character: 'worldgen.atlas.linkKind.character', event: 'worldgen.atlas.linkKind.event',
  note: 'worldgen.atlas.linkKind.note', item: 'worldgen.atlas.linkKind.item',
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface Atlas {
  places: AtlasPlace[];
  byKey: Map<string, AtlasPlace>;
}

/**
 * Every nameable thing in the world, with a key the manuscript can point at.
 *
 * The key scheme is `editKey`'s, unchanged and on purpose: renames, deletions
 * and manuscript links then all address the same object by the same name, so a
 * town the reader renamed keeps its scenes, and a town they deleted takes its
 * links with it instead of leaving them pointing into space.
 */
export function buildAtlas(world: WorldData, geo: HumanGeography): Atlas {
  const places: AtlasPlace[] = [];
  const add = (p: AtlasPlace) => {
    if (!p.hidden) places.push(p);
  };

  for (const s of geo.settlements) {
    add(resolveWorldSpatialEntity({
      key: editKey('settlement', s.x, s.y),
      kind: 'settlement',
      type: s.rank,
      name: s.name,
      x: s.x, y: s.y,
      extent: s.rank === 'capital' ? 4 : s.rank === 'city' ? 3 : 2,
      importance: s.rank === 'capital' ? 1 : s.rank === 'city' ? 0.8 : s.rank === 'town' ? 0.55 : 0.32,
      realmKey: s.realm >= 0 ? realmEditKey(s.realm) : undefined,
      source: s.painted ? 'painted' : 'generated',
    }, world.painted));
  }
  for (const r of geo.ruins) {
    add(resolveWorldSpatialEntity({
      key: editKey('ruin', r.x, r.y),
      kind: 'ruin', type: r.kind, name: r.name,
      x: r.x, y: r.y, extent: 2, importance: r.importance * 0.6,
      source: r.painted ? 'painted' : 'generated',
    }, world.painted));
  }
  for (const f of geo.features) {
    add(resolveWorldSpatialEntity({
      key: editKey('feature', f.x, f.y, `${f.kind}:`),
      kind: 'feature', type: f.kind, name: f.name,
      x: f.x, y: f.y,
      extent: Math.max(2, f.extent),
      importance: f.importance * 0.7,
    }, world.painted));
  }
  for (const r of geo.realms) {
    const cap = geo.settlements.find((s) => s.id === r.capital);
    add(resolveWorldSpatialEntity({
      // The key the rename is filed under, and the ONLY spelling: this panel is
      // where a country gets renamed, and for the whole life of the frontier
      // tool the two readers of that rename looked for `realm:<id>` instead —
      // so the name changed here and nowhere else on the map.
      key: realmEditKey(r.id),
      kind: 'realm', type: 'realm', name: r.name,
      x: cap?.x ?? 0, y: cap?.y ?? 0,
      extent: Math.max(6, Math.sqrt(r.cellCount)),
      importance: 0.9,
    }, world.painted));
  }
  for (const landmark of resolveWorldLandmarks(world)) add(landmark);

  const byKey = new Map<string, AtlasPlace>();
  for (const p of places) {
    byKey.set(p.key, p);
    // Keep old manuscript links and old edit-generated navigation working after
    // landmarks graduate from the overloaded `feature:` target.
    for (const legacyKey of p.legacyKeys) {
      if (!byKey.has(legacyKey)) byKey.set(legacyKey, p);
    }
  }
  return { places, byKey };
}

/**
 * A regional-sheet place, keyed so the manuscript can point at a hamlet too.
 *
 * Keyed by NAME rather than by position, scoped to the world cell it sits in.
 * A hamlet's position is a function of the sheet's resolution — open the same
 * country at a different zoom and the lattice pitch changes and it moves a few
 * hundred metres — but its name comes from the lattice index and does not. The
 * world cell scopes it so two hamlets called the same thing a continent apart
 * stay different places.
 */
export function regionPlaceKey(worldX: number, worldY: number, name: string): string {
  return `region:${Math.round(worldX)},${Math.round(worldY)}:${name.toLocaleLowerCase('es')}`;
}

/**
 * Fold an open regional sheet's places into an atlas.
 *
 * Returns a NEW atlas rather than mutating, because the world's atlas is shared
 * and long-lived while a sheet is open for as long as the reader is looking at
 * it. Only the things worth pointing a scene at come across — a farm track's
 * ford is not a place a chapter happens.
 */
export function withRegionPlaces(
  atlas: Atlas,
  region: {
    originX: number; originY: number; worldPerCellX: number; worldPerCellY: number;
    places: {
      kind: string;
      x: number;
      y: number;
      name: string;
      importance: number;
      sourceKey?: string;
      worldX?: number;
      worldY?: number;
    }[];
  },
): Atlas {
  const KEEP = new Set(['village', 'hamlet', 'abbey', 'mill', 'tower', 'inn', 'mine', 'quarry', 'landmark', 'farm']);
  const places = atlas.places.slice();
  const byKey = new Map(atlas.byKey);
  for (const p of region.places) {
    if (!KEEP.has(p.kind) || !p.name) continue;
    const wx = p.worldX ?? region.originX + p.x * region.worldPerCellX;
    const wy = p.worldY ?? region.originY + p.y * region.worldPerCellY;
    const legacyKey = regionPlaceKey(wx, wy, p.name);
    const key = p.sourceKey ?? legacyKey;
    if (byKey.has(key)) continue;
    const place = resolveWorldSpatialEntity({
      key, kind: 'region', type: p.kind, name: p.name,
      x: wx, y: wy, extent: 0.4, importance: p.importance * 0.5,
      source: 'regional',
    });
    places.push(place);
    byKey.set(key, place);
    // Existing manuscript links created before stable regional source keys
    // continue to resolve while new links use the resolution-independent key.
    if (legacyKey !== key) byKey.set(legacyKey, place);
  }
  return { places, byKey };
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export interface AtlasIndex {
  atlas: Atlas;
  /** Links hanging on each place, already sorted for display. */
  byPlace: Map<string, ManuscriptLink[]>;
  /** Which places an entity touches — the reverse question, and just as useful. */
  byEntity: Map<string, string[]>;
  /** Links pointing at places that no longer exist. */
  orphans: ManuscriptLink[];
}

export function buildIndex(atlas: Atlas, links: ManuscriptLink[]): AtlasIndex {
  const byPlace = new Map<string, ManuscriptLink[]>();
  const byEntity = new Map<string, string[]>();
  const orphans: ManuscriptLink[] = [];

  for (const l of links) {
    if (!atlas.byKey.has(l.placeKey)) { orphans.push(l); continue; }
    let list = byPlace.get(l.placeKey);
    if (!list) byPlace.set(l.placeKey, (list = []));
    list.push(l);
    let places = byEntity.get(l.id);
    if (!places) byEntity.set(l.id, (places = []));
    if (!places.includes(l.placeKey)) places.push(l.placeKey);
  }

  // Characters first, then the narrative in its own order. A reader hovering a
  // town wants "who" before "what", and chapter 3 before chapter 11.
  const RANK: Record<ManuscriptLink['kind'], number> = {
    character: 0, event: 1, chapter: 2, scene: 3, item: 4, note: 5,
  };
  for (const list of byPlace.values()) {
    list.sort((a, b) => (RANK[a.kind] - RANK[b.kind])
      || ((a.order ?? 1e9) - (b.order ?? 1e9))
      || a.title.localeCompare(b.title, 'es'));
  }
  return { atlas, byPlace, byEntity, orphans };
}

/** How busy each place is, for a heat overlay on the map. */
export function linkWeights(index: AtlasIndex): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, list] of index.byPlace) out.set(key, list.length);
  return out;
}

/**
 * What is under the cursor.
 *
 * Ranked by importance ÷ distance rather than by distance alone, so a click
 * between a capital and a hamlet resolves to the capital — which is what the
 * reader meant, because that is what they could see.
 */
export function placeAt(
  atlas: Atlas, world: WorldData, x: number, y: number,
  maxCells = 8, kinds?: AtlasPlaceKind[],
): AtlasPlace | null {
  let best: AtlasPlace | null = null;
  let bestScore = 0;
  for (const p of atlas.places) {
    if (kinds && !kinds.includes(p.kind)) continue;
    if (p.kind === 'realm') continue;                 // realms are areas, not points
    let dx = Math.abs(p.x - x);
    if (dx > world.width / 2) dx = world.width - dx;
    const d = Math.hypot(dx, p.y - y);
    const reach = Math.max(maxCells, p.extent);
    if (d > reach) continue;
    const score = (0.35 + p.importance) / (1 + d);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * The hover card, in sentences.
 *
 * Written as prose rather than as a table because the point of the feature is
 * that the map talks about the book: "Tres capítulos transcurren aquí; Aldrin
 * nació aquí" is a thing a writer reads and acts on, and a bar chart of link
 * counts is not.
 */
export function describePlace(
  place: AtlasPlace,
  links: ManuscriptLink[],
  // La frase entera por clave (lección #8): este texto iba en español a fuego
  // dentro del motor y una UI en inglés decía «Transcurre aquí una escena».
  t: (key: string) => string,
): string[] {
  if (!links.length) return [];
  const out: string[] = [];
  const chars = links.filter((l) => l.kind === 'character');
  const scenes = links.filter((l) => l.kind === 'scene' || l.kind === 'chapter');
  const events = links.filter((l) => l.kind === 'event');

  if (chars.length) {
    const named = chars.slice(0, 3).map((c) => {
      const rel = c.relation ? ` (${t(RELATION_KEY[c.relation])})` : '';
      return `${c.title}${rel}`;
    });
    const rest = chars.length - named.length;
    out.push(rest > 0
      ? t('worldgen.atlas.charsMore').replace('{names}', named.join(', ')).replace('{n}', String(rest))
      : named.join(', '));
  }
  if (scenes.length) {
    const where = scenes.map((s) => s.where).filter(Boolean) as string[];
    out.push(scenes.length === 1
      ? t('worldgen.atlas.sceneHere').replace('{what}', where[0] ?? t('worldgen.atlas.aScene'))
      : t('worldgen.atlas.scenesHere').replace('{n}', String(scenes.length))
        + (where.length ? ` (${where.slice(0, 3).join(', ')}${where.length > 3 ? '…' : ''})` : ''));
  }
  if (events.length) {
    out.push(events.length === 1
      ? t('worldgen.atlas.eventOne').replace('{title}', events[0].title)
        + (events[0].where ? ` · ${events[0].where}` : '')
      : t('worldgen.atlas.eventsHere').replace('{n}', String(events.length)));
  }
  void place;
  return out;
}

/** "Aldrin aparece en cuatro lugares" — the reverse lookup, for a character sheet. */
export function placesForEntity(index: AtlasIndex, entityId: string): AtlasPlace[] {
  const keys = index.byEntity.get(entityId) ?? [];
  return keys.map((k) => index.atlas.byKey.get(k)).filter((p): p is AtlasPlace => !!p);
}

/**
 * Links whose place no longer exists, with a guess at where it went.
 *
 * This is the maintenance job the feature creates for itself: a reader who
 * regenerates with different parameters, or deletes a town, will strand some
 * links, and silently dropping them is the worst possible answer. Offering the
 * nearest surviving place of the same kind lets the host app say "Aldrin's
 * birthplace no longer exists — did you mean Vaaspool, 40 km away?"
 */
export interface Reconciliation {
  link: ManuscriptLink;
  suggestion: AtlasPlace | null;
  /** How it was found. `name` is trustworthy; `position` needs a human. */
  by: 'name' | 'position' | null;
  distanceCells: number;
}

export function reconcile(
  atlas: Atlas, world: WorldData, orphans: ManuscriptLink[],
  previous: Map<string, { x: number; y: number; kind: AtlasPlaceKind }>,
  maxCells = 48,
): Reconciliation[] {
  const byName = new Map<string, AtlasPlace>();
  for (const p of atlas.places) {
    if (p.name) byName.set(`${p.kind}|${p.name.toLocaleLowerCase('es')}`, p);
  }
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    let dx = Math.abs(a.x - b.x);
    if (dx > world.width / 2) dx = world.width - dx;
    return Math.hypot(dx, a.y - b.y);
  };

  return orphans.map((l): Reconciliation => {
    const old = previous.get(l.placeKey);
    // Name first. A town that moved thirty cells is still that town; a different
    // town that happens to be near where the old one was is not, and offering it
    // as a match is how a character quietly acquires a new birthplace.
    if (l.placeName) {
      const kind = old?.kind ?? 'settlement';
      const hit = byName.get(`${kind}|${l.placeName.toLocaleLowerCase('es')}`);
      if (hit) {
        return { link: l, suggestion: hit, by: 'name', distanceCells: old ? dist(hit, old) : 0 };
      }
    }
    if (!old) return { link: l, suggestion: null, by: null, distanceCells: Infinity };
    const near = placeAt(atlas, world, old.x, old.y, maxCells, [old.kind]);
    if (!near) return { link: l, suggestion: null, by: null, distanceCells: Infinity };
    return { link: l, suggestion: near, by: 'position', distanceCells: dist(near, old) };
  });
}

/** Snapshot of where every place was, so a later regeneration can reconcile. */
export function snapshotPositions(
  atlas: Atlas,
): Map<string, { x: number; y: number; kind: AtlasPlaceKind }> {
  const m = new Map<string, { x: number; y: number; kind: AtlasPlaceKind }>();
  for (const p of atlas.places) m.set(p.key, { x: p.x, y: p.y, kind: p.kind });
  return m;
}

export type { EditTarget };
