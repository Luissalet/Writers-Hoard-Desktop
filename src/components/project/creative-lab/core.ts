import type {
  ConstraintDeck,
  ConstraintDeckIssue,
  ConstraintDeckLocks,
  ConstraintVerb,
  CreateCreativePossibilityInput,
  CreateDeckPossibilityInput,
  CreativeOperationIssue,
  CreativeOperationRequest,
  CreativePossibility,
  CreativePossibilityGroup,
  CreativePromotionRequest,
  CreativePromotionTarget,
  CreativeSource,
  CreativeSourceCitation,
  DealConstraintDeckInput,
} from './types';
import { getCreativeLabCopy } from './copy';

export const CONSTRAINT_VERBS: readonly ConstraintVerb[] = [
  'combine',
  'remove',
  'invert',
  'make-inevitable',
  'change-who-pays',
];

export const DEFAULT_CONSTRAINT_SOURCE_SLOTS = 2;

function normalise(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function sourceFragment(source: CreativeSource): string {
  const body = normalise(source.excerpt);
  if (!body || body.toLocaleLowerCase() === source.title.toLocaleLowerCase()) {
    return `“${source.title}”`;
  }
  const shortened = body.length > 96 ? `${body.slice(0, 95).trimEnd()}…` : body;
  return `“${source.title}” (${shortened})`;
}

function toCitation(source: CreativeSource): CreativeSourceCitation {
  return {
    kind: source.kind,
    id: source.id,
    projectId: source.projectId,
    title: source.title,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
  };
}

function sharedProjectId(sources: readonly CreativeSource[]): string {
  const projectId = sources[0]?.projectId;
  if (!projectId || sources.some(source => source.projectId !== projectId)) {
    throw new Error('Creative Lab sources must belong to one project');
  }
  return projectId;
}

export function getCreativeOperationIssue(
  request: CreativeOperationRequest,
  sourceCount: number,
): CreativeOperationIssue | null {
  if (sourceCount === 0) return 'select-source';
  if (request.operation === 'combine' && sourceCount < 2) return 'select-two-sources';
  if (request.operation === 'remove' && !normalise(request.element)) return 'missing-remove-element';
  if (request.operation === 'scale' && !normalise(request.scale)) return 'missing-scale';
  if (request.operation === 'relocate' && !normalise(request.place) && !normalise(request.era)) {
    return 'missing-place-or-era';
  }
  if (request.operation === 'pov' && !normalise(request.pointOfView)) return 'missing-pov';
  if (request.operation === 'cost' && !normalise(request.cost)) return 'missing-cost';
  return null;
}

function operationParameters(request: CreativeOperationRequest): Record<string, string> {
  switch (request.operation) {
    case 'combine':
    case 'truth':
      return {};
    case 'invert':
      return normalise(request.focus) ? { focus: normalise(request.focus) } : {};
    case 'remove':
      return { element: normalise(request.element) };
    case 'scale':
      return { scale: normalise(request.scale) };
    case 'relocate':
      return {
        ...(normalise(request.place) ? { place: normalise(request.place) } : {}),
        ...(normalise(request.era) ? { era: normalise(request.era) } : {}),
      };
    case 'pov':
      return { pointOfView: normalise(request.pointOfView) };
    case 'cost':
      return { cost: normalise(request.cost) };
  }
}

export function createCreativePossibility(input: CreateCreativePossibilityInput): CreativePossibility {
  const issue = getCreativeOperationIssue(input.request, input.sources.length);
  if (issue) throw new Error(`Invalid creative operation: ${issue}`);
  const projectId = sharedProjectId(input.sources);
  const parameters = operationParameters(input.request);
  const generation = input.generation ?? getCreativeLabCopy('en').generation;
  const text = generation.operations[input.request.operation]({
    sourceFragments: input.sources.map(sourceFragment),
    parameters,
  });

  return {
    id: input.id,
    projectId,
    title: '',
    text,
    group: '',
    status: 'active',
    provenance: {
      version: 1,
      origin: 'ideas-table',
      move: input.request.operation,
      parameters,
      sources: input.sources.map(toCitation),
      generation: {
        method: 'deterministic',
        templateVersion: 'creative-lab-v1',
        ...(input.generationLocale ? { locale: input.generationLocale } : {}),
      },
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickSource(
  candidates: readonly CreativeSource[],
  seed: number,
  slot: number,
  previousKey: string | null | undefined,
): CreativeSource | undefined {
  if (candidates.length === 0) return undefined;
  const withoutPrevious = candidates.filter(source => source.key !== previousKey);
  const pool = withoutPrevious.length > 0 ? withoutPrevious : candidates;
  return [...pool].sort((left, right) => {
    // Usage is the dominant signal; the hash varies ties and near-ties between
    // reproducible rolls so neglected material remains favoured, not frozen.
    const leftScore = left.usageCount * 100 + stableHash(`${seed}:${slot}:${left.key}`) % 151;
    const rightScore = right.usageCount * 100 + stableHash(`${seed}:${slot}:${right.key}`) % 151;
    return leftScore - rightScore || left.key.localeCompare(right.key);
  })[0];
}

function normalisedLocks(locks: ConstraintDeckLocks | undefined, slots: number): ConstraintDeckLocks {
  return {
    verb: locks?.verb ?? false,
    sourceSlots: Array.from({ length: slots }, (_, index) => locks?.sourceSlots[index] ?? false),
  };
}

export function dealConstraintDeck(input: DealConstraintDeckInput): ConstraintDeck {
  const sourceSlots = Math.max(1, Math.floor(input.sourceSlots ?? DEFAULT_CONSTRAINT_SOURCE_SLOTS));
  const locks = normalisedLocks(input.locks, sourceSlots);
  const sourceByKey = new Map(input.sources.map(source => [source.key, source]));
  const usedKeys = new Set<string>();
  const sourceKeys: Array<string | null> = [];

  for (let slot = 0; slot < sourceSlots; slot += 1) {
    const previousKey = input.previous?.sourceKeys[slot] ?? null;
    const locked = locks.sourceSlots[slot] ? sourceByKey.get(previousKey ?? '') : undefined;
    if (locked && !usedKeys.has(locked.key)) {
      sourceKeys.push(locked.key);
      usedKeys.add(locked.key);
      continue;
    }

    const candidates = input.sources.filter(source => !usedKeys.has(source.key));
    const selected = pickSource(candidates, input.seed, slot, previousKey);
    sourceKeys.push(selected?.key ?? null);
    if (selected) usedKeys.add(selected.key);
  }

  let verb = input.previous?.verb ?? CONSTRAINT_VERBS[0];
  if (!locks.verb || !CONSTRAINT_VERBS.includes(verb)) {
    const start = stableHash(`verb:${input.seed}`) % CONSTRAINT_VERBS.length;
    verb = CONSTRAINT_VERBS[start];
    if (verb === input.previous?.verb && CONSTRAINT_VERBS.length > 1) {
      verb = CONSTRAINT_VERBS[(start + 1) % CONSTRAINT_VERBS.length];
    }
  }

  return { seed: input.seed, verb, sourceKeys };
}

export function createDeckPossibility(input: CreateDeckPossibilityInput): CreativePossibility {
  const sourceByKey = new Map(input.sources.map(source => [source.key, source]));
  const selected = input.deck.sourceKeys
    .map(key => key ? sourceByKey.get(key) : undefined)
    .filter((source): source is CreativeSource => source !== undefined);
  const issue = getConstraintDeckIssue(input.deck, selected.length);
  if (issue) throw new Error(`Invalid constraint deck: ${issue}`);
  const projectId = sharedProjectId(selected);
  const generation = input.generation ?? getCreativeLabCopy('en').generation;
  const text = generation.deck[input.deck.verb]({
    sourceFragments: selected.map(sourceFragment),
    parameters: { deckSeed: String(input.deck.seed) },
  });

  return {
    id: input.id,
    projectId,
    title: '',
    text,
    group: '',
    status: 'active',
    provenance: {
      version: 1,
      origin: 'constraint-deck',
      move: input.deck.verb,
      parameters: { deckSeed: String(input.deck.seed) },
      sources: selected.map(toCitation),
      generation: {
        method: 'deterministic',
        templateVersion: 'creative-lab-v1',
        seed: input.deck.seed,
        ...(input.generationLocale ? { locale: input.generationLocale } : {}),
      },
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function getConstraintDeckIssue(
  deck: Pick<ConstraintDeck, 'verb'>,
  sourceCount: number,
): ConstraintDeckIssue | null {
  if (sourceCount === 0) return 'select-source';
  if (
    sourceCount < 2
    && (deck.verb === 'combine' || deck.verb === 'make-inevitable' || deck.verb === 'change-who-pays')
  ) {
    return 'select-two-sources';
  }
  return null;
}

export function groupCreativePossibilities(
  possibilities: readonly CreativePossibility[],
  status: CreativePossibility['status'],
): CreativePossibilityGroup[] {
  const grouped = new Map<string, CreativePossibility[]>();
  for (const possibility of possibilities) {
    if (possibility.status !== status) continue;
    const label = normalise(possibility.group);
    const key = label.toLocaleLowerCase();
    const rows = grouped.get(key) ?? [];
    rows.push(possibility);
    grouped.set(key, rows);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => {
      if (!left) return 1;
      if (!right) return -1;
      return left.localeCompare(right);
    })
    .map(([id, rows]) => ({ id: id || '__ungrouped__', label: rows[0].group.trim(), possibilities: rows }));
}

export function toggleComparison(
  selectedIds: readonly string[],
  possibilityId: string,
  limit = 2,
): string[] {
  if (selectedIds.includes(possibilityId)) return selectedIds.filter(id => id !== possibilityId);
  const boundedLimit = Math.max(1, Math.floor(limit));
  return [...selectedIds.slice(-(boundedLimit - 1)), possibilityId];
}

export function buildCreativePromotionRequest(
  possibility: CreativePossibility,
  target: CreativePromotionTarget,
): CreativePromotionRequest {
  return {
    version: 1,
    projectId: possibility.projectId,
    target,
    possibilityId: possibility.id,
    title: possibility.title.trim(),
    text: possibility.text.trim(),
    ...(possibility.group.trim() ? { group: possibility.group.trim() } : {}),
    provenance: {
      ...possibility.provenance,
      parameters: { ...possibility.provenance.parameters },
      sources: possibility.provenance.sources.map(source => ({ ...source })),
      generation: { ...possibility.provenance.generation },
    },
  };
}
