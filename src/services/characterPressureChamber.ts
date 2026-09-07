// ============================================================================
// Character Pressure Chamber — deterministic, read-only story exploration
// ============================================================================
//
// This module deliberately has no database dependency. It receives the rows
// already owned by Codex, Relationships and Character Arc, derives questions,
// and returns promotion drafts to a host callback. Generating or closing a
// session therefore cannot mutate canon.

import type { CharacterArc } from '@/engines/character-arc/types';
import type { Relationship } from '@/engines/relationships/types';
import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';
import {
  getCharacterPressureCopy,
  type CharacterPressureChamberCopy,
} from '@/services/characterPressureCopy';
import type { CodexEntry, Relation } from '@/types';

export type CharacterPressureLocale = 'en' | 'es';

export type CharacterPressureDimension =
  | 'objective'
  | 'need'
  | 'fear'
  | 'power'
  | 'debt'
  | 'relationship';

export type CharacterPressureInsightKind =
  | 'question'
  | 'friction'
  | 'alliance'
  | 'decision';

export type CharacterPressurePromotionTarget =
  | 'beat'
  | 'scene'
  | 'relationship-change'
  | 'note';

export interface CharacterPressureSituation {
  situation: string;
  scarceResource?: string;
  timeLimit?: string;
  secret?: string;
  cost?: string;
}

export interface CharacterPressureRequest {
  projectId: string;
  characterIds: readonly string[];
  codexEntries: readonly CodexEntry[];
  characterArcs: readonly CharacterArc[];
  relationships: readonly Relationship[];
  pressure: CharacterPressureSituation;
  locale?: CharacterPressureLocale;
  copy?: CharacterPressureChamberCopy;
}

export type CharacterPressureSourceKind =
  | 'codex-entry'
  | 'character-arc'
  | 'relationship';

export interface CharacterPressureSignal {
  dimension: Exclude<CharacterPressureDimension, 'relationship'>;
  value: string | null;
  confidence: 'explicit' | 'adjacent' | 'missing';
  source?: {
    kind: 'codex-entry' | 'character-arc';
    id: string;
    field: string;
  };
}

export interface CharacterPressureProfile {
  characterId: string;
  name: string;
  signals: Readonly<Record<Exclude<CharacterPressureDimension, 'relationship'>, CharacterPressureSignal>>;
}

export interface CharacterPressureEvidence {
  dimension: CharacterPressureDimension;
  characterId?: string;
  sourceKind?: CharacterPressureSourceKind;
  sourceId?: string;
  field?: string;
  confidence: 'explicit' | 'adjacent' | 'missing';
}

export interface CharacterPressureInsight {
  id: string;
  kind: CharacterPressureInsightKind;
  characterIds: readonly string[];
  prompt: string;
  dimensions: readonly CharacterPressureDimension[];
  evidence: readonly CharacterPressureEvidence[];
  promotionTitles: Readonly<Record<CharacterPressurePromotionTarget, string>>;
}

export interface CharacterPressureSourceVersion {
  kind: CharacterPressureSourceKind;
  id: string;
  updatedAt: number;
}

export interface CharacterPressureProvenance {
  source: 'character-pressure-chamber';
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  characterIds: readonly string[];
  codexEntryIds: readonly string[];
  characterArcIds: readonly string[];
  relationshipIds: readonly string[];
  sourceVersions: readonly CharacterPressureSourceVersion[];
  pressure: Readonly<Required<CharacterPressureSituation>>;
}

export interface CharacterPressureSession {
  id: string;
  projectId: string;
  locale: CharacterPressureLocale;
  copyId: string;
  status: 'hypothesis';
  pressure: Readonly<Required<CharacterPressureSituation>>;
  characters: readonly CharacterPressureProfile[];
  insights: readonly CharacterPressureInsight[];
  provenance: CharacterPressureProvenance;
}

export interface CharacterPressurePromotionDraft<
  TTarget extends CharacterPressurePromotionTarget = CharacterPressurePromotionTarget,
> {
  target: TTarget;
  title: string;
  prompt: string;
  characterIds: readonly string[];
  provenance: CharacterPressureProvenance & {
    resultId: string;
    resultKind: CharacterPressureInsightKind;
    dimensions: readonly CharacterPressureDimension[];
    evidence: readonly CharacterPressureEvidence[];
  };
}

