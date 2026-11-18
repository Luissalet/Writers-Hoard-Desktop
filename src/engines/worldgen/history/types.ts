// ============================================
// World history — what the simulation reads and what it writes
// ============================================
// Pure data. The simulation never touches Dexie, the DOM or the generated
// world object: an adapter (fromGeography.ts) flattens the world into a
// HistoryInput, and everything here can be rebuilt from the seed alone.

/** The ground the realms grow over. Typed arrays are width*height. */
export interface HistoryWorld {
  width: number;
  height: number;
  /** False on a finite sheet: east and west edges do not meet. */
  wrapX: boolean;
  /** Elevation in km; sea at or below 0. */
  elevation: Float32Array;
}

export type HistoryRank = 'capital' | 'city' | 'town' | 'village';

/** A settlement on today's map. */
export interface HistoryPlace {
  /** Stable key (the settlement's source key, or `s:<id>`). */
  key: string;
  id: number;
  name: string;
  x: number;
  y: number;
  rank: HistoryRank;
  population: number;
  port: boolean;
  /** Language its name was coined in. */
  langId: string;
  /** Index of today's realm, or -1. */
  realm: number;
}

/** A realm on today's map: the simulation ends with these borders. */
export interface HistoryRealm {
  id: number;
  name: string;
  /** Settlement id of its capital. */
  capital: number;
  langId: string;
  /** 0–360. */
  hue: number;
}

/** A ruin on today's map: a place that once stood and fell. */
export interface HistoryRuin {
  key: string;
  id: number;
  name: string;
  x: number;
  y: number;
  kind: string;
  condition: 'overgrown' | 'buried' | 'flooded' | 'burnt' | 'standing' | 'drowned';
  importance: number;
}

/** Proper names in a language: houses, rulers, new realms. */
export type HistoryNamer = (langId: string, key: string, kind: 'house' | 'ruler' | 'realm' | 'place') => string;

export interface HistoryInput {
  world: HistoryWorld;
  places: HistoryPlace[];
  realms: HistoryRealm[];
  ruins: HistoryRuin[];
  /** Living languages, with their parents in the family tree. */
  languages: { id: string; name: string; parent: string | null }[];
  nameIn: HistoryNamer;
}

/**
 * A fact the author fixes and the simulation respects.
 * - realm-exists: the realm `polity` stands in `year` (founded before, not fallen yet).
 * - city-falls: the place (settlement or ruin key) is taken in `year`, by `by` when given.
 */
export type HistoryPin =
  | { id: string; kind: 'realm-exists'; polity: string; year: number }
  | { id: string; kind: 'city-falls'; place: string; year: number; by?: string };

export interface HistorySettings {
  seed: string;
  /** Length of the simulated span, 1–30 centuries. */
  centuries: number;
  /** 0 (peaceful) – 1 (constant war). */
  aggression: number;
  /** The year of today's map, in the world calendar's absolute years. */
  endYear: number;
  pins: HistoryPin[];
}

export const HISTORY_LIMITS = { centuries: { min: 1, max: 30 }, aggression: { min: 0, max: 1 }, pins: 60 } as const;

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = { seed: 'history', centuries: 6, aggression: 0.45, endYear: 1000, pins: [] };

export interface Reign { name: string; from: number; to: number }
export interface Dynasty { key: string; name: string; from: number; to: number; rulers: Reign[]; /** How it came to the throne. */ rise: 'founding' | 'usurpation' | 'marriage' | 'extinction' | 'conquest' }

/** A realm or culture with a capital, alive between `founded` and `fell`. */
export interface Polity {
  key: string;
  name: string;
  langId: string;
  hue: number;
  founded: number;
  /** Absent: it still stands on today's map. */
  fell?: number;
  /** Who brought it down, when someone did. */
  fellTo?: string;
  /** Key of the place it was founded at (settlement or ruin). */
  seat: string;
  /** Index of today's realm when it is one of them. */
  realm?: number;
  /** Founded by migrants from another polity. */
  migrantsFrom?: string;
  dynasties: Dynasty[];
}

export type HistoryEventKind =
  | 'polity-founded' | 'city-founded' | 'annexed' | 'war' | 'peace' | 'conquest' | 'sack'
  | 'abandoned' | 'flood' | 'collapse' | 'dynasty' | 'migration' | 'cession';

export interface HistoryEvent {
  /** Stable for a given seed and settings. */
  id: string;
  year: number;
  /** Wars: the year peace was made. */
  endYear?: number;
  kind: HistoryEventKind;
  polity?: string;
  /** The other side: an enemy, a conqueror, the realm a place was ceded to. */
  other?: string;
  /** Settlement or ruin key. */
  place?: string;
  /** Migration: where the migrants settled. */
  toPlace?: string;
  langId?: string;
  dynasty?: string;
  /** War key, on conquests, sacks and the peace that ended it. */
  war?: string;
  x?: number;
  y?: number;
  /** Placed where it is by one of the author's fixed facts. */
  pinned?: string;
}

export type RuinCause = 'sack' | 'conquest' | 'flood' | 'abandoned' | 'collapse';

/** Why a ruin is a ruin, as far as the history explains it. */
export interface RuinStory {
  ruin: string;
  /** Chronicle event that explains the fall. */
  eventId: string;
  /** The place's name in its time. */
  name: string;
  founded: number;
  fell: number;
  cause: RuinCause;
  /** The polity it belonged to when it fell. */
  polity?: string;
  /** Who did it, when someone did. */
  by?: string;
}

/** A name that outlived the language it was coined in. */
export interface Toponym {
  place: string;
  name: string;
  /** Language the name is in. */
  langId: string;
  /** Language of the realm that rules the place today. */
  rulerLangId: string;
  /** Since when the place has been under that rule. */
  since: number;
  /** The same place as the rulers would have named it. */
  alternative?: string;
}

export interface WorldHistory {
  settings: HistorySettings;
  startYear: number;
  endYear: number;
  /** Year granularity of the simulation. */
  step: number;
  polities: Polity[];
  /** Who held each place since when, in order. Keys: settlements and ruins. */
  owners: Record<string, { polity: string; from: number }[]>;
  /** When each place was founded (absent = before the span). */
  founded: Record<string, number>;
  events: HistoryEvent[];
  ruins: RuinStory[];
  toponyms: Toponym[];
  /** Pins the simulation had to move or could not honour, in words for the author. */
  notes: string[];
}
