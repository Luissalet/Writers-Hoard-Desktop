import type { BoardEdge, BoardEndpoint, BoardNode } from '@/engines/board/types';
import type { Payoff, Seed } from '@/engines/seeds/types';
import type { TimelineConnection, TimelineEvent } from '@/types';
import type { EntityLink } from '@/types/projectTools';

export const CAUSAL_RELATION_KINDS = [
  'cause',
  'consequence',
  'obstacle',
  'enables',
  'contradicts',
  'cost',
  'hypothesis',
] as const;

export type CausalRelationKind = (typeof CAUSAL_RELATION_KINDS)[number];
export type CausalCanonState = 'canon' | 'hypothesis' | 'discarded';
export type CausalNecessity = 'necessary' | 'possible';

/**
 * Additive payload stored on the existing `entityLinks` row. Dexie does not
 * require a schema change for non-indexed fields, so causal assertions remain
 * part of the one canonical cross-engine link store.
 */
export interface CausalLinkMetadata {
  version: 1;
  certainty: number;
  canonState: CausalCanonState;
  necessity: CausalNecessity;
  deliberateCoincidence?: boolean;
}

export interface CausalEntityLink extends EntityLink {
  causal: CausalLinkMetadata;
}

export interface CausalEntityReference {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
}

export type CausalRelationOriginKind =
  | 'entity-link'
  | 'board-edge'
  | 'seed-payoff'
  | 'timeline-connection';

export interface CausalRelation {
  id: string;
  projectId: string;
  kind: CausalRelationKind;
  source: CausalEntityReference;
  target: CausalEntityReference;
  certainty: number;
  canonState: CausalCanonState;
  necessity: CausalNecessity;
  deliberateCoincidence: boolean;
  notes?: string;
  origin: {
    kind: CausalRelationOriginKind;
    id: string;
  };
}

export interface CausalRelationDraft {
  id?: string;
  projectId: string;
  kind: CausalRelationKind;
  source: CausalEntityReference;
  target: CausalEntityReference;
  certainty: number;
  canonState: CausalCanonState;
  necessity: CausalNecessity;
  deliberateCoincidence?: boolean;
  notes?: string;
}

export type CausalFindingKind =
  | 'missing-cause'
  | 'dangling-consequence'
  | 'coincidence-stack'
  | 'vanishing-cost';

export interface CausalFinding {
  id: string;
  kind: CausalFindingKind;
  nodeKey: string;
  relationIds: string[];
  count: number;
}

export interface CausalGraphNode {
  key: string;
  ref: CausalEntityReference;
  incomingRelationIds: string[];
  outgoingRelationIds: string[];
  /** Directed consequence distance from the selected source. */
  depth: number | null;
  role: 'root' | 'direct' | 'indirect' | 'context';
}

export interface CausalGraph {
  projectId: string;
  rootKey: string;
  nodes: CausalGraphNode[];
  relations: CausalRelation[];
  becauseRelationIds: string[];
  thereforeRelationIds: string[];
  butRelationIds: string[];
  directConsequenceKeys: string[];
  indirectConsequences: Array<{ depth: number; nodeKeys: string[]; relationIds: string[] }>;
  findings: CausalFinding[];
  counts: {
    canon: number;
    hypotheses: number;
    discarded: number;
    unresolved: number;
  };
  truncatedRelationCount: number;
}

export interface BuildCausalGraphOptions {
  projectId: string;
  root: CausalEntityReference;
  relations: readonly CausalRelation[];
  maxDepth?: number;
  maxNodes?: number;
}

const CAUSAL_KIND_SET = new Set<string>(CAUSAL_RELATION_KINDS);
const EFFECT_KINDS = new Set<CausalRelationKind>([
  'cause',
  'consequence',
  'enables',
  'cost',
  'hypothesis',
]);
const SUPPORT_KINDS = new Set<CausalRelationKind>([
  'cause',
  'consequence',
  'enables',
  'hypothesis',
]);
const BUT_KINDS = new Set<CausalRelationKind>(['obstacle', 'contradicts', 'cost']);

