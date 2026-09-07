import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { generateId } from '@/utils/idGenerator';
import {
  buildCausalGraph,
  causalRelationFromEntityLink,
  causalRelationsFromBoard,
  causalRelationsFromSeeds,
  causalRelationsFromTimeline,
  materializeCausalEntityLink,
  mergeCausalRelations,
  type BuildCausalGraphOptions,
  type CausalEntityLink,
  type CausalEntityReference,
  type CausalGraph,
  type CausalRelation,
  type CausalRelationDraft,
} from './causalGraph';

export interface LoadProjectCausalGraphOptions {
  maxDepth?: number;
  maxNodes?: number;
  /** Derived Board/Seeds/Timeline assertions can be omitted for a strict link-only lens. */
  includeDerived?: boolean;
}

function announceEntityLinkChange(projectId: string, entityId: string): void {
  notifyDataChanged({
    source: 'other',
    table: 'entityLinks',
    entityId,
    projectId,
  });
  void touchProject(projectId);
}

/**
 * Write one causal assertion into the existing cross-engine link table.
 * `draft.id`, when present, is the raw `entityLinks` id (not the graph's
 * `entity-link:` display id).
 */
export async function saveCausalRelation(draft: CausalRelationDraft): Promise<CausalRelation> {
  const existing = draft.id ? await db.entityLinks.get(draft.id) : undefined;
  if (existing && existing.projectId !== draft.projectId) {
    throw new Error('causal relation belongs to another project');
  }
  if (existing && !causalRelationFromEntityLink(existing)) {
    throw new Error('existing entity link is not causal');
  }

  const now = Date.now();
  const row = materializeCausalEntityLink(draft, {
    id: existing?.id ?? draft.id ?? generateId('causal'),
    createdAt: existing?.createdAt,
    now,
  });
  await db.entityLinks.put(row);
  announceEntityLinkChange(row.projectId, row.id);
  return causalRelationFromEntityLink(row)!;
}

export async function deleteCausalRelation(projectId: string, entityLinkId: string): Promise<boolean> {
  const removed = await db.transaction('rw', db.entityLinks, async () => {
    const existing = await db.entityLinks.get(entityLinkId);
    if (!existing || existing.projectId !== projectId || !causalRelationFromEntityLink(existing)) {
      return false;
    }
    await db.entityLinks.delete(entityLinkId);
    return true;
  });
  if (removed) announceEntityLinkChange(projectId, entityLinkId);
  return removed;
}

export async function getStoredCausalRelations(projectId: string): Promise<CausalRelation[]> {
  const links = await db.entityLinks.where('projectId').equals(projectId).toArray();
  return links.flatMap((link) => {
    const relation = causalRelationFromEntityLink(link);
    return relation ? [relation] : [];
  });
}

/**
 * One read model over existing data. Only `entityLinks` is writable here;
 * Board, Seeds and Timeline are adapters whose output can always be rebuilt.
 */
export async function loadProjectCausalGraph(
  projectId: string,
  root: CausalEntityReference,
  options: LoadProjectCausalGraphOptions = {},
): Promise<CausalGraph> {
  const storedPromise = getStoredCausalRelations(projectId);
  if (options.includeDerived === false) {
    return buildCausalGraph({
      projectId,
      root,
      relations: await storedPromise,
      maxDepth: options.maxDepth,
      maxNodes: options.maxNodes,
    });
  }

  const [stored, boardNodes, boardEdges, seeds, payoffs, events, connections] = await Promise.all([
    storedPromise,
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.boardEdges.where('projectId').equals(projectId).toArray(),
    db.seeds.where('projectId').equals(projectId).toArray(),
    db.payoffs.where('projectId').equals(projectId).toArray(),
    db.timelineEvents.where('projectId').equals(projectId).toArray(),
    db.timelineConnections.where('projectId').equals(projectId).toArray(),
  ]);
  const relations = mergeCausalRelations(
    stored,
    causalRelationsFromBoard(projectId, boardNodes, boardEdges),
    causalRelationsFromSeeds(projectId, seeds, payoffs),
    causalRelationsFromTimeline(projectId, events, connections),
  );
  const buildOptions: BuildCausalGraphOptions = {
    projectId,
    root,
    relations,
    maxDepth: options.maxDepth,
    maxNodes: options.maxNodes,
  };
  return buildCausalGraph(buildOptions);
}

export type {
  CausalEntityLink,
  CausalEntityReference,
  CausalGraph,
  CausalRelation,
  CausalRelationDraft,
};
