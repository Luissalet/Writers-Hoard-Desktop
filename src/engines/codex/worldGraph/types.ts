import type { CodexEntry, CodexEntryType } from '@/types';
import type { Relationship } from '@/engines/relationships/types';

export interface CodexGraphLayout { positions: Record<string, { x: number; y: number }> }
export type WorldGraphEdgeKind = 'mention' | 'codex' | 'reference' | 'relationship';
export interface WorldGraphEvidence {
  field?: string;
  excerpt: string;
  matchedAlias: string;
  ambiguous: boolean;
}
export interface WorldGraphNode {
  id: string;
  title: string;
  type: CodexEntryType;
  aliases: string[];
  tags: string[];
  summary: string;
  degree: number;
}
export interface WorldGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: WorldGraphEdgeKind;
  label: string;
  directional: boolean;
  count: number;
  ambiguousCount: number;
  evidence: WorldGraphEvidence[];
  recordId?: string;
  description?: string;
}
export interface WorldGraph {
  projectId: string;
  nodes: WorldGraphNode[];
  edges: WorldGraphEdge[];
  stats: { scannedDocuments: number; scannedCharacters: number; ambiguousMatches: number; unresolvedReferences: number; indexedNames: number };
}
export interface WorldGraphInput {
  projectId: string;
  entries: CodexEntry[];
  relationships: Relationship[];
  referenceLabels?: Record<string, Record<string, string>>;
  contentReferenceLabels?: { link: string; block: string };
}
export interface WorldGraphFilters {
  query: string;
  type: CodexEntryType | 'all';
  tag: string;
  kinds: WorldGraphEdgeKind[];
  focusId: string;
  depth: 1 | 2;
  showIsolated: boolean;
  nodeLimit: number;
  edgeLimit: number;
}