const CAUSAL_KIND_ALIASES: Readonly<Record<string, CausalRelationKind>> = Object.freeze({
  cause: 'cause',
  causes: 'cause',
  causa: 'cause',
  consequence: 'consequence',
  consequences: 'consequence',
  consecuencia: 'consequence',
  consecuencias: 'consequence',
  'leads-to': 'consequence',
  therefore: 'consequence',
  'por-tanto': 'consequence',
  obstacle: 'obstacle',
  obstacles: 'obstacle',
  obstaculo: 'obstacle',
  obstaculos: 'obstacle',
  block: 'obstacle',
  blocks: 'obstacle',
  enables: 'enables',
  enable: 'enables',
  habilita: 'enables',
  contradice: 'contradicts',
  contradicen: 'contradicts',
  contradicts: 'contradicts',
  contradiction: 'contradicts',
  contradiccion: 'contradicts',
  cost: 'cost',
  costs: 'cost',
  coste: 'cost',
  costes: 'cost',
  hypothesis: 'hypothesis',
  hypotheses: 'hypothesis',
  hipotesis: 'hypothesis',
});

function normalizedToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function normalizeCausalRelationKind(value: unknown): CausalRelationKind | null {
  if (typeof value !== 'string') return null;
  const token = normalizedToken(value);
  return CAUSAL_KIND_ALIASES[token] ?? (CAUSAL_KIND_SET.has(token) ? token as CausalRelationKind : null);
}

export function causalEntityKey(ref: Pick<CausalEntityReference, 'engineId' | 'entityId'>): string {
  return `${ref.engineId}:${ref.entityId}`;
}

function certaintyOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function isCanonState(value: unknown): value is CausalCanonState {
  return value === 'canon' || value === 'hypothesis' || value === 'discarded';
}

function isNecessity(value: unknown): value is CausalNecessity {
  return value === 'necessary' || value === 'possible';
}

