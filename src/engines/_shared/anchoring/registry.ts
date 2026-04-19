// ============================================
// Anchor Adapter Registry
// ============================================
//
// Mirror of `entityResolverRegistry` but specialized for the annotations
// engine — knows which engines support text-range anchoring and exposes the
// per-engine title/navigate/create handles the margin UI needs.

import type { AnchorAdapter } from './types';

const ADAPTERS = new Map<string, AnchorAdapter>();

/**
 * Register an engine's anchor capabilities. Called once per engine from its
 * `index.ts` after `registerEngine()`.
 */
export function registerAnchorAdapter(adapter: AnchorAdapter): void {
  if (adapter.supportsTextRange && !adapter.getEntityText) {
    // Loud failure in dev — silent registry rot is the worst kind of bug.
    console.warn(
      `[anchoring] Adapter for "${adapter.engineId}" claims supportsTextRange ` +
      `but has no getEntityText. Text-range anchors will not resolve.`,
    );
  }
  ADAPTERS.set(adapter.engineId, adapter);
}

export function getAnchorAdapter(engineId: string): AnchorAdapter | undefined {
  return ADAPTERS.get(engineId);
}

export function getAllAnchorAdapters(): AnchorAdapter[] {
  return Array.from(ADAPTERS.values());
}

export function getAnnotatableEngineIds(): string[] {
  return Array.from(ADAPTERS.keys());
}
