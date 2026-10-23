// ============================================
// Anchor Adapter Registry
// ============================================
//
// Mirror of `entityResolverRegistry` but specialized for the annotations
// engine — knows which engines support text-range anchoring and exposes the
// per-engine title/navigate/create handles the margin UI needs.

import type { AnchorAdapter, PositionalAnchorAdapter } from './types';

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

// ----- Positional comments (a comment "here", at a point of a canvas) -------
//
// Kept apart from the text/entity adapters above so none of their contracts
// change. An engine that can take point comments registers one of these too.

const POSITIONAL = new Map<string, PositionalAnchorAdapter>();

export function registerPositionalAnchorAdapter(adapter: PositionalAnchorAdapter): void {
  POSITIONAL.set(adapter.engineId, adapter);
}

export function getPositionalAnchorAdapter(engineId: string): PositionalAnchorAdapter | undefined {
  return POSITIONAL.get(engineId);
}

export function getPositionalAnchorEngineIds(): string[] {
  return Array.from(POSITIONAL.keys());
}
