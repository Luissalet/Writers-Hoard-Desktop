export type RevisionKind = 'insertion' | 'deletion';
export interface RevisionMetadata { id: string; kind: RevisionKind; author: string; source: string; createdAt: number }
export const REVISION_ATTRIBUTES = {
  id: 'data-wh-revision-id', kind: 'data-wh-revision-kind', author: 'data-wh-revision-author',
  source: 'data-wh-revision-source', createdAt: 'data-wh-revision-created-at',
} as const;
export const REVISION_BREAK_ATTRIBUTES = {
  id: 'data-wh-revision-break-id', kind: 'data-wh-revision-break-kind', author: 'data-wh-revision-break-author',
  source: 'data-wh-revision-break-source', createdAt: 'data-wh-revision-break-created-at',
} as const;
export function normalizeRevisionMetadata(input: unknown): RevisionMetadata | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id || (value.kind !== 'insertion' && value.kind !== 'deletion') || typeof value.author !== 'string' || typeof value.source !== 'string' || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) return null;
  return { id: value.id, kind: value.kind as RevisionKind, author: value.author, source: value.source, createdAt: value.createdAt };
}
export function revisionMetadataFromElement(element: Element, boundary = false): RevisionMetadata | null {
  const attrs = boundary ? REVISION_BREAK_ATTRIBUTES : REVISION_ATTRIBUTES;
  return normalizeRevisionMetadata(Object.fromEntries(Object.entries(attrs).map(([key, attribute]) => [key, key === 'createdAt' ? Number(element.getAttribute(attribute)) : element.getAttribute(attribute)])));
}
export function revisionHtmlAttributes(input: unknown, boundary = false): Record<string, string> {
  const meta = normalizeRevisionMetadata(input);
  if (!meta) return {};
  const attrs = boundary ? REVISION_BREAK_ATTRIBUTES : REVISION_ATTRIBUTES;
  return Object.fromEntries(Object.entries(attrs).map(([key, attribute]) => [attribute, String(meta[key as keyof RevisionMetadata])]));
}
export interface RevisionRange { from: number; to: number; kind: RevisionKind; boundary?: boolean }
export interface RevisionSummary {
  id: string; author: string; source: string; createdAt: number; kind: RevisionKind | 'replacement';
  from: number; to: number; originalText: string; proposedText: string; deletedText: string; insertedText: string;
  ranges: RevisionRange[];
}
export interface RevisionTracking { enabled: boolean; author: string; source: string; warning?: string }
export interface RevisionProposalInput {
  from: number; to: number; text: string; author: string; source: string; id?: string; createdAt?: number;
  expectedUpdatedAt?: number; currentUpdatedAt?: number;
}
export interface RevisionScope { from: number; to: number }
export interface RevisionResolveInput { ids?: string[]; from?: number; to?: number; scopeFrom?: number; scopeTo?: number; decision: 'accept' | 'reject' }
export interface RevisionOperationResult {
  ok: boolean; ids: string[];
  reason?: 'invalid-range' | 'stale-source' | 'overlapping-revision' | 'structure' | 'not-found'; message?: string;
}
