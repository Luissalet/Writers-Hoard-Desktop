// ============================================================================
// Real atlas — the story's real-world setting, and where it departs from it
// ============================================================================
//
// Worldgen is for invented planets: places derived from a relief the reader
// paints. Plenty of writers set their book in Lisbon, in 1936 Madrid, or in
// a Paris where one street has a bar that never existed. Their places are
// AUTHORITATIVE rows — a name, coordinates, what is true there — not a
// derivation, so they live here rather than as a worldgen preset. Two kinds
// of row:
//
//   AtlasPlace       a real place the book uses (or an invented one inserted
//                    into the real world — Macondo, Vetusta), with the facts
//                    the author has checked and what the story makes of it.
//   AtlasDivergence  one deliberate departure from reality: what is actually
//                    the case, what the book says instead, and why. Anchored
//                    to a place when it is local; free-standing when it is
//                    global ("the war ended in 1947").
//
// Both are plain, project-scoped tables: backups, search, the bridge and the
// project sweep all work the ordinary way.

export type AtlasPlaceKind =
  | 'country' | 'region' | 'city' | 'town' | 'village' | 'district'
  | 'street' | 'building' | 'landmark' | 'natural' | 'route' | 'other';

export const ATLAS_PLACE_KINDS: readonly AtlasPlaceKind[] = [
  'country', 'region', 'city', 'town', 'village', 'district',
  'street', 'building', 'landmark', 'natural', 'route', 'other',
];

export interface AtlasPlace {
  id: string;
  projectId: string;
  name: string;
  kind: AtlasPlaceKind;
  /** Other names: historical, local-language, the book's own. */
  aliases: string[];
  /** Decimal degrees, WGS84. Optional: a street may only have an address. */
  lat?: number;
  lon?: number;
  address?: string;
  country?: string;
  /** Containing place (a building in a city, a district in a town). */
  parentId?: string;
  /** When the place matters to the book: "1936", "verano de 1898", "hoy". */
  era?: string;
  /** How the story uses the place — scenes, mood, what the reader should feel. */
  description: string;
  /** What is actually true there, checked: opening hours, distances, what stood where. */
  realNotes: string;
  /** Where the facts came from: URLs, books, a visit. */
  sources: string[];
  /** True for a place the author invented and set inside the real world. */
  fictional: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type DivergenceCategory =
  | 'geography' | 'history' | 'politics' | 'technology' | 'culture' | 'people' | 'other';

export const DIVERGENCE_CATEGORIES: readonly DivergenceCategory[] = [
  'geography', 'history', 'politics', 'technology', 'culture', 'people', 'other',
];

export interface AtlasDivergence {
  id: string;
  projectId: string;
  /** The place it is about; absent for a global change. */
  placeId?: string;
  title: string;
  category: DivergenceCategory;
  /** What is actually the case. */
  reality: string;
  /** What the book says instead. */
  fiction: string;
  /** Why the author changed it (dramatic need, simplification, alternate history…). */
  reason: string;
  /** From when the change applies in the story's chronology, free text. */
  since?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
