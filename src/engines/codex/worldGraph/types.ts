import type { CodexEntry, CodexEntryType } from '@/types';
import type { Relationship } from '@/engines/relationships/types';

/** How the graph is drawn: names on every card, only on the most connected ("main"), or on hover; card size; link strength; pictures. */
export interface WorldGraphDisplay { names: 'all' | 'main' | 'hover'; nodeSize: 'small' | 'medium' | 'large'; linkOpacity: number; pictures: boolean }
export const DEFAULT_GRAPH_DISPLAY: WorldGraphDisplay = { names: 'all', nodeSize: 'medium', linkOpacity: 1, pictures: true };
/** A named graph: its filters and look, saved with the project. */
export interface WorldGraphView { id: string; name: string; filters: Partial<WorldGraphFilters>; display: WorldGraphDisplay }
export interface CodexGraphLayout { positions: Record<string, { x: number; y: number }>; display?: WorldGraphDisplay; hiddenIds?: string[]; views?: WorldGraphView[] }
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
  templateId?: string;
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
  /** When present, replaces the legacy single category (an empty set matches nothing). */
  types?: CodexEntryType[];
  templateId?: string;
  includeDescendants?: boolean;
  tag: string;
  kinds: WorldGraphEdgeKind[];
  focusId: string;
  depth: 1 | 2;
  showIsolated: boolean;
  nodeLimit: number;
  edgeLimit: number;
}