export type CharacterPressureValidationCode =
  | 'project-required'
  | 'character-count'
  | 'duplicate-character'
  | 'character-not-found'
  | 'character-project-mismatch'
  | 'situation-required'
  | 'pressure-required'
  | 'result-not-found'
  | 'target-not-applicable';

export class CharacterPressureValidationError extends Error {
  readonly code: CharacterPressureValidationCode;

  constructor(code: CharacterPressureValidationCode, message: string) {
    super(message);
    this.name = 'CharacterPressureValidationError';
    this.code = code;
  }
}

type SignalDimension = Exclude<CharacterPressureDimension, 'relationship'>;

interface FieldHit {
  key: string;
  value: string;
}

interface PairContext {
  left: CharacterPressureProfile;
  right: CharacterPressureProfile;
  relationships: Relationship[];
  legacyRelations: Array<{ ownerId: string; relation: Relation }>;
}

const FIELD_ALIASES: Record<SignalDimension, readonly string[]> = {
  objective: [
    'objective', 'objectives', 'goal', 'goals', 'want', 'wants', 'desire', 'desires',
    'objetivo', 'objetivos', 'meta', 'metas', 'deseo', 'deseos',
  ],
  need: ['need', 'needs', 'necessity', 'necessities', 'necesidad', 'necesidades'],
  fear: ['fear', 'fears', 'greatestfear', 'miedo', 'miedos', 'temor', 'temores'],
  power: [
    'power', 'powers', 'leverage', 'influence', 'authority',
    'poder', 'poderes', 'ventaja', 'influencia', 'autoridad',
  ],
  debt: [
    'debt', 'debts', 'obligation', 'obligations', 'owed',
    'deuda', 'deudas', 'obligacion', 'obligaciones', 'debe',
  ],
};

