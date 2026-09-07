import type { BranchEntitySnapshot } from '@/services/branching';
import type { EntityLink } from '@/types/projectTools';
import type {
  ArchaeologyRevision,
  ArchaeologyTrace,
  ArchaeologyTraceNode,
  ArchaeologyTransition,
  ArchaeologyTransitionKind,
  BuildStoryLensesInput,
  IdeaArchaeology,
  MotifAppearance,
  MotifConnection,
  MotifConstellation,
  MotifEcho,
  MotifEvidenceKind,
  MotifGap,
  MotifNode,
  StoryLensAvailability,
  StoryLensEntity,
  StoryLensEntityNode,
  StoryLensEntityRef,
  StoryLensesReadModel,
} from './types';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function finiteTimestamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function storyLensEntityKey(ref: Pick<StoryLensEntityRef, 'engineId' | 'entityId'>): string {
  return JSON.stringify([ref.engineId, ref.entityId]);
}

/** Case-insensitive but accent-preserving identity for an explicit tag. */
export function normalizeMotifTag(tag: string): string {
  return cleanInline(tag.normalize('NFKC')).toLowerCase();
}

function uniqueExplicitTags(tags: readonly string[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const rawTag of tags) {
    const display = cleanInline(rawTag.normalize('NFKC'));
    const identity = normalizeMotifTag(display);
    if (!identity) continue;
    const current = byIdentity.get(identity);
    if (!current || compareText(display, current) < 0) byIdentity.set(identity, display);
  }
  return [...byIdentity.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, display]) => display);
}

function entityRecency(entity: StoryLensEntity): number {
  return finiteTimestamp(entity.updatedAt) || finiteTimestamp(entity.createdAt);
}

function buildLiveNodes(projectId: string, entities: readonly StoryLensEntity[]): StoryLensEntityNode[] {
  const groups = new Map<string, StoryLensEntity[]>();
  for (const entity of entities) {
    if (
      entity.projectId !== projectId
      || !cleanInline(entity.engineId)
      || !cleanInline(entity.entityId)
    ) continue;
    const key = storyLensEntityKey(entity);
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }

  return [...groups.entries()].map(([key, rows]): StoryLensEntityNode => {
    const ordered = rows.slice().sort((left, right) =>
      entityRecency(right) - entityRecency(left)
      || compareText(cleanInline(left.title), cleanInline(right.title))
      || compareText(left.entityType, right.entityType),
    );
    const primary = ordered[0];
    const tags = uniqueExplicitTags(ordered.flatMap((row) => row.tags));
    return {
      key,
      projectId,
      engineId: cleanInline(primary.engineId),
      entityType: cleanInline(primary.entityType) || 'entity',
      entityId: cleanInline(primary.entityId),
      title: cleanInline(primary.title) || primary.entityId,
      tags,
      availability: 'live',
      ...(primary.createdAt === undefined ? {} : { createdAt: primary.createdAt }),
      ...(primary.updatedAt === undefined ? {} : { updatedAt: primary.updatedAt }),
      ...(primary.sequence === undefined ? {} : { sequence: { ...primary.sequence } }),
    };
  }).sort((left, right) => compareText(left.key, right.key));
}

function tagIds(node: StoryLensEntityNode): string[] {
  return node.tags.map(normalizeMotifTag).filter(Boolean);
}

function relationToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

const TRANSFORMATION_RELATIONS = new Set([
  'became',
  'converted-to',
  'conversion',
  'creative-promotion',
  'developed-into',
  'migrated-to',
  'promoted',
  'promoted-to',
  'transformed-into',
]);

function isTransformationRelation(value: string): boolean {
  return TRANSFORMATION_RELATIONS.has(relationToken(value));
}

interface MutableConnection {
  motifIds: [string, string];
  kind: MotifEvidenceKind;
  evidenceIds: Set<string>;
  entityKeys: Set<string>;
}