function causalMetadataOf(link: EntityLink): CausalLinkMetadata | null {
  const value = (link as Partial<CausalEntityLink>).causal;
  if (!value || typeof value !== 'object' || value.version !== 1) return null;
  return {
    version: 1,
    certainty: certaintyOf(value.certainty, 0.5),
    canonState: isCanonState(value.canonState) ? value.canonState : 'hypothesis',
    necessity: isNecessity(value.necessity) ? value.necessity : 'possible',
    deliberateCoincidence: value.deliberateCoincidence === true || undefined,
  };
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function materializeCausalEntityLink(
  draft: CausalRelationDraft,
  identity: { id: string; now: number; createdAt?: number },
): CausalEntityLink {
  if (!CAUSAL_KIND_SET.has(draft.kind)) throw new Error('unsupported causal relation kind');
  if (!isCanonState(draft.canonState)) throw new Error('invalid canonical state');
  if (!isNecessity(draft.necessity)) throw new Error('invalid causal necessity');
  assertNonEmpty(identity.id, 'id');
  if (!Number.isFinite(identity.now)) throw new Error('updatedAt must be finite');
  const source = {
    ...draft.source,
    engineId: assertNonEmpty(draft.source.engineId, 'source.engineId'),
    entityType: assertNonEmpty(draft.source.entityType, 'source.entityType'),
    entityId: assertNonEmpty(draft.source.entityId, 'source.entityId'),
    title: assertNonEmpty(draft.source.title, 'source.title'),
  };
  const target = {
    ...draft.target,
    engineId: assertNonEmpty(draft.target.engineId, 'target.engineId'),
    entityType: assertNonEmpty(draft.target.entityType, 'target.entityType'),
    entityId: assertNonEmpty(draft.target.entityId, 'target.entityId'),
    title: assertNonEmpty(draft.target.title, 'target.title'),
  };
  if (causalEntityKey(source) === causalEntityKey(target)) {
    throw new Error('a causal relation requires two different entities');
  }
  if (!Number.isFinite(draft.certainty) || draft.certainty < 0 || draft.certainty > 1) {
    throw new Error('certainty must be between 0 and 1');
  }

  return {
    id: identity.id,
    projectId: assertNonEmpty(draft.projectId, 'projectId'),
    sourceEngineId: source.engineId,
    sourceEntityType: source.entityType,
    sourceEntityId: source.entityId,
    sourceTitle: source.title,
    targetEngineId: target.engineId,
    targetEntityType: target.entityType,
    targetEntityId: target.entityId,
    targetTitle: target.title,
    relation: draft.kind,
    notes: draft.notes?.trim() || undefined,
    provenance: 'manual',
    causal: {
      version: 1,
      certainty: draft.certainty,
      canonState: draft.canonState,
      necessity: draft.necessity,
      deliberateCoincidence: draft.deliberateCoincidence || undefined,
    },
    createdAt: identity.createdAt ?? identity.now,
    updatedAt: identity.now,
  };
}

export function causalRelationFromEntityLink(link: EntityLink): CausalRelation | null {
  const kind = normalizeCausalRelationKind(link.relation);
  if (!kind) return null;
  const metadata = causalMetadataOf(link);
  const canonState = metadata?.canonState ?? 'hypothesis';
  return {
    id: `entity-link:${link.id}`,
    projectId: link.projectId,
    kind,
    source: {
      engineId: link.sourceEngineId,
      entityType: link.sourceEntityType,
      entityId: link.sourceEntityId,
      title: link.sourceTitle,
    },
    target: {
      engineId: link.targetEngineId,
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      title: link.targetTitle,
    },
    certainty: metadata?.certainty ?? 0.5,
    canonState,
    necessity: metadata?.necessity ?? 'possible',
    deliberateCoincidence: metadata?.deliberateCoincidence === true,
    notes: link.notes,
    origin: { kind: 'entity-link', id: link.id },
  };
}

function boardNodeReference(node: BoardNode): CausalEntityReference {
  if (node.ref && !node.ref.missing) {
    return {
      engineId: node.ref.engineId,
      entityType: node.ref.entityType,
      entityId: node.ref.entityId,
      title: node.ref.title || node.title || node.id,
      subtitle: node.ref.subtitle,
    };
  }
  return {
    engineId: 'board',
    entityType: 'board-node',
    entityId: node.id,
    title: node.title || node.ref?.title || node.content.slice(0, 80) || node.id,
    subtitle: node.role ?? node.kind,
  };
}

function nodeEndpoints(
  endpoints: readonly BoardEndpoint[],
  fallbackId: string,
  nodes: ReadonlyMap<string, BoardNode>,
): CausalEntityReference[] {
  const selected = endpoints.length ? endpoints : [{ id: fallbackId, on: 'node' as const }];
  return selected.flatMap((endpoint) => {
    if (endpoint.on !== 'node') return [];
    const node = nodes.get(endpoint.id);
    return node ? [boardNodeReference(node)] : [];
  });
}

export function causalRelationsFromBoard(
  projectId: string,
  boardNodes: readonly BoardNode[],
  boardEdges: readonly BoardEdge[],
): CausalRelation[] {
  const nodes = new Map(
    boardNodes.filter((node) => node.projectId === projectId).map((node) => [node.id, node]),
  );
  const relations: CausalRelation[] = [];

  for (const edge of boardEdges) {
    if (edge.projectId !== projectId || edge.direction === 'none') continue;
    const kind = normalizeCausalRelationKind(edge.kind);
    if (!kind) continue;
    const sources = nodeEndpoints(edge.sources ?? [], edge.sourceId, nodes);
    const targets = nodeEndpoints(edge.targets ?? [], edge.targetId, nodes);
    const pairs: Array<{ source: CausalEntityReference; target: CausalEntityReference; suffix: string }> = [];
    for (const source of sources) {
      for (const target of targets) pairs.push({ source, target, suffix: 'forward' });
    }
    if (edge.direction === 'backward') {
      for (const pair of pairs) [pair.source, pair.target] = [pair.target, pair.source];
    } else if (edge.direction === 'both') {
      pairs.push(...pairs.map((pair) => ({
        source: pair.target,
        target: pair.source,
        suffix: 'reverse',
      })));
    }
    for (const pair of pairs) {
      if (causalEntityKey(pair.source) === causalEntityKey(pair.target)) continue;
      const certainty = certaintyOf(edge.certainty, 0.5);
      relations.push({
        id: `board-edge:${edge.id}:${pair.suffix}:${causalEntityKey(pair.source)}:${causalEntityKey(pair.target)}`,
        projectId,
        kind,
        source: pair.source,
        target: pair.target,
        certainty,
        // Board has confidence but no canon-status field. Never silently turn
        // even a fully opaque line into a canonical story fact.
        canonState: 'hypothesis',
        necessity: 'possible',
        deliberateCoincidence: false,
        notes: edge.notes,
        origin: { kind: 'board-edge', id: edge.id },
      });
    }
  }
  return relations;
}

export function causalRelationsFromSeeds(
  projectId: string,
  seeds: readonly Seed[],
  payoffs: readonly Payoff[],
): CausalRelation[] {
  const seedById = new Map(
    seeds.filter((seed) => seed.projectId === projectId).map((seed) => [seed.id, seed]),
  );
  return payoffs.flatMap((payoff): CausalRelation[] => {
    if (payoff.projectId !== projectId) return [];
    const seed = seedById.get(payoff.seedId);
    if (!seed) return [];
    const discarded = seed.status === 'cut';
    return [{
      id: `seed-payoff:${payoff.id}`,
      projectId,
      kind: 'consequence',
      source: {
        engineId: 'seeds',
        entityType: 'seed',
        entityId: seed.id,
        title: seed.title,
        subtitle: seed.locationLabel,
      },
      target: {
        engineId: 'seeds',
        entityType: 'payoff',
        entityId: payoff.id,
        title: payoff.title,
        subtitle: payoff.locationLabel,
      },
      certainty: discarded ? 0 : 1,
      canonState: discarded ? 'discarded' : 'canon',
      necessity: 'necessary',
      deliberateCoincidence: false,
      origin: { kind: 'seed-payoff', id: payoff.id },
    }];
  });
}

export function causalRelationsFromTimeline(
  projectId: string,
  events: readonly TimelineEvent[],
  connections: readonly TimelineConnection[],
): CausalRelation[] {
  const eventById = new Map(
    events.filter((event) => event.projectId === projectId).map((event) => [event.id, event]),
  );
  return connections.flatMap((connection): CausalRelation[] => {
    if (connection.projectId !== projectId) return [];
    const kind = normalizeCausalRelationKind(connection.label);
    const source = eventById.get(connection.sourceEventId);
    const target = eventById.get(connection.targetEventId);
    // Timeline also stores chronology and time-travel jumps. Unknown labels
    // are deliberately omitted instead of being promoted to causal fact.
    if (!kind || !source || !target) return [];
    return [{
      id: `timeline-connection:${connection.id}`,
      projectId,
      kind,
      source: {
        engineId: 'timeline',
        entityType: 'timeline-event',
        entityId: source.id,
        title: source.title,
        subtitle: source.date,
      },
      target: {
        engineId: 'timeline',
        entityType: 'timeline-event',
        entityId: target.id,
        title: target.title,
        subtitle: target.date,
      },
      certainty: kind === 'hypothesis' ? 0.5 : 0.75,
      canonState: 'hypothesis',
      necessity: 'possible',
      deliberateCoincidence: false,
      notes: connection.label,
      origin: { kind: 'timeline-connection', id: connection.id },
    }];
  });
}

const ORIGIN_PRIORITY: Readonly<Record<CausalRelationOriginKind, number>> = {
  'entity-link': 4,
  'seed-payoff': 3,
  'board-edge': 2,
  'timeline-connection': 1,
};

/** Prefer the explicit canonical link when the same assertion appears in a derived source. */
export function mergeCausalRelations(...groups: readonly CausalRelation[][]): CausalRelation[] {
  const bySignature = new Map<string, CausalRelation>();
  for (const relation of groups.flat()) {
    const signature = [
      relation.projectId,
      causalEntityKey(relation.source),
      relation.kind,
      causalEntityKey(relation.target),
    ].join('|');
    const current = bySignature.get(signature);
    if (!current || ORIGIN_PRIORITY[relation.origin.kind] > ORIGIN_PRIORITY[current.origin.kind]) {
      bySignature.set(signature, relation);
    }
  }
  return [...bySignature.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function relationMap(relations: readonly CausalRelation[]): Map<string, CausalRelation> {
  return new Map(relations.map((relation) => [relation.id, relation]));
}

function deriveFindings(
  rootKey: string,
  nodes: readonly CausalGraphNode[],
  relations: readonly CausalRelation[],
): CausalFinding[] {
  const active = relations.filter((relation) => relation.canonState !== 'discarded');
  const incoming = new Map<string, CausalRelation[]>();
  const outgoing = new Map<string, CausalRelation[]>();
  for (const relation of active) {
    const sourceKey = causalEntityKey(relation.source);
    const targetKey = causalEntityKey(relation.target);
    outgoing.set(sourceKey, [...(outgoing.get(sourceKey) ?? []), relation]);
    incoming.set(targetKey, [...(incoming.get(targetKey) ?? []), relation]);
  }

  const findings: CausalFinding[] = [];
  for (const node of nodes) {
    const inRelations = incoming.get(node.key) ?? [];
    const outRelations = outgoing.get(node.key) ?? [];
    const inboundSupport = inRelations.filter((relation) => SUPPORT_KINDS.has(relation.kind));
    const outboundEffects = outRelations.filter((relation) => EFFECT_KINDS.has(relation.kind));

    if (node.key !== rootKey && outboundEffects.length > 0 && inboundSupport.length === 0) {
      findings.push({
        id: `missing-cause:${node.key}`,
        kind: 'missing-cause',
        nodeKey: node.key,
        relationIds: uniqueSorted(outboundEffects.map((relation) => relation.id)),
        count: outboundEffects.length,
      });
    }

    const incomingConsequences = inRelations.filter(
      (relation) => relation.kind === 'cause' || relation.kind === 'consequence' || relation.kind === 'hypothesis',
    );
    if (node.key !== rootKey && incomingConsequences.length > 0 && outRelations.length === 0) {
      findings.push({
        id: `dangling-consequence:${node.key}`,
        kind: 'dangling-consequence',
        nodeKey: node.key,
        relationIds: uniqueSorted(incomingConsequences.map((relation) => relation.id)),
        count: incomingConsequences.length,
      });
    }

    const uncertainInputs = inboundSupport.filter(
      (relation) => !relation.deliberateCoincidence
        && (relation.canonState === 'hypothesis' || relation.certainty < 0.75),
    );
    if (uncertainInputs.length >= 2) {
      findings.push({
        id: `coincidence-stack:${node.key}`,
        kind: 'coincidence-stack',
        nodeKey: node.key,
        relationIds: uniqueSorted(uncertainInputs.map((relation) => relation.id)),
        count: uncertainInputs.length,
      });
    }

    const incomingCosts = inRelations.filter((relation) => relation.kind === 'cost');
    if (incomingCosts.length > 0 && outboundEffects.length === 0) {
      findings.push({
        id: `vanishing-cost:${node.key}`,
        kind: 'vanishing-cost',
        nodeKey: node.key,
        relationIds: uniqueSorted(incomingCosts.map((relation) => relation.id)),
        count: incomingCosts.length,
      });
    }
  }

  const order: Readonly<Record<CausalFindingKind, number>> = {
    'missing-cause': 0,
    'dangling-consequence': 1,
    'coincidence-stack': 2,
    'vanishing-cost': 3,
  };
  return findings.sort((a, b) => order[a.kind] - order[b.kind] || a.nodeKey.localeCompare(b.nodeKey));
}

export function buildCausalGraph(options: BuildCausalGraphOptions): CausalGraph {
  const maxDepth = Math.max(1, Math.min(12, Math.floor(options.maxDepth ?? 5)));
  const maxNodes = Math.max(1, Math.min(500, Math.floor(options.maxNodes ?? 160)));
  const rootKey = causalEntityKey(options.root);
  const projectRelations = options.relations
    .filter((relation) => relation.projectId === options.projectId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const adjacency = new Map<string, CausalRelation[]>();
  for (const relation of projectRelations) {
    const sourceKey = causalEntityKey(relation.source);
    const targetKey = causalEntityKey(relation.target);
    adjacency.set(sourceKey, [...(adjacency.get(sourceKey) ?? []), relation]);
    adjacency.set(targetKey, [...(adjacency.get(targetKey) ?? []), relation]);
  }

  const componentDepth = new Map<string, number>([[rootKey, 0]]);
  const queue = [rootKey];
  while (queue.length > 0 && componentDepth.size < maxNodes) {
    const current = queue.shift()!;
    const depth = componentDepth.get(current) ?? 0;
    if (depth >= maxDepth) continue;
    for (const relation of adjacency.get(current) ?? []) {
      const sourceKey = causalEntityKey(relation.source);
      const targetKey = causalEntityKey(relation.target);
      const next = sourceKey === current ? targetKey : sourceKey;
      if (componentDepth.has(next)) continue;
      componentDepth.set(next, depth + 1);
      queue.push(next);
      if (componentDepth.size >= maxNodes) break;
    }
  }

  const scopedRelations = projectRelations.filter((relation) =>
    componentDepth.has(causalEntityKey(relation.source))
      && componentDepth.has(causalEntityKey(relation.target)),
  );
  const nodeRefs = new Map<string, CausalEntityReference>([[rootKey, options.root]]);
  for (const relation of scopedRelations) {
    nodeRefs.set(causalEntityKey(relation.source), relation.source);
    nodeRefs.set(causalEntityKey(relation.target), relation.target);
  }
  // The selected entity was resolved by the caller now; denormalised titles
  // carried by older links must not replace that fresher source reference.
  nodeRefs.set(rootKey, options.root);

  const consequenceDepth = new Map<string, number>([[rootKey, 0]]);
  const consequenceQueue = [rootKey];
  while (consequenceQueue.length > 0) {
    const current = consequenceQueue.shift()!;
    const depth = consequenceDepth.get(current) ?? 0;
    for (const relation of scopedRelations) {
      if (relation.canonState === 'discarded' || !EFFECT_KINDS.has(relation.kind)) continue;
      if (causalEntityKey(relation.source) !== current) continue;
      const targetKey = causalEntityKey(relation.target);
      if (consequenceDepth.has(targetKey)) continue;
      consequenceDepth.set(targetKey, depth + 1);
      consequenceQueue.push(targetKey);
    }
  }

  const nodes = [...nodeRefs.entries()].map(([key, ref]): CausalGraphNode => {
    const incomingRelationIds = uniqueSorted(
      scopedRelations
        .filter((relation) => causalEntityKey(relation.target) === key)
        .map((relation) => relation.id),
    );
    const outgoingRelationIds = uniqueSorted(
      scopedRelations
        .filter((relation) => causalEntityKey(relation.source) === key)
        .map((relation) => relation.id),
    );
    const depth = consequenceDepth.get(key) ?? null;
    return {
      key,
      ref,
      incomingRelationIds,
      outgoingRelationIds,
      depth,
      role: key === rootKey ? 'root' : depth === 1 ? 'direct' : depth && depth > 1 ? 'indirect' : 'context',
    };
  }).sort((a, b) => {
    if (a.key === rootKey) return -1;
    if (b.key === rootKey) return 1;
    return (a.depth ?? Number.MAX_SAFE_INTEGER) - (b.depth ?? Number.MAX_SAFE_INTEGER)
      || a.key.localeCompare(b.key);
  });

  const relationById = relationMap(scopedRelations);
  const rootIncoming = nodes.find((node) => node.key === rootKey)?.incomingRelationIds ?? [];
  const rootOutgoing = nodes.find((node) => node.key === rootKey)?.outgoingRelationIds ?? [];
  const activeRootOutgoing = rootOutgoing.filter((id) => relationById.get(id)?.canonState !== 'discarded');
  const becauseRelationIds = rootIncoming.filter((id) => !BUT_KINDS.has(relationById.get(id)!.kind));
  const thereforeRelationIds = rootOutgoing.filter((id) => !BUT_KINDS.has(relationById.get(id)!.kind));
  const butRelationIds = uniqueSorted(
    [...rootIncoming, ...rootOutgoing].filter((id) => BUT_KINDS.has(relationById.get(id)!.kind)),
  );
  const directConsequenceKeys = uniqueSorted(
    activeRootOutgoing.flatMap((id) => {
      const relation = relationById.get(id);
      return relation && EFFECT_KINDS.has(relation.kind) ? [causalEntityKey(relation.target)] : [];
    }),
  );
  const indirectByDepth = new Map<number, string[]>();
  for (const node of nodes) {
    if (node.depth === null || node.depth < 2) continue;
    indirectByDepth.set(node.depth, [...(indirectByDepth.get(node.depth) ?? []), node.key]);
  }

  return {
    projectId: options.projectId,
    rootKey,
    nodes,
    relations: scopedRelations,
    becauseRelationIds,
    thereforeRelationIds,
    butRelationIds,
    directConsequenceKeys,
    indirectConsequences: [...indirectByDepth.entries()]
      .sort(([a], [b]) => a - b)
      .map(([depth, nodeKeys]) => {
        const keys = new Set(nodeKeys);
        return {
          depth,
          nodeKeys: uniqueSorted(nodeKeys),
          relationIds: uniqueSorted(scopedRelations.flatMap((relation) => {
            if (relation.canonState === 'discarded' || !EFFECT_KINDS.has(relation.kind)) return [];
            const sourceDepth = consequenceDepth.get(causalEntityKey(relation.source));
            const targetKey = causalEntityKey(relation.target);
            return keys.has(targetKey) && sourceDepth === depth - 1 ? [relation.id] : [];
          })),
        };
      }),
    findings: deriveFindings(rootKey, nodes, scopedRelations),
    counts: {
      canon: scopedRelations.filter((relation) => relation.canonState === 'canon').length,
      hypotheses: scopedRelations.filter((relation) => relation.canonState === 'hypothesis').length,
      discarded: scopedRelations.filter((relation) => relation.canonState === 'discarded').length,
      unresolved: scopedRelations.filter(
        (relation) => relation.canonState !== 'discarded'
          && (relation.canonState === 'hypothesis' || relation.certainty < 1),
      ).length,
    },
    truncatedRelationCount: projectRelations.length - scopedRelations.length,
  };
}
