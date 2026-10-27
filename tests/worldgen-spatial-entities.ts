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
    stamps: [],
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

/** Explicit generated-branch fixture; this does not run procedural generation. */
export async function testWorldgenSpatialEntityDomainIdentity(): Promise<string> {
  const { captureDomainCatalogue } = await import('@/engines/worldgen/core/domainCatalogue');
  const {
    adoptDomainDocument, appendDomainEdits, appendDomainResize,
    readDomainDocument, serializeDomainDocument,
  } = await import('@/engines/worldgen/core/domainDocument');
  const { replayDomain } = await import('@/engines/worldgen/core/domainReplay');
  const { resizeBounds, validWorldDomain } = await import('@/engines/worldgen/core/worldDomain');
  const { serializeEdits } = await import('@/engines/worldgen/core/edits');

  const source = worldWith({ type: 'volcano', x: 20, y: 6, strength: 0.8 });
  const legacy = serializeEdits([]);
  const catalogue = captureDomainCatalogue(source, EMPTY_GEOGRAPHY, legacy);
  const boundsA = { x: 16, y: 0, width: 16, height: 16 };
  const adopted = adoptDomainDocument(source, legacy, catalogue, boundsA);
  const document = readDomainDocument(serializeDomainDocument(adopted));
  assert(document, 'adopted domain journal did not round-trip');
  const canonical = 'landmark:volcano:20,6';
  const alias = 'feature:volcano:20,6';
  assert(catalogue.entries.some(entry => entry.kind === 'landmark' && entry.key === canonical),
    'adoption catalogue did not retain source landmark identity');

  const first = replayDomain(source, document, 0);
  assert(validWorldDomain(first.domain, first.params, first.width, first.height),
    'adoption helper did not produce valid domain metadata');
  assert(first.landmarks.length === 1 && !(first.painted?.markers.length),
    'fixture did not isolate the generated-landmark branch');
  const firstEntities = resolveWorldLandmarks(first);
  assert(firstEntities.length === 1, 'generated landmark missing from finite domain');
  const initial = firstEntities[0];
  assert(initial.key === canonical && initial.legacyKeys.includes(alias),
    'finite generated landmark identity did not include absolute source origin');
  assert(initial.x === 4 && initial.y === 6 && initial.sourceX === 4 && initial.sourceY === 6,
    'finite generated landmark did not retain local presentation/source coordinates');
  const firstAtlas = buildAtlas(first, EMPTY_GEOGRAPHY);
  assert(firstAtlas.byKey.get(canonical) === firstAtlas.byKey.get(alias)
    && firstAtlas.byKey.get(canonical)?.key === canonical,
  'finite Atlas did not resolve canonical and historical absolute identities together');
  assert(!firstAtlas.byKey.has('landmark:volcano:4,6'),
    'finite Atlas invented an ambiguous local canonical alias');

  const aliasDocument = appendDomainEdits(document, [
    { kind: 'rename', target: 'feature', key: alias, name: 'Monte Ceniza' },
    { kind: 'move', target: 'feature', key: alias, x: 22, y: 7 },
    { kind: 'style', target: 'feature', key: alias,
      style: { icon: 'caldera', color: '#d1492e', size: 1.4, labelVisible: true } },
  ]);
  const aliasWorld = replayDomain(source, aliasDocument, 1);
  const aliasEntity = resolveWorldLandmarks(aliasWorld)[0];
  assert(aliasEntity?.key === canonical && aliasEntity.name === 'Monte Ceniza',
    'finite historical alias rename did not resolve to source identity');
  assert(aliasEntity.x === 6 && aliasEntity.y === 7 && aliasEntity.sourceX === 4 && aliasEntity.sourceY === 6,
    'finite historical move was not projected once or moved source coordinates');
  assert(aliasEntity.style.icon === 'caldera' && aliasEntity.style.color === '#d1492e'
    && aliasEntity.style.size === 1.4 && aliasEntity.style.labelVisible,
  'finite historical alias style was not applied');

  const correctedDocument = appendDomainEdits(aliasDocument, [
    { kind: 'rename', target: 'landmark', key: canonical, name: 'La Caldera Roja' },
    { kind: 'move', target: 'landmark', key: canonical, x: 23, y: 8 },
    { kind: 'style', target: 'landmark', key: canonical, style: { icon: 'volcano', size: 2 } },
  ]);
  const corrected = replayDomain(source, correctedDocument, 2);
  const resolved = resolveWorldLandmarks(corrected)[0];
  assert(resolved?.key === canonical && resolved.name === 'La Caldera Roja'
    && resolved.x === 7 && resolved.y === 8,
  'canonical finite rename/move did not win over historical alias');
  assert(resolved.sourceX === 4 && resolved.sourceY === 6
    && resolved.style.icon === 'volcano' && resolved.style.size === 2
    && resolved.style.color === '#d1492e' && resolved.style.labelVisible,
  'canonical finite style precedence lost inherited fields or moved source coordinates');
  const correctedAtlas = buildAtlas(corrected, EMPTY_GEOGRAPHY);
  assert(correctedAtlas.byKey.get(canonical)?.name === 'La Caldera Roja'
    && correctedAtlas.byKey.get(alias) === correctedAtlas.byKey.get(canonical)
    && correctedAtlas.byKey.get(canonical)?.x === 7,
  'finite Atlas ignored resolved rename/move or historical alias');

  const boundsB = resizeBounds(boundsA, 24, 16, 'east');
  assert(boundsB.x === 8 && boundsB.y === 0, 'second finite frame is not discriminating');
  const resizedDocument = appendDomainResize(correctedDocument, boundsB, 'east', 'sea', 0);
  const resized = replayDomain(source, resizedDocument, 3);
  assert(validWorldDomain(resized.domain, resized.params, resized.width, resized.height),
    'resized fixture domain metadata is invalid');
  const resizedEntity = resolveWorldLandmarks(resized)[0];
  assert(resizedEntity?.key === canonical && resizedEntity.legacyKeys.includes(alias)
    && resizedEntity.name === 'La Caldera Roja',
  'second bounds changed generated landmark source identity or prose');
  assert(resizedEntity.x === 15 && resizedEntity.y === 8
    && resizedEntity.sourceX === 12 && resizedEntity.sourceY === 6,
  'second bounds did not reproject presentation and unmoved source coordinates once');
  assert(resizedEntity.style.icon === 'volcano' && resizedEntity.style.size === 2
    && resizedEntity.style.color === '#d1492e', 'second bounds lost sparse style precedence');
  const resizedAtlas = buildAtlas(resized, EMPTY_GEOGRAPHY);
  assert(resizedAtlas.byKey.get(alias) === resizedAtlas.byKey.get(canonical)
    && resizedAtlas.byKey.get(canonical)?.x === 15
    && !resizedAtlas.byKey.has('landmark:volcano:12,6'),
  'second Atlas frame changed identity or invented a local alias');

  const removedDocument = appendDomainEdits(correctedDocument, [
    { kind: 'remove', target: 'feature', key: alias },
  ]);
  const removed = replayDomain(source, removedDocument, 4);
  assert(resolveWorldLandmarks(removed).length === 0,
    'finite historical alias removal did not hide landmark');
  const hidden = resolveWorldLandmarks(removed, { includeHidden: true });
  assert(hidden.length === 1 && hidden[0].hidden && hidden[0].key === canonical,
    'finite hidden inspector lost absolute source identity');
  assert(!buildAtlas(removed, EMPTY_GEOGRAPHY).byKey.has(canonical),
    'finite Atlas included a removed landmark');
  const restoredDocument = appendDomainEdits(removedDocument, [
    { kind: 'restore', target: 'landmark', key: canonical },
  ]);
  const restored = replayDomain(source, restoredDocument, 5);
  assert(resolveWorldLandmarks(restored)[0]?.name === 'La Caldera Roja',
    'finite canonical restore did not clear historical removal and retain prose');
  const removedAgain = replayDomain(source, appendDomainEdits(restoredDocument, [
    { kind: 'remove', target: 'landmark', key: canonical },
  ]), 6);
  assert(resolveWorldLandmarks(removedAgain).length === 0,
    'later finite canonical removal did not win over restore');

  return 'Explicit generated landmark fixture: adopted finite identity, overrides and two bounds';
}