function buildMotifConstellation(
  projectId: string,
  nodes: readonly StoryLensEntityNode[],
  input: BuildStoryLensesInput,
): MotifConstellation {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const tagsByEntity = new Map(nodes.map((node) => [node.key, new Set(tagIds(node))]));
  const appearances: MotifAppearance[] = [];
  const aliasCounts = new Map<string, Map<string, number>>();

  for (const node of nodes) {
    const seen = new Set<string>();
    for (const explicitTag of node.tags) {
      const motifId = normalizeMotifTag(explicitTag);
      if (!motifId || seen.has(motifId)) continue;
      seen.add(motifId);
      appearances.push({
        id: `tag:${motifId}:${node.key}`,
        motifId,
        entityKey: node.key,
        explicitTag,
      });
      const counts = aliasCounts.get(motifId) ?? new Map<string, number>();
      counts.set(explicitTag, (counts.get(explicitTag) ?? 0) + 1);
      aliasCounts.set(motifId, counts);
    }
  }
  appearances.sort((left, right) =>
    compareText(left.motifId, right.motifId) || compareText(left.entityKey, right.entityKey),
  );

  const echoes: MotifEcho[] = [];
  const echoIds = new Set<string>();
  const mutableConnections = new Map<string, MutableConnection>();

  const addConnection = (
    kind: MotifEvidenceKind,
    leftMotif: string,
    rightMotif: string,
    evidenceId: string,
    entityKeys: readonly string[],
  ): void => {
    if (!leftMotif || !rightMotif || leftMotif === rightMotif) return;
    const motifIds: [string, string] = compareText(leftMotif, rightMotif) <= 0
      ? [leftMotif, rightMotif]
      : [rightMotif, leftMotif];
    const id = `${kind}:${JSON.stringify(motifIds)}`;
    const connection = mutableConnections.get(id) ?? {
      motifIds,
      kind,
      evidenceIds: new Set<string>(),
      entityKeys: new Set<string>(),
    };
    connection.evidenceIds.add(evidenceId);
    for (const entityKey of entityKeys) connection.entityKeys.add(entityKey);
    mutableConnections.set(id, connection);
  };

  const addCrossEvidence = (
    kind: Exclude<MotifEvidenceKind, 'co-occurrence'>,
    evidenceId: string,
    sourceKey: string,
    targetKey: string,
    details: { relation?: string; note?: string; orphaned?: boolean } = {},
  ): void => {
    const sourceTags = tagsByEntity.get(sourceKey);
    const targetTags = tagsByEntity.get(targetKey);
    if (!sourceTags || !targetTags) return;
    for (const motifId of [...sourceTags].sort(compareText)) {
      if (!targetTags.has(motifId)) continue;
      const id = `${kind}:${evidenceId}:${motifId}:${sourceKey}:${targetKey}`;
      if (echoIds.has(id)) continue;
      echoIds.add(id);
      echoes.push({
        id,
        motifId,
        sourceEntityKey: sourceKey,
        targetEntityKey: targetKey,
        kind: details.relation && isTransformationRelation(details.relation)
          ? 'transformation'
          : 'echo',
        evidenceKind: kind,
        evidenceId,
        ...(details.relation ? { relation: details.relation } : {}),
        ...(details.note ? { note: details.note } : {}),
        ...(details.orphaned ? { orphaned: true } : {}),
        suggested: true,
      });
    }
    for (const sourceMotif of [...sourceTags].sort(compareText)) {
      for (const targetMotif of [...targetTags].sort(compareText)) {
        addConnection(kind, sourceMotif, targetMotif, evidenceId, [sourceKey, targetKey]);
      }
    }
  };

  for (const node of nodes) {
    const motifs = tagIds(node);
    for (let leftIndex = 0; leftIndex < motifs.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < motifs.length; rightIndex += 1) {
        addConnection('co-occurrence', motifs[leftIndex], motifs[rightIndex], node.key, [node.key]);
      }
    }
  }

  const referenceRows = new Map<string, typeof input.annotationReferences>();
  for (const reference of input.annotationReferences ?? []) {
    referenceRows.set(reference.annotationId, [
      ...(referenceRows.get(reference.annotationId) ?? []),
      reference,
    ]);
  }
  const annotations = (input.annotations ?? [])
    .filter((annotation) => annotation.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const annotation of annotations) {
    const sourceKey = storyLensEntityKey({
      engineId: annotation.sourceEngineId,
      entityId: annotation.sourceEntityId,
    });
    const note = annotation.noteBody ? cleanInline(annotation.noteBody).slice(0, 180) : undefined;
    const references = (referenceRows.get(annotation.id) ?? [])
      .slice()
      .sort((left, right) => compareText(left.id, right.id));
    for (const reference of references) {
      const targetKey = storyLensEntityKey({
        engineId: reference.targetEngineId,
        entityId: reference.targetEntityId,
      });
      addCrossEvidence('annotation-reference', annotation.id, sourceKey, targetKey, {
        ...(note ? { note } : {}),
        orphaned: annotation.isOrphaned,
      });
    }
  }

  const entityLinks = (input.entityLinks ?? [])
    .filter((link) => link.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const link of entityLinks) {
    const sourceKey = storyLensEntityKey({ engineId: link.sourceEngineId, entityId: link.sourceEntityId });
    const targetKey = storyLensEntityKey({ engineId: link.targetEngineId, entityId: link.targetEntityId });
    addCrossEvidence('entity-link', link.id, sourceKey, targetKey, {
      relation: link.relation,
      ...(link.notes ? { note: cleanInline(link.notes).slice(0, 180) } : {}),
    });
  }

  echoes.sort((left, right) => compareText(left.id, right.id));
  const connections: MotifConnection[] = [...mutableConnections.entries()]
    .map(([id, connection]) => ({
      id,
      motifIds: connection.motifIds,
      kind: connection.kind,
      evidenceIds: [...connection.evidenceIds].sort(compareText),
      entityKeys: [...connection.entityKeys].sort(compareText),
      suggested: true as const,
    }))
    .sort((left, right) => compareText(left.id, right.id));

  const gaps: MotifGap[] = [];
  const sequenceGroups = new Map<string, StoryLensEntityNode[]>();
  for (const node of nodes) {
    if (!node.sequence || !Number.isFinite(node.sequence.order)) continue;
    sequenceGroups.set(node.sequence.scopeId, [
      ...(sequenceGroups.get(node.sequence.scopeId) ?? []),
      node,
    ]);
  }
  for (const [scopeId, group] of [...sequenceGroups.entries()].sort(([left], [right]) => compareText(left, right))) {
    const ordered = group.slice().sort((left, right) =>
      (left.sequence?.order ?? 0) - (right.sequence?.order ?? 0)
      || compareText(left.key, right.key),
    );
    for (const motifId of [...aliasCounts.keys()].sort(compareText)) {
      const tagged = ordered.filter((node) => tagsByEntity.get(node.key)?.has(motifId));
      for (let index = 0; index < tagged.length - 1; index += 1) {
        const before = tagged[index];
        const after = tagged[index + 1];
        const beforeOrder = before.sequence?.order ?? 0;
        const afterOrder = after.sequence?.order ?? 0;
        const missingEntityKeys = ordered
          .filter((node) => {
            const order = node.sequence?.order ?? 0;
            return order > beforeOrder
              && order < afterOrder
              && !tagsByEntity.get(node.key)?.has(motifId);
          })
          .map((node) => node.key);
        if (!missingEntityKeys.length) continue;
        gaps.push({
          id: `gap:${motifId}:${scopeId}:${before.key}:${after.key}`,
          motifId,
          scopeId,
          scopeTitle: before.sequence?.scopeTitle || after.sequence?.scopeTitle || scopeId,
          beforeEntityKey: before.key,
          afterEntityKey: after.key,
          missingEntityKeys,
        });
      }
    }
  }
  gaps.sort((left, right) => compareText(left.id, right.id));

  const relatedByMotif = new Map<string, Set<string>>();
  for (const connection of connections) {
    const [left, right] = connection.motifIds;
    relatedByMotif.set(left, new Set([...(relatedByMotif.get(left) ?? []), right]));
    relatedByMotif.set(right, new Set([...(relatedByMotif.get(right) ?? []), left]));
  }
  const motifs: MotifNode[] = [...aliasCounts.entries()].map(([id, counts]) => {
    const aliases = [...counts.entries()]
      .sort(([leftAlias, leftCount], [rightAlias, rightCount]) =>
        rightCount - leftCount || compareText(leftAlias, rightAlias),
      )
      .map(([alias]) => alias);
    return {
      id,
      label: aliases[0] ?? id,
      aliases,
      appearances: appearances.filter((appearance) => appearance.motifId === id),
      echoes: echoes.filter((echo) => echo.motifId === id),
      relatedMotifIds: [...(relatedByMotif.get(id) ?? [])].sort(compareText),
      gapIds: gaps.filter((gap) => gap.motifId === id).map((gap) => gap.id),
    };
  }).sort((left, right) =>
    right.appearances.length - left.appearances.length || compareText(left.id, right.id),
  );

  // Keep only references to entities that actually survived project scoping.
  const liveKeys = new Set(nodeByKey.keys());
  return {
    motifs,
    appearances,
    echoes: echoes.filter((echo) => liveKeys.has(echo.sourceEntityKey) && liveKeys.has(echo.targetEntityKey)),
    connections,
    gaps,
  };
}