const EMPTY_PRESSURE: Required<CharacterPressureSituation> = {
  situation: '',
  scarceResource: '',
  timeLimit: '',
  secret: '',
  cost: '',
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function clip(value: string, length = 180): string {
  const normalized = clean(value);
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, length - 1).trimEnd()}…`;
}

function normalizedFieldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function readField(entry: CodexEntry, aliases: readonly string[]): FieldHit | null {
  const rows = Object.entries(entry.fields)
    .map(([key, value]) => ({ key, normalized: normalizedFieldKey(key), value: clean(value) }))
    .filter((row) => row.value.length > 0)
    .sort((left, right) => compareText(left.key, right.key));
  for (const alias of aliases) {
    const hit = rows.find((row) => row.normalized === alias);
    if (hit) return { key: hit.key, value: clip(hit.value) };
  }
  return null;
}

function explicitSignal(
  dimension: SignalDimension,
  kind: 'codex-entry' | 'character-arc',
  id: string,
  field: string,
  value: string,
): CharacterPressureSignal {
  return {
    dimension,
    value: clip(value),
    confidence: 'explicit',
    source: { kind, id, field },
  };
}

function adjacentSignal(
  dimension: SignalDimension,
  kind: 'codex-entry' | 'character-arc',
  id: string,
  field: string,
  value: string,
): CharacterPressureSignal {
  return {
    dimension,
    value: clip(value),
    confidence: 'adjacent',
    source: { kind, id, field },
  };
}

function missingSignal(dimension: SignalDimension): CharacterPressureSignal {
  return { dimension, value: null, confidence: 'missing' };
}

function newestArcsFor(
  projectId: string,
  characterId: string,
  arcs: readonly CharacterArc[],
): CharacterArc[] {
  return arcs
    .filter((arc) => arc.projectId === projectId && arc.characterId === characterId)
    .sort((left, right) => right.updatedAt - left.updatedAt || compareText(left.id, right.id));
}

function firstArcValue(
  arcs: readonly CharacterArc[],
  field: 'want' | 'need' | 'ghost' | 'lie',
): { arc: CharacterArc; value: string } | null {
  for (const arc of arcs) {
    const value = clean(arc[field]);
    if (value) return { arc, value };
  }
  return null;
}

function buildProfile(
  entry: CodexEntry,
  arcs: readonly CharacterArc[],
): CharacterPressureProfile {
  const objectiveArc = firstArcValue(arcs, 'want');
  const objectiveField = readField(entry, FIELD_ALIASES.objective);
  const needArc = firstArcValue(arcs, 'need');
  const needField = readField(entry, FIELD_ALIASES.need);
  const fearField = readField(entry, FIELD_ALIASES.fear);
  const fearArc = firstArcValue(arcs, 'ghost') ?? firstArcValue(arcs, 'lie');
  const powerField = readField(entry, FIELD_ALIASES.power);
  const abilities = readField(entry, ['abilities', 'ability', 'habilidades', 'habilidad']);
  const role = readField(entry, ['role', 'rol', 'cargo', 'position']);
  const debtField = readField(entry, FIELD_ALIASES.debt);

  return {
    characterId: entry.id,
    name: clean(entry.title) || entry.id,
    signals: {
      objective: objectiveArc
        ? explicitSignal('objective', 'character-arc', objectiveArc.arc.id, 'want', objectiveArc.value)
        : objectiveField
          ? explicitSignal('objective', 'codex-entry', entry.id, objectiveField.key, objectiveField.value)
          : missingSignal('objective'),
      need: needArc
        ? explicitSignal('need', 'character-arc', needArc.arc.id, 'need', needArc.value)
        : needField
          ? explicitSignal('need', 'codex-entry', entry.id, needField.key, needField.value)
          : missingSignal('need'),
      fear: fearField
        ? explicitSignal('fear', 'codex-entry', entry.id, fearField.key, fearField.value)
        : fearArc
          ? adjacentSignal(
              'fear',
              'character-arc',
              fearArc.arc.id,
              clean(fearArc.arc.ghost) ? 'ghost' : 'lie',
              fearArc.value,
            )
          : missingSignal('fear'),
      power: powerField
        ? explicitSignal('power', 'codex-entry', entry.id, powerField.key, powerField.value)
        : abilities
          ? adjacentSignal('power', 'codex-entry', entry.id, abilities.key, abilities.value)
          : role
            ? adjacentSignal('power', 'codex-entry', entry.id, role.key, role.value)
            : missingSignal('power'),
      debt: debtField
        ? explicitSignal('debt', 'codex-entry', entry.id, debtField.key, debtField.value)
        : missingSignal('debt'),
    },
  };
}

function normalizePressure(pressure: CharacterPressureSituation): Required<CharacterPressureSituation> {
  return {
    situation: clean(pressure.situation),
    scarceResource: clean(pressure.scarceResource),
    timeLimit: clean(pressure.timeLimit),
    secret: clean(pressure.secret),
    cost: clean(pressure.cost),
  };
}

function signalText(
  profile: CharacterPressureProfile,
  dimension: SignalDimension,
  copy: CharacterPressureChamberCopy,
): string {
  const value = profile.signals[dimension].value;
  if (value) return `“${value}”`;
  return copy.generation.missing[dimension];
}

function relationshipRowsForPair(
  projectId: string,
  leftId: string,
  rightId: string,
  relationships: readonly Relationship[],
): Relationship[] {
  const stateOrder: Record<Relationship['state'], number> = { current: 0, secret: 1, past: 2 };
  return relationships
    .filter((row) => row.projectId === projectId && (
      (row.entityAId === leftId && row.entityBId === rightId)
      || (row.entityAId === rightId && row.entityBId === leftId)
    ))
    .sort((left, right) =>
      stateOrder[left.state] - stateOrder[right.state]
      || right.updatedAt - left.updatedAt
      || compareText(left.id, right.id),
    );
}

function legacyRelationsForPair(
  left: CodexEntry,
  right: CodexEntry,
): Array<{ ownerId: string; relation: Relation }> {
  const rows = [
    ...left.relations
      .filter((relation) => relation.targetId === right.id)
      .map((relation) => ({ ownerId: left.id, relation })),
    ...right.relations
      .filter((relation) => relation.targetId === left.id)
      .map((relation) => ({ ownerId: right.id, relation })),
  ];
  return rows.sort((a, b) =>
    compareText(a.ownerId, b.ownerId)
    || compareText(a.relation.type, b.relation.type)
    || compareText(a.relation.description ?? '', b.relation.description ?? ''),
  );
}

function relationshipText(pair: PairContext, copy: CharacterPressureChamberCopy): string {
  const row = pair.relationships[0];
  if (row) {
    return copy.generation.recordedRelationship({
      label: clean(row.label),
      kind: row.kind,
      intensity: row.intensity,
      state: row.state,
    });
  }
  const legacy = pair.legacyRelations[0]?.relation;
  if (legacy) {
    return copy.generation.codexRelationship({
      description: clean(legacy.description),
      type: legacy.type,
    });
  }
  return copy.generation.missingRelationship;
}

function pressurePhrase(
  pressure: Required<CharacterPressureSituation>,
  copy: CharacterPressureChamberCopy,
): string {
  const parts = [
    pressure.scarceResource
      && copy.generation.pressurePart.scarceResource(pressure.scarceResource),
    pressure.timeLimit && copy.generation.pressurePart.timeLimit(pressure.timeLimit),
    pressure.secret && copy.generation.pressurePart.secret(pressure.secret),
    pressure.cost && copy.generation.pressurePart.cost(pressure.cost),
  ].filter((part): part is string => Boolean(part));
  return copy.generation.joinPressure(parts);
}

function signalEvidence(
  profile: CharacterPressureProfile,
  dimensions: readonly SignalDimension[],
): CharacterPressureEvidence[] {
  return dimensions.map((dimension) => {
    const signal = profile.signals[dimension];
    return {
      dimension,
      characterId: profile.characterId,
      sourceKind: signal.source?.kind,
      sourceId: signal.source?.id,
      field: signal.source?.field,
      confidence: signal.confidence,
    };
  });
}

function relationshipEvidence(pair: PairContext): CharacterPressureEvidence {
  const row = pair.relationships[0];
  const legacy = pair.legacyRelations[0];
  return {
    dimension: 'relationship',
    sourceKind: row ? 'relationship' : legacy ? 'codex-entry' : undefined,
    sourceId: row?.id ?? legacy?.ownerId,
    field: row ? 'kind/intensity/state' : legacy ? 'relations' : undefined,
    confidence: row || legacy ? 'explicit' : 'missing',
  };
}

function insightId(
  sessionId: string,
  kind: CharacterPressureInsightKind,
  characterIds: readonly string[],
  prompt: string,
): string {
  return `pressure-result:${sha256Hex(canonicalJson({ sessionId, kind, characterIds, prompt }))}`;
}

function buildInsights(
  sessionId: string,
  profiles: readonly CharacterPressureProfile[],
  entries: ReadonlyMap<string, CodexEntry>,
  relationships: readonly Relationship[],
  pressure: Required<CharacterPressureSituation>,
  copy: CharacterPressureChamberCopy,
  projectId: string,
): CharacterPressureInsight[] {
  const insights: CharacterPressureInsight[] = [];
  const add = (
    kind: CharacterPressureInsightKind,
    characters: readonly CharacterPressureProfile[],
    prompt: string,
    dimensions: readonly CharacterPressureDimension[],
    evidence: readonly CharacterPressureEvidence[],
  ): void => {
    const characterIds = characters.map((character) => character.characterId);
    const names = characters.map((character) => character.name).join(' / ');
    insights.push({
      id: insightId(sessionId, kind, characterIds, prompt),
      kind,
      characterIds,
      prompt,
      dimensions,
      evidence,
      promotionTitles: {
        beat: copy.generation.promotionTitle('beat', names),
        scene: copy.generation.promotionTitle('scene', names),
        'relationship-change': copy.generation.promotionTitle('relationship-change', names),
        note: copy.generation.promotionTitle('note', names),
      },
    });
  };

  const context = pressurePhrase(pressure, copy);
  for (const profile of profiles) {
    const prompt = copy.generation.question({
      situation: pressure.situation,
      name: profile.name,
      objective: signalText(profile, 'objective', copy),
      need: signalText(profile, 'need', copy),
      fear: signalText(profile, 'fear', copy),
    });
    add(
      'question',
      [profile],
      prompt,
      ['objective', 'need', 'fear'],
      signalEvidence(profile, ['objective', 'need', 'fear']),
    );
  }

  for (let leftIndex = 0; leftIndex < profiles.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < profiles.length; rightIndex++) {
      const left = profiles[leftIndex];
      const right = profiles[rightIndex];
      const leftEntry = entries.get(left.characterId);
      const rightEntry = entries.get(right.characterId);
      if (!leftEntry || !rightEntry) continue;
      const pair: PairContext = {
        left,
        right,
        relationships: relationshipRowsForPair(
          projectId,
          left.characterId,
          right.characterId,
          relationships,
        ),
        legacyRelations: legacyRelationsForPair(leftEntry, rightEntry),
      };
      const relation = relationshipText(pair, copy);
      const frictionPrompt = copy.generation.friction({
        leftName: left.name,
        leftPower: signalText(left, 'power', copy),
        rightName: right.name,
        rightObjective: signalText(right, 'objective', copy),
        pressure: context,
        relationship: relation,
      });
      add(
        'friction',
        [left, right],
        frictionPrompt,
        ['power', 'objective', 'relationship'],
        [
          ...signalEvidence(left, ['power']),
          ...signalEvidence(right, ['objective']),
          relationshipEvidence(pair),
        ],
      );

      const alliancePrompt = copy.generation.alliance({
        leftName: left.name,
        leftNeed: signalText(left, 'need', copy),
        leftDebt: signalText(left, 'debt', copy),
        rightName: right.name,
        rightNeed: signalText(right, 'need', copy),
        rightDebt: signalText(right, 'debt', copy),
        pressure: context,
        relationship: relation,
      });
      add(
        'alliance',
        [left, right],
        alliancePrompt,
        ['need', 'debt', 'relationship'],
        [
          ...signalEvidence(left, ['need']),
          ...signalEvidence(right, ['need']),
          ...signalEvidence(left, ['debt']),
          ...signalEvidence(right, ['debt']),
          relationshipEvidence(pair),
        ],
      );
    }
  }

  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    const counterpart = profiles[(index + 1) % profiles.length];
    const profileEntry = entries.get(profile.characterId);
    const counterpartEntry = entries.get(counterpart.characterId);
    if (!profileEntry || !counterpartEntry) continue;
    const pair: PairContext = {
      left: profile,
      right: counterpart,
      relationships: relationshipRowsForPair(
        projectId,
        profile.characterId,
        counterpart.characterId,
        relationships,
      ),
      legacyRelations: legacyRelationsForPair(profileEntry, counterpartEntry),
    };
    const relation = relationshipText(pair, copy);
    const prompt = copy.generation.decision({
      name: profile.name,
      objective: signalText(profile, 'objective', copy),
      need: signalText(profile, 'need', copy),
      fear: signalText(profile, 'fear', copy),
      power: signalText(profile, 'power', copy),
      debt: signalText(profile, 'debt', copy),
      pressure: context,
      relationship: relation,
    });
    add(
      'decision',
      [profile, counterpart],
      prompt,
      ['objective', 'need', 'fear', 'power', 'debt', 'relationship'],
      [
        ...signalEvidence(profile, ['objective', 'need', 'fear', 'power', 'debt']),
        relationshipEvidence(pair),
      ],
    );
  }

  return insights;
}

function sourceVersions(
  entries: readonly CodexEntry[],
  arcs: readonly CharacterArc[],
  relationships: readonly Relationship[],
): CharacterPressureSourceVersion[] {
  return [
    ...entries.map((row) => ({
      kind: 'codex-entry' as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
    ...arcs.map((row) => ({
      kind: 'character-arc' as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
    ...relationships.map((row) => ({
      kind: 'relationship' as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
  ].sort((left, right) =>
    compareText(left.kind, right.kind) || compareText(left.id, right.id),
  );
}

/** Build a stable set of possibilities from existing rows without writing them. */
export function buildCharacterPressureSession(
  request: CharacterPressureRequest,
): CharacterPressureSession {
  const projectId = clean(request.projectId);
  if (!projectId) {
    throw new CharacterPressureValidationError('project-required', 'A project is required');
  }
  if (request.characterIds.length < 2 || request.characterIds.length > 4) {
    throw new CharacterPressureValidationError(
      'character-count',
      'Select between two and four characters',
    );
  }
  const uniqueIds = [...new Set(request.characterIds)];
  if (uniqueIds.length !== request.characterIds.length) {
    throw new CharacterPressureValidationError(
      'duplicate-character',
      'Each selected character must be unique',
    );
  }

  const allEntries = new Map(request.codexEntries.map((entry) => [entry.id, entry]));
  const selectedEntries = uniqueIds.map((id) => {
    const entry = allEntries.get(id);
    if (!entry || entry.type !== 'character') {
      throw new CharacterPressureValidationError(
        'character-not-found',
        `Selected character not found: ${id}`,
      );
    }
    if (entry.projectId !== projectId) {
      throw new CharacterPressureValidationError(
        'character-project-mismatch',
        `Selected character belongs to another project: ${id}`,
      );
    }
    return entry;
  }).sort((left, right) =>
    compareText(clean(left.title).toLowerCase(), clean(right.title).toLowerCase())
    || compareText(left.id, right.id),
  );

  const pressure = normalizePressure(request.pressure);
  if (!pressure.situation) {
    throw new CharacterPressureValidationError(
      'situation-required',
      'Describe the situation before running the chamber',
    );
  }
  if (!pressure.scarceResource && !pressure.timeLimit && !pressure.secret && !pressure.cost) {
    throw new CharacterPressureValidationError(
      'pressure-required',
      'Add at least one source of pressure',
    );
  }

  const selectedIdSet = new Set(selectedEntries.map((entry) => entry.id));
  const relevantArcs = request.characterArcs
    .filter((arc) => arc.projectId === projectId && arc.characterId && selectedIdSet.has(arc.characterId))
    .sort((left, right) => compareText(left.id, right.id));
  const relevantRelationships = request.relationships
    .filter((row) => row.projectId === projectId
      && selectedIdSet.has(row.entityAId)
      && selectedIdSet.has(row.entityBId))
    .sort((left, right) => compareText(left.id, right.id));
  const profiles = selectedEntries.map((entry) => buildProfile(
    entry,
    newestArcsFor(projectId, entry.id, relevantArcs),
  ));
  const versions = sourceVersions(selectedEntries, relevantArcs, relevantRelationships);
  const locale = request.locale ?? 'en';
  const copy = request.copy ?? getCharacterPressureCopy(locale);
  const fingerprint = sha256Hex(canonicalJson({
    projectId,
    locale,
    copyId: copy.id,
    pressure,
    profiles,
    relationshipRows: relevantRelationships.map((row) => ({
      id: row.id,
      entityAId: row.entityAId,
      entityBId: row.entityBId,
      kind: row.kind,
      intensity: row.intensity,
      label: row.label,
      notes: row.notes,
      state: row.state,
      directional: row.directional,
      updatedAt: row.updatedAt,
    })),
    legacyRelations: selectedEntries.map((entry) => ({
      id: entry.id,
      relations: entry.relations,
    })),
    versions,
  }));
  const id = `pressure-session:${fingerprint}`;
  const entries = new Map(selectedEntries.map((entry) => [entry.id, entry]));
  const insights = buildInsights(
    id,
    profiles,
    entries,
    relevantRelationships,
    pressure,
    copy,
    projectId,
  );
  const provenance: CharacterPressureProvenance = {
    source: 'character-pressure-chamber',
    schemaVersion: 1,
    sessionId: id,
    projectId,
    characterIds: profiles.map((profile) => profile.characterId),
    codexEntryIds: selectedEntries.map((entry) => entry.id),
    characterArcIds: relevantArcs.map((arc) => arc.id),
    relationshipIds: relevantRelationships.map((row) => row.id),
    sourceVersions: versions,
    pressure,
  };

  return {
    id,
    projectId,
    locale,
    copyId: copy.id,
    status: 'hypothesis',
    pressure,
    characters: profiles,
    insights,
    provenance,
  };
}

/**
 * Convert one possibility into a host-owned draft. This still performs no
 * write: only the callback chosen by the embedding surface may persist it.
 */
export function createCharacterPressurePromotionDraft<
  TTarget extends CharacterPressurePromotionTarget,
>(
  session: CharacterPressureSession,
  resultId: string,
  target: TTarget,
): CharacterPressurePromotionDraft<TTarget> {
  const insight = session.insights.find((row) => row.id === resultId);
  if (!insight) {
    throw new CharacterPressureValidationError('result-not-found', 'Pressure result not found');
  }
  if (target === 'relationship-change' && insight.characterIds.length < 2) {
    throw new CharacterPressureValidationError(
      'target-not-applicable',
      'A relationship change requires a result involving two characters',
    );
  }
  return {
    target,
    title: insight.promotionTitles[target],
    prompt: insight.prompt,
    characterIds: [...insight.characterIds],
    provenance: {
      ...session.provenance,
      characterIds: [...session.provenance.characterIds],
      codexEntryIds: [...session.provenance.codexEntryIds],
      characterArcIds: [...session.provenance.characterArcIds],
      relationshipIds: [...session.provenance.relationshipIds],
      sourceVersions: session.provenance.sourceVersions.map((row) => ({ ...row })),
      pressure: { ...EMPTY_PRESSURE, ...session.provenance.pressure },
      resultId: insight.id,
      resultKind: insight.kind,
      dimensions: [...insight.dimensions],
      evidence: insight.evidence.map((row) => ({ ...row })),
    },
  };
}
