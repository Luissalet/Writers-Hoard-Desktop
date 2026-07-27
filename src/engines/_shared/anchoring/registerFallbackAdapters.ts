import { getEngine } from '@/engines/_registry';
import {
  getAllEntityResolvers,
  resolveEntityInEngine,
} from '@/engines/_shared/entityResolverRegistry';
import { getAnchorAdapter, registerAnchorAdapter } from './registry';
import { getCurrentProjectIdFromUrl, navigateTo } from './navigation';

/**
 * Every searchable entity is annotatable at entity level. Engines may still
 * replace this fallback with a richer text-range/deep-link adapter.
 */
export function registerFallbackAnchorAdapters(): void {
  for (const resolver of getAllEntityResolvers()) {
    if (getAnchorAdapter(resolver.engineId)) continue;
    registerAnchorAdapter({
      engineId: resolver.engineId,
      supportsTextRange: false,
      async getEntityTitle(entityId) {
        return (await resolveEntityInEngine(resolver.engineId, entityId))?.title ?? null;
      },
      getEngineChipLabel() {
        return getEngine(resolver.engineId)?.name ?? resolver.engineId;
      },
      navigateToEntity(entityId, projectId) {
        const owner = projectId ?? getCurrentProjectIdFromUrl();
        if (!owner) return;
        navigateTo(
          `/project/${encodeURIComponent(owner)}/${resolver.engineId}?entity=${encodeURIComponent(entityId)}`,
        );
      },
    });
  }
}