const FORWARD_EVOLUTION_RELATIONS = new Set([
  ...TRANSFORMATION_RELATIONS,
  'inspired',
  'source-for',
]);
const REVERSE_EVOLUTION_RELATIONS = new Set([
  'based-on',
  'derived-from',
  'inspired-by',
  'originated-from',
]);

function evolutionDirection(link: EntityLink): 'forward' | 'reverse' | null {
  if (link.provenance === 'conversion' || link.provenance === 'migration') return 'forward';
  const relation = relationToken(link.relation);
  if (FORWARD_EVOLUTION_RELATIONS.has(relation)) return 'forward';
  if (REVERSE_EVOLUTION_RELATIONS.has(relation)) return 'reverse';
  return null;
}

function branchSnapshotRef(snapshot: BranchEntitySnapshot): StoryLensEntityRef {
  switch (snapshot.kind) {
    case 'outline-beat':
      return {
        engineId: 'outline',
        entityType: snapshot.kind,
        entityId: snapshot.value.id,
        title: snapshot.value.title || snapshot.value.id,
      };
    case 'timeline-event':
      return {
        engineId: 'timeline',
        entityType: snapshot.kind,
        entityId: snapshot.value.id,
        title: snapshot.value.title || snapshot.value.id,
      };
    case 'timeline-connection':
      return {
        engineId: 'timeline',
        entityType: snapshot.kind,
        entityId: snapshot.value.id,
        title: snapshot.value.label || snapshot.value.id,
      };
  }
}

