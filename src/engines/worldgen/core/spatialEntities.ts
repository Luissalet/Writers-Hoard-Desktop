// ============================================
// World Generator — Spatial entities
// ============================================
// Renderers and the Atlas used to interpret the same generated landmark in
// different ways. This module is the single resolution boundary: a generated
// source keeps its deterministic key and defaults, while the reader's sparse
// rename/move/style/remove edits are folded over it without mutating generation
// output. The same shape can also be used by regional and hand-authored places.

import type { AppliedEdits } from './edits';
import { editKey } from './edits';
import type { Landmark, LandmarkType, WorldData } from './types';

export type WorldSpatialEntityKind =
  | 'settlement'
  | 'ruin'
  | 'realm'
  | 'feature'
  | 'landmark'
  | 'region';

/** Presentation overrides deliberately contain no semantic type information. */
export interface WorldSpatialStyle {
  /** Symbol identifier understood by the active renderer. */
  icon?: string;
  /** CSS colour used by renderers which support recolouring. */
  color?: string;
  /** Relative symbol scale. One means the renderer's normal size. */
  size?: number;
  /** Undefined lets the renderer apply its normal label-density policy. */
  labelVisible?: boolean;
}

export type WorldSpatialStyleOverride = Partial<WorldSpatialStyle>;

/**
 * The resolved representation consumed by 2D, 3D, regional views and Atlas.
 *
 * `key` always identifies the generated SOURCE position, not the edited
 * position. Moving an entity therefore cannot break manuscript links or make a
 * later rename address a different object.
 */
export interface WorldSpatialEntity {
  key: string;
  /** Historical identities which still resolve to this entity. */
  legacyKeys: readonly string[];
  kind: WorldSpatialEntityKind;
  /** Semantic subtype: capital, volcano, cave, sea, and so on. */
  type: string;
  name: string;
  /** Resolved world-cell coordinates after a move override. */
  x: number;
  y: number;
  /** Deterministic source coordinates used to derive `key`. */
  sourceX: number;
  sourceY: number;
  extent: number;
  importance: number;
  realmKey?: string;
  source: 'generated' | 'painted' | 'regional';
  hidden: boolean;
  style: Readonly<WorldSpatialStyle>;
}

export interface WorldSpatialEntitySource {
  key: string;
  legacyKeys?: readonly string[];
  kind: WorldSpatialEntityKind;
  type: string;
  name: string;
  x: number;
  y: number;
  extent: number;
  importance: number;
  realmKey?: string;
  source?: WorldSpatialEntity['source'];
  style?: WorldSpatialStyle;
}

const LANDMARK_NAMES: Record<LandmarkType, string> = {
  volcano: 'Volcán',
  cave: 'Cueva',
  waterfall: 'Cascada',
  gorge: 'Garganta',
  hotspring: 'Manantial termal',
};

/**
 * Fold aliases from oldest to newest, then the canonical key. This makes a new
 * first-class landmark edit win when a world also contains a legacy `feature:`
 * edit for the same generated object.
 */
function overrideKeys(source: WorldSpatialEntitySource): string[] {
  return [...(source.legacyKeys ?? [])].reverse().concat(source.key);
}

/**
 * Resolve a generated or regional source against sparse persisted overrides.
 * Consumers may retain hidden entities for inspectors by checking `hidden`;
 * collection helpers decide whether to filter them from normal rendering.
 */
export function resolveWorldSpatialEntity(
  source: WorldSpatialEntitySource,
  edits?: AppliedEdits,
): WorldSpatialEntity {
  const keys = overrideKeys(source);
  let name = source.name;
  let x = source.x;
  let y = source.y;
  const style: WorldSpatialStyle = { ...source.style };

  if (edits) {
    for (const key of keys) {
      const renamed = edits.renames[key];
      if (renamed !== undefined) name = renamed;
      // Optional chaining keeps structured-cloned AppliedEdits objects created
      // by versions before move/style overrides readable.
      const moved = edits.moves?.[key];
      if (moved) {
        x = moved.x;
        y = moved.y;
      }
      const styled = edits.styles?.[key];
      if (styled) Object.assign(style, styled);
    }
  }

  return {
    key: source.key,
    legacyKeys: source.legacyKeys ?? [],
    kind: source.kind,
    type: source.type,
    name,
    x,
    y,
    sourceX: source.x,
    sourceY: source.y,
    extent: source.extent,
    importance: source.importance,
    realmKey: source.realmKey,
    source: source.source ?? 'generated',
    hidden: keys.some((key) => edits?.removed.has(key) ?? false),
    style,
  };
}

/** First-class identity for a generated world landmark. */
export function landmarkKey(landmark: Pick<Landmark, 'type' | 'x' | 'y'>): string {
  return editKey('landmark', landmark.x, landmark.y, `${landmark.type}:`);
}

/** Identity emitted by versions which represented landmarks as named features. */
export function legacyLandmarkKey(landmark: Pick<Landmark, 'type' | 'x' | 'y'>): string {
  return editKey('feature', landmark.x, landmark.y, `${landmark.type}:`);
}

/** Resolve one generated landmark, retaining its hidden state for an inspector. */
export function resolveWorldLandmark(
  landmark: Landmark,
  edits?: AppliedEdits,
): WorldSpatialEntity {
  return resolveWorldSpatialEntity({
    key: landmarkKey(landmark),
    legacyKeys: [legacyLandmarkKey(landmark)],
    kind: 'landmark',
    type: landmark.type,
    name: LANDMARK_NAMES[landmark.type],
    x: landmark.x,
    y: landmark.y,
    extent: 2,
    importance: landmark.strength * 0.4,
    style: {
      icon: landmark.type,
      size: 1,
    },
  }, edits);
}

/**
 * Resolve every generated landmark in a world.
 *
 * Hidden entities are omitted by default for renderers and Atlas. Inspectors
 * can request them to offer a restore action without reconstructing identity.
 */
export function resolveWorldLandmarks(
  world: Pick<WorldData, 'landmarks' | 'painted'>,
  options: { includeHidden?: boolean } = {},
): WorldSpatialEntity[] {
  const entities = world.landmarks.map((landmark) =>
    resolveWorldLandmark(landmark, world.painted));
  return options.includeHidden ? entities : entities.filter((entity) => !entity.hidden);
}
