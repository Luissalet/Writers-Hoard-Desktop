// ============================================
// Entity Resolver Registry — Self-Registering Pattern
// Each engine registers its own resolution capabilities.
// ============================================

import type { EntityPreview } from '@/engines/_types';
import { eraDocumentKinds, type EraDocumentKind } from '@/services/worldEras/types';
import { foldSearchText } from '@/services/searchQuery';
import { readAliases } from '@/services/codexReference/aliases';

/**
 * Configuration for how an engine resolves and searches its entities.
 */
export interface EntityResolverConfig {
  /** Engine ID (e.g. 'codex', 'timeline') */
  engineId: string;
  /** Entity type aliases that map to this engine (e.g. ['codex', 'codex-entry', 'character', 'location']) */
  entityTypes: string[];
  /** Resolve a single entity by ID to a preview */
  resolveEntity: (entityId: string, entityType: string) => Promise<EntityPreview | null>;
  /**
   * Search for entities matching a query string.
   *
   * `projectId` is a **scoping hint, not a filter of last resort**: the registry
   * still drops out-of-project results afterwards, but an engine that ignores
   * it ends up scanning its whole table — across every project the user has
   * ever created, deserialising base64 images and all — on every keystroke of
   * the global search box. Use it with `.where('projectId')` whenever the
   * table is indexed by it.
   */
  searchEntities: (query: string, projectId?: string) => Promise<EntityPreview[]>;
}

/**
 * Central registry: engineId → resolver config
 */
const resolverRegistry: Map<string, EntityResolverConfig> = new Map();

/**
 * Type map: entityType → engineId
 */
const typeToEngineMap: Map<string, string> = new Map();

/**
 * Register an entity resolver for an engine.
 * Called from each engine's index.ts after registerEngine().
 */
export function registerEntityResolver(config: EntityResolverConfig): void {
  resolverRegistry.set(config.engineId, config);
  for (const type of config.entityTypes) {
    typeToEngineMap.set(type, config.engineId);
  }
}

/**
 * Look up which engine owns a given entity type.
 */
export function entityTypeToEngineId(entityType: string): string | undefined {
  return typeToEngineMap.get(entityType);
}

export function getAllEntityResolvers(): EntityResolverConfig[] {
  return [...resolverRegistry.values()];
}

/** Resolve an id when the caller knows the engine but not its entity subtype. */
export async function resolveEntityInEngine(
  engineId: string,
  entityId: string,
): Promise<EntityPreview | null> {
  const config = resolverRegistry.get(engineId);
  if (!config) return null;
  for (const entityType of config.entityTypes) {
    const preview = await config.resolveEntity(entityId, entityType);
    if (preview) return preview;
  }
  return null;
}

/**
 * Resolve a single entity by ID and type to a preview card.
 * Returns null if the entity type is not registered or the entity doesn't exist.
 */
export async function resolveEntity(
  entityId: string,
  entityType: string,
): Promise<EntityPreview | null> {
  const engineId = typeToEngineMap.get(entityType);
  if (!engineId) return null;
  const config = resolverRegistry.get(engineId);
  if (!config) return null;
  return config.resolveEntity(entityId, entityType);
}

/**
 * Search for entities across one or more engines.
 * If no engine IDs provided, searches all registered engines.
 */
export async function searchEntities(
  query: string,
  engineIds?: string[],
  projectId?: string,
  eraId?: string,
): Promise<EntityPreview[]> {
  if (!query.trim()) return [];
  if (eraId && !projectId) throw new Error('world_era_project_required');
  const engines = engineIds ?? [...resolverRegistry.keys()];
  const results = await Promise.all(
    engines
      .map(eid => resolverRegistry.get(eid))
      .filter(Boolean)
      .map(async config => {
        if (!eraId || !projectId || !(eraDocumentKinds as readonly string[]).includes(config!.engineId)) return config!.searchEntities(query, projectId);
        const { listWorldDocuments } = await import('@/services/worldEras/store');
        const documents = await listWorldDocuments({ projectId, eraId }, config!.engineId as EraDocumentKind);
        const needle = foldSearchText(query);
        return documents.flatMap(({ document: { root } }): EntityPreview[] => {
          const title = String(root.title ?? root.name ?? root.text ?? root.id), aliases = root.fields && typeof root.fields === 'object' ? readAliases(root.fields as Record<string, string>) : [];
          if (![title, ...aliases].some(value => foldSearchText(value).includes(needle))) return [];
          return [{ id: root.id, projectId, engineId: config!.engineId, type: String(root.type ?? config!.entityTypes[0] ?? config!.engineId), title, subtitle: String(root.status ?? root.description ?? ''), searchTerms: aliases, thumbnail: typeof root.avatar === 'string' ? root.avatar : undefined }];
        });
      })
  );
  const flattened = results.flat();
  return projectId
    ? flattened.filter(result => result.projectId === projectId)
    : flattened;
}