function availabilityRank(value: StoryLensAvailability): number {
  return value === 'live' ? 3 : value === 'snapshot-only' ? 2 : 1;
}

function buildIdeaArchaeology(
  projectId: string,
  liveNodes: readonly StoryLensEntityNode[],
  input: BuildStoryLensesInput,
): IdeaArchaeology {
  const nodes = new Map(liveNodes.map((node) => [node.key, { ...node, tags: [...node.tags] }]));

  const ensureNode = (
    ref: StoryLensEntityRef,
    availability: StoryLensAvailability = 'reference-only',
  ): StoryLensEntityNode => {
    const key = storyLensEntityKey(ref);
    const current = nodes.get(key);
    if (current) {
      if (availabilityRank(availability) > availabilityRank(current.availability)) {
        const upgraded = { ...current, availability };
        nodes.set(key, upgraded);
        return upgraded;
      }
      return current;
    }
    const created: StoryLensEntityNode = {
      key,
      projectId,
      engineId: cleanInline(ref.engineId),
      entityType: cleanInline(ref.entityType) || 'entity',
      entityId: cleanInline(ref.entityId),
      title: cleanInline(ref.title) || ref.entityId,
      tags: [],
      availability,
    };
    nodes.set(key, created);
    return created;
  };

  const resolvedRef = (
    engineId: string,
    entityId: string,
    entityType: string,
    title: string,
  ): StoryLensEntityRef => {
    const existing = nodes.get(storyLensEntityKey({ engineId, entityId }));
    return existing ?? { engineId, entityId, entityType, title: cleanInline(title) || entityId };
  };

  const transitions = new Map<string, ArchaeologyTransition>();
  const addTransition = (transition: ArchaeologyTransition): void => {
    if (transition.sourceKey === transition.targetKey) return;
    transitions.set(transition.id, transition);
  };

  const receiptLinkIds = new Set<string>();
  const receiptSignatures = new Set<string>();
  const receipts = (input.conversionReceipts ?? [])
    .filter((receipt) => receipt.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const receipt of receipts) {
    if (receipt.conversionLinkId) receiptLinkIds.add(receipt.conversionLinkId);
    const source = resolvedRef(
      receipt.sourceEngineId,
      receipt.sourceEntityId,
      'entity',
      receipt.sourceEntityId,
    );
    const target = resolvedRef(
      receipt.targetEngineId,
      receipt.targetEntityId,
      receipt.targetTable || 'entity',
      receipt.targetEntityId,
    );
    const sourceNode = ensureNode(source);
    const targetNode = ensureNode(target);
    const signature = `${sourceNode.key}>${targetNode.key}`;
    receiptSignatures.add(signature);
    addTransition({
      id: `conversion:${receipt.id}`,
      projectId,
      kind: 'conversion',
      sourceKey: sourceNode.key,
      targetKey: targetNode.key,
      evidenceId: receipt.id,
      createdAt: finiteTimestamp(receipt.createdAt),
      state: receipt.undoneAt === undefined ? 'active' : 'undone',
      label: receipt.targetTable,
    });
  }

  const creativePromotions = (input.creativePromotions ?? [])
    .filter((promotion) => promotion.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const promotion of creativePromotions) {
    const target = ensureNode(promotion.target);
    const sources = promotion.sources
      .slice()
      .sort((left, right) => compareText(storyLensEntityKey(left), storyLensEntityKey(right)));
    for (const source of sources) {
      const sourceNode = ensureNode(source);
      addTransition({
        id: `creative:${promotion.id}:${sourceNode.key}`,
        projectId,
        kind: 'creative-promotion',
        sourceKey: sourceNode.key,
        targetKey: target.key,
        evidenceId: promotion.id,
        createdAt: finiteTimestamp(promotion.createdAt),
        state: 'active',
        label: cleanInline(promotion.move),
      });
    }
  }

  const branchReceipts = (input.branchPromotionReceipts ?? [])
    .filter((receipt) => receipt.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const receipt of branchReceipts) {
    const branch = ensureNode({
      engineId: 'branching',
      entityType: 'creative-branch',
      entityId: receipt.branchId,
      title: receipt.branchId,
    });
    for (const change of receipt.changes.slice().sort((left, right) => compareText(left.deltaId, right.deltaId))) {
      const snapshot = change.after ?? change.before;
      if (!snapshot) continue;
      const target = ensureNode(branchSnapshotRef(snapshot));
      const operation = change.before === null ? 'create' : change.after === null ? 'remove' : 'update';
      addTransition({
        id: `branch:${receipt.id}:${change.deltaId}`,
        projectId,
        kind: 'branch-promotion',
        sourceKey: branch.key,
        targetKey: target.key,
        evidenceId: receipt.id,
        createdAt: finiteTimestamp(receipt.createdAt),
        state: receipt.undoneAt === undefined ? 'active' : 'undone',
        label: operation,
      });
    }
  }

  const links = (input.entityLinks ?? [])
    .filter((link) => link.projectId === projectId)
    .slice()
    .sort((left, right) => compareText(left.id, right.id));
  for (const link of links) {
    const direction = evolutionDirection(link);
    if (!direction || receiptLinkIds.has(link.id)) continue;
    const storedSource = {
      engineId: link.sourceEngineId,
      entityType: link.sourceEntityType,
      entityId: link.sourceEntityId,
      title: link.sourceTitle,
    };
    const storedTarget = {
      engineId: link.targetEngineId,
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      title: link.targetTitle,
    };
    const source = ensureNode(direction === 'forward' ? storedSource : storedTarget);
    const target = ensureNode(direction === 'forward' ? storedTarget : storedSource);
    const signature = `${source.key}>${target.key}`;
    if (link.provenance === 'conversion' && receiptSignatures.has(signature)) continue;
    const kind: ArchaeologyTransitionKind = link.provenance === 'conversion'
      ? 'conversion'
      : link.provenance === 'migration'
        ? 'migration'
        : 'entity-link';
    addTransition({
      id: `link:${link.id}`,
      projectId,
      kind,
      sourceKey: source.key,
      targetKey: target.key,
      evidenceId: link.id,
      createdAt: finiteTimestamp(link.createdAt),
      state: 'active',
      label: link.relation,
    });
  }

  const revisions: ArchaeologyRevision[] = (input.writingSnapshots ?? [])
    .filter((snapshot) => snapshot.projectId === projectId)
    .map((snapshot): ArchaeologyRevision => {
      const writing = ensureNode({
        engineId: 'writings',
        entityType: 'writing',
        entityId: snapshot.writingId,
        title: snapshot.title || snapshot.writingId,
      }, 'snapshot-only');
      return {
        id: `writing-snapshot:${snapshot.id}`,
        projectId,
        entityKey: writing.key,
        snapshotId: snapshot.id,
        title: snapshot.title,
        reason: snapshot.reason,
        wordCount: snapshot.wordCount,
        createdAt: finiteTimestamp(snapshot.createdAt),
        contentAvailable: true,
      };
    })
    .sort((left, right) =>
      left.createdAt - right.createdAt || compareText(left.id, right.id),
    );

  const orderedTransitions = [...transitions.values()].sort((left, right) =>
    left.createdAt - right.createdAt || compareText(left.id, right.id),
  );
  const active = orderedTransitions.filter((transition) => transition.state === 'active');
  const connectedKeys = new Set(active.flatMap((transition) => [transition.sourceKey, transition.targetKey]));
  for (const revision of revisions) connectedKeys.add(revision.entityKey);
  const incoming = new Set(active.map((transition) => transition.targetKey));
  const outgoing = new Set(active.map((transition) => transition.sourceKey));

  return {
    nodes: [...nodes.values()].sort((left, right) => compareText(left.key, right.key)),
    transitions: orderedTransitions,
    revisions,
    originKeys: [...connectedKeys].filter((key) => !incoming.has(key)).sort(compareText),
    endpointKeys: [...connectedKeys].filter((key) => !outgoing.has(key)).sort(compareText),
  };
}

