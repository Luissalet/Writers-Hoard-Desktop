import { buildAtlas } from '@/engines/worldgen/core/atlas';
import {
  applyEdits,
  type AppliedEdits,
  type WorldEdit,
} from '@/engines/worldgen/core/edits';
import {
  landmarkKey,
  legacyLandmarkKey,
  resolveWorldLandmark,
  resolveWorldLandmarks,
} from '@/engines/worldgen/core/spatialEntities';
import {
  DEFAULT_PARAMS,
  type Landmark,
  type WorldData,
} from '@/engines/worldgen/core/types';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emptyAppliedEdits(): AppliedEdits {
  return {
    terrainChanged: false,
    markers: [],
    labels: [],
    rivers: [],
    renames: {},
    removed: new Set(),
    moves: {},
    styles: {},
    roads: [],
    roadErasers: [],
  };
}

function worldWith(landmark: Landmark, painted?: AppliedEdits): WorldData {
  const width = 32;
  const height = 16;
  const cells = width * height;
  return {
    width,
    height,
    params: { ...DEFAULT_PARAMS, width },
    elevation: new Float32Array(cells),
    plateId: new Uint8Array(cells),
    boundary: new Float32Array(cells),
    temperature: new Float32Array(cells),
    precipitation: new Float32Array(cells),
    biome: new Uint8Array(cells),
    flow: new Float32Array(cells),
    lake: new Uint8Array(cells),
    rivers: [],
    landmarks: [landmark],
    plateInfo: [],
    currentU: new Float32Array(cells),
    currentV: new Float32Array(cells),
    sst: new Float32Array(cells),
    currentSpeed: new Float32Array(cells),
    ice: new Float32Array(cells),
    revision: 0,
    painted,
  };
}

const EMPTY_GEOGRAPHY = {
  settlements: [],
  roads: [],
  realms: [],
  realmOf: new Int32Array(),
  features: [],
  ruins: [],
  landforms: [],
  languages: { languages: [] },
  languageOf: {},
} as unknown as HumanGeography;

export function testWorldgenSpatialEntities(): string {
  const landmark: Landmark = { type: 'volcano', x: 12, y: 6, strength: 0.8 };
  const canonicalKey = landmarkKey(landmark);
  const legacyKey = legacyLandmarkKey(landmark);
  assert(canonicalKey === 'landmark:volcano:12,6', 'landmark did not get its first-class key');
  assert(legacyKey === 'feature:volcano:12,6', 'legacy landmark key changed');

  const legacy = emptyAppliedEdits();
  legacy.renames[legacyKey] = 'Monte Ceniza';
  legacy.moves[legacyKey] = { x: 14, y: 7 };
  legacy.styles[legacyKey] = {
    icon: 'caldera',
    color: '#d1492e',
    size: 1.4,
    labelVisible: true,
  };
  const resolvedLegacy = resolveWorldLandmark(landmark, legacy);
  assert(resolvedLegacy.key === canonicalKey, 'legacy override replaced canonical identity');
  assert(resolvedLegacy.name === 'Monte Ceniza', 'legacy rename was not resolved');
  assert(resolvedLegacy.x === 14 && resolvedLegacy.y === 7, 'legacy move was not resolved');
  assert(resolvedLegacy.sourceX === 12 && resolvedLegacy.sourceY === 6, 'source position was mutated');
  assert(resolvedLegacy.style.icon === 'caldera', 'legacy style was not resolved');
  assert(resolvedLegacy.style.labelVisible, 'legacy label visibility was not resolved');

  legacy.renames[canonicalKey] = 'La Caldera Roja';
  legacy.moves[canonicalKey] = { x: 15, y: 8 };
  legacy.styles[canonicalKey] = { icon: 'volcano', size: 2 };
  const resolvedCanonical = resolveWorldLandmark(landmark, legacy);
  assert(resolvedCanonical.name === 'La Caldera Roja', 'canonical rename did not win over legacy');
  assert(resolvedCanonical.x === 15 && resolvedCanonical.y === 8, 'canonical move did not win over legacy');
  assert(resolvedCanonical.style.icon === 'volcano', 'canonical icon did not win over legacy');
  assert(resolvedCanonical.style.color === '#d1492e', 'partial canonical style discarded legacy fields');

  const atlas = buildAtlas(worldWith(landmark, legacy), EMPTY_GEOGRAPHY);
  const atlasLandmark = atlas.byKey.get(canonicalKey);
  assert(atlasLandmark?.name === 'La Caldera Roja', 'Atlas ignored landmark rename');
  assert(atlasLandmark.x === 15 && atlasLandmark.y === 8, 'Atlas ignored landmark move');
  assert(atlasLandmark.style.size === 2, 'Atlas ignored landmark style');
  assert(atlas.byKey.get(legacyKey) === atlasLandmark, 'Atlas did not alias the legacy key');

  const removed = emptyAppliedEdits();
  removed.removed.add(legacyKey);
  const hiddenWorld = worldWith(landmark, removed);
  assert(resolveWorldLandmarks(hiddenWorld).length === 0, 'legacy removal did not hide landmark');
  const hidden = resolveWorldLandmarks(hiddenWorld, { includeHidden: true });
  assert(hidden.length === 1 && hidden[0].hidden, 'hidden landmark cannot be inspected for restore');
  assert(buildAtlas(hiddenWorld, EMPTY_GEOGRAPHY).places.length === 0, 'Atlas included hidden landmark');

  const replayWorld = worldWith(landmark);
  const edits: WorldEdit[] = [
    { kind: 'rename', target: 'landmark', key: canonicalKey, name: 'Pico Nuevo' },
    { kind: 'move', target: 'landmark', key: canonicalKey, x: 18, y: 9 },
    { kind: 'style', target: 'landmark', key: canonicalKey, style: { color: '#111111' } },
    { kind: 'style', target: 'landmark', key: canonicalKey, style: { size: 1.6 } },
  ];
  const replayed = applyEdits(replayWorld, edits);
  assert(replayed.renames[canonicalKey] === 'Pico Nuevo', 'rename edit did not replay');
  assert(replayed.moves[canonicalKey]?.x === 18, 'move edit did not replay');
  assert(replayed.styles[canonicalKey]?.color === '#111111', 'style edit lost its first patch');
  assert(replayed.styles[canonicalKey]?.size === 1.6, 'style edit did not merge later patch');

  const restored = applyEdits(worldWith(landmark), [
    { kind: 'remove', target: 'feature', key: legacyKey },
    { kind: 'restore', target: 'landmark', key: canonicalKey },
  ]);
  assert(!restored.removed.has(legacyKey), 'canonical restore did not clear legacy removal');
  const removedAgain = applyEdits(worldWith(landmark), [
    { kind: 'remove', target: 'feature', key: legacyKey },
    { kind: 'restore', target: 'landmark', key: canonicalKey },
    { kind: 'remove', target: 'landmark', key: canonicalKey },
  ]);
  assert(resolveWorldLandmark(landmark, removedAgain).hidden, 'later remove did not win over restore');

  return 'Worldgen spatial landmark identity and overrides';
}
