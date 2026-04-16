// ============================================
// Cross-Engine Entity Resolution
// Re-exports from the self-registering engine registry.
// Each engine registers its own resolver in its index.ts.
// ============================================

export {
  entityTypeToEngineId,
  resolveEntity,
  searchEntities,
  registerEntityResolver,
} from '@/engines/_shared/entityResolverRegistry';

export type { EntityResolverConfig } from '@/engines/_shared/entityResolverRegistry';