function traverseTrace(
  startKey: string,
  transitions: readonly ArchaeologyTransition[],
  direction: 'upstream' | 'downstream',
): Map<string, number> {
  const result = new Map<string, number>();
  const queue = [{ key: startKey, depth: 0 }];
  while (queue.length > 0 && result.size < 500) {
    const current = queue.shift()!;
    if (current.depth >= 12) continue;
    const adjacent = transitions.filter((transition) =>
      direction === 'upstream'
        ? transition.targetKey === current.key
        : transition.sourceKey === current.key,
    );
    for (const transition of adjacent) {
      const nextKey = direction === 'upstream' ? transition.sourceKey : transition.targetKey;
      if (nextKey === startKey || result.has(nextKey)) continue;
      result.set(nextKey, current.depth + 1);
      queue.push({ key: nextKey, depth: current.depth + 1 });
    }
  }
  return result;
}

export function traceIdeaArchaeology(
  archaeology: IdeaArchaeology,
  selectedKey: string,
): ArchaeologyTrace | null {
  const nodeByKey = new Map(archaeology.nodes.map((node) => [node.key, node]));
  const selected = nodeByKey.get(selectedKey);
  if (!selected) return null;
  const active = archaeology.transitions.filter((transition) => transition.state === 'active');
  const ancestorDepth = traverseTrace(selectedKey, active, 'upstream');
  const descendantDepth = traverseTrace(selectedKey, active, 'downstream');
  const involved = new Set([selectedKey, ...ancestorDepth.keys(), ...descendantDepth.keys()]);
  const toTraceNodes = (depths: Map<string, number>, farthestFirst: boolean): ArchaeologyTraceNode[] =>
    [...depths.entries()]
      .flatMap(([key, depth]) => {
        const node = nodeByKey.get(key);
        return node ? [{ node, depth }] : [];
      })
      .sort((left, right) =>
        (farthestFirst ? right.depth - left.depth : left.depth - right.depth)
        || compareText(left.node.key, right.node.key),
      );
  return {
    selected,
    ancestors: toTraceNodes(ancestorDepth, true),
    descendants: toTraceNodes(descendantDepth, false),
    activeTransitions: active.filter((transition) =>
      involved.has(transition.sourceKey) && involved.has(transition.targetKey),
    ),
    undoneTransitions: archaeology.transitions.filter((transition) =>
      transition.state === 'undone'
      && (involved.has(transition.sourceKey) || involved.has(transition.targetKey)),
    ),
    revisions: archaeology.revisions.filter((revision) => involved.has(revision.entityKey)),
  };
}

export function buildStoryLensesReadModel(input: BuildStoryLensesInput): StoryLensesReadModel {
  const projectId = cleanInline(input.projectId);
  if (!projectId) throw new Error('projectId is required');
  const entities = buildLiveNodes(projectId, input.entities);
  return {
    projectId,
    entities,
    constellation: buildMotifConstellation(projectId, entities, input),
    archaeology: buildIdeaArchaeology(projectId, entities, input),
  };
}
