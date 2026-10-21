import { createMentionIndex } from '@/services/codexReference/indexedMentions';
import { bodyParagraphs, normalizeForMatch } from '@/services/codexReference/matcher';
import { isAliasField, readAliases } from '@/services/codexReference/aliases';
import { extractContentCodexReferences } from '@/services/codexReference/contentReferences';
import {templateIsWithin} from '../templateHierarchy';
import type {CodexTemplate} from '../templateTypes';
import type { CodexGraphLayout, WorldGraph, WorldGraphEdge, WorldGraphFilters, WorldGraphInput, WorldGraphNode } from './types';

const identity = (...parts: string[]) => parts.map(encodeURIComponent).join(':');

/** A derived graph: inferred name mentions never become authored relationships. */
export function buildWorldGraph(input: WorldGraphInput): WorldGraph {
  const entries = input.entries.filter(entry => entry.projectId === input.projectId);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const content = new Map(entries.map(entry => [entry.id, extractContentCodexReferences(entry.content, input.projectId)]));
  const nodes: WorldGraphNode[] = entries.map(entry => ({ id: entry.id, title: entry.title, type: entry.type, templateId:entry.templateId, aliases: readAliases(entry.fields), tags: entry.tags ?? [], summary: bodyParagraphs(content.get(entry.id)!.mentionHtml)[0]?.slice(0, 180) ?? '', degree: 0 }));
  const index = createMentionIndex(entries);
  const edges: WorldGraphEdge[] = [];
  const stats = { scannedDocuments: 0, scannedCharacters: 0, ambiguousMatches: 0, unresolvedReferences: 0, indexedNames: index.patternCount };
  for (const entry of entries) {
    for (const [position, relation] of (entry.relations ?? []).entries()) {
      if (!byId.has(relation.targetId)) { stats.unresolvedReferences++; continue; }
      edges.push({ id: identity('codex', entry.id, relation.targetId, String(position)), source: entry.id, target: relation.targetId, kind: 'codex', label: relation.type, description: relation.description, directional: true, count: 1, ambiguousCount: 0, evidence: [] });
    }
    for (const [key, targets] of Object.entries(entry.referenceFields ?? {})) {
      for (const target of new Set(targets)) {
        if (!byId.has(target)) { stats.unresolvedReferences++; continue; }
        edges.push({ id: identity('reference', entry.id, key, target), source: entry.id, target, kind: 'reference', label: input.referenceLabels?.[entry.id]?.[key] ?? key, directional: true, count: 1, ambiguousCount: 0, evidence: [] });
      }
    }
    const authored = new Map<string, WorldGraphEdge>();
    for (const reference of content.get(entry.id)!.references) {
      if (!byId.has(reference.entryId)) { stats.unresolvedReferences++; continue; }
      const id = identity('content-reference', entry.id, reference.kind, reference.entryId);
      const edge = authored.get(id) ?? { id, source: entry.id, target: reference.entryId, kind: 'reference' as const, label: input.contentReferenceLabels?.[reference.kind] ?? (reference.kind === 'link' ? 'Text link' : 'Live Codex block'), directional: true, count: 0, ambiguousCount: 0, evidence: [] };
      edge.count++; authored.set(id, edge);
    }
    edges.push(...authored.values());
    const mentions = new Map<string, WorldGraphEdge>();
    const documents: Array<{ field?: string; text: string }> = [
      ...bodyParagraphs(content.get(entry.id)!.mentionHtml).map(text => ({ text })),
      ...Object.entries(entry.fields ?? {}).filter(([key, value]) => !isAliasField(key) && typeof value === 'string' && value.trim()).map(([field, text]) => ({ field, text })),
    ];
    for (const document of documents) {
      stats.scannedDocuments++; stats.scannedCharacters += document.text.length;
      for (const match of index.find(document.text)) {
        const targets = match.entryIds.filter(target => target !== entry.id && byId.has(target));
        if (match.ambiguous && targets.length) stats.ambiguousMatches++;
        for (const target of targets) {
          const edge: WorldGraphEdge = mentions.get(target) ?? { id: identity('mention', entry.id, target), source: entry.id, target, kind: 'mention', label: '', directional: true, count: 0, ambiguousCount: 0, evidence: [] };
          edge.count++; if (match.ambiguous) edge.ambiguousCount++;
          if (edge.evidence.length < 3) edge.evidence.push({ field: document.field, excerpt: `${match.from > 65 ? '…' : ''}${document.text.slice(Math.max(0, match.from - 65), Math.min(document.text.length, match.to + 85))}${match.to + 85 < document.text.length ? '…' : ''}`, matchedAlias: match.matchedAlias, ambiguous: match.ambiguous });
          mentions.set(target, edge);
        }
      }
    }
    edges.push(...mentions.values());
  }
  for (const relationship of input.relationships) {
    if (relationship.projectId !== input.projectId) continue;
    if (!byId.has(relationship.entityAId) || !byId.has(relationship.entityBId)) { stats.unresolvedReferences++; continue; }
    edges.push({ id: identity('relationship', relationship.id), source: relationship.entityAId, target: relationship.entityBId, kind: 'relationship', label: relationship.label || relationship.kind, description: relationship.notes, directional: relationship.directional, count: 1, ambiguousCount: 0, evidence: [], recordId: relationship.id });
  }
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) { neighbors.get(edge.source)?.add(edge.target); neighbors.get(edge.target)?.add(edge.source); }
  for (const node of nodes) node.degree = neighbors.get(node.id)?.size ?? 0;
  nodes.sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { projectId: input.projectId, nodes, edges, stats };
}

export function filterWorldGraph(graph: WorldGraph, filters: WorldGraphFilters, templates:readonly CodexTemplate[] = []) {
  const kinds = new Set(filters.kinds), edges = graph.edges.filter(edge => kinds.has(edge.kind));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target); neighbors.get(edge.target)!.add(edge.source);
  }
  let neighborhood: Set<string> | null = null;
  if (filters.focusId) {
    neighborhood = new Set([filters.focusId]); let frontier = [filters.focusId];
    for (let depth = 0; depth < filters.depth; depth++) {
      const next: string[] = [];
      for (const id of frontier) for (const neighbor of neighbors.get(id) ?? []) if (!neighborhood.has(neighbor)) { neighborhood.add(neighbor); next.push(neighbor); }
      frontier = next;
    }
  }
  const query = normalizeForMatch(filters.query).trim();
  const eligible = graph.nodes.filter(node => (filters.types ? filters.types.includes(node.type) : filters.type === 'all' || node.type === filters.type)
    && (!filters.templateId || templates.some(item=>item.id===filters.templateId) && (filters.includeDescendants!==false ? templateIsWithin(node.templateId,filters.templateId,templates) : node.templateId===filters.templateId))
    && (!filters.tag || node.tags.includes(filters.tag)) && (!neighborhood || neighborhood.has(node.id))
    && (filters.showIsolated || (neighbors.get(node.id)?.size ?? 0) > 0)
    && (!query || normalizeForMatch([node.title, ...node.aliases].join(' ')).includes(query)));
  if (filters.focusId) eligible.sort((a, b) => Number(b.id === filters.focusId) - Number(a.id === filters.focusId));
  const eligibleIds = new Set(eligible.map(node => node.id));
  const eligibleEdges = edges.filter(edge => eligibleIds.has(edge.source) && eligibleIds.has(edge.target));
  const nodes = eligible.slice(0, Math.max(1, filters.nodeLimit));
  const ids = new Set(nodes.map(node => node.id));
  const visibleEdges = eligibleEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).slice(0, Math.max(0, filters.edgeLimit));
  return { nodes, edges: visibleEdges, matchingNodes: eligible.length, matchingEdges: eligibleEdges.length, omittedNodes: eligible.length - nodes.length, omittedEdges: eligibleEdges.length - visibleEdges.length };
}

/** Deterministic breadth-first columns per component; explicit manual positions win. */
export function layoutWorldGraph(nodes: WorldGraphNode[], edges: WorldGraphEdge[], manual?: CodexGraphLayout): CodexGraphLayout['positions'] {
  const positions: CodexGraphLayout['positions'] = {}, byId = new Map(nodes.map(node => [node.id, node]));
  const adjacency = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) { if (byId.has(edge.source) && byId.has(edge.target)) { adjacency.get(edge.source)!.add(edge.target); adjacency.get(edge.target)!.add(edge.source); } }
  const seen = new Set<string>(); let offset = 0;
  for (const root of nodes) {
    if (seen.has(root.id) || !adjacency.get(root.id)!.size) continue;
    seen.add(root.id);
    const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }], columns: string[][] = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { id, depth } = queue[cursor]; (columns[depth] ??= []).push(id);
      const next = [...adjacency.get(id)!].sort((a, b) => (byId.get(b)?.degree ?? 0) - (byId.get(a)?.degree ?? 0) || a.localeCompare(b));
      for (const neighbor of next) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push({ id: neighbor, depth: depth + 1 }); }
    }
    const height = Math.max(...columns.map(column => column.length)) * 112;
    columns.forEach((column, x) => column.forEach((id, y) => { positions[id] = { x: x * 290, y: offset + y * 112 + (height - column.length * 112) / 2 }; }));
    offset += height + 80;
  }
  nodes.filter(node => !adjacency.get(node.id)!.size).forEach((node, index) => { positions[node.id] = { x: (index % 4) * 250, y: offset + Math.floor(index / 4) * 112 }; });
  for (const node of nodes) {
    const saved = manual?.positions[node.id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) positions[node.id] = { x: Math.max(-100000, Math.min(100000, saved.x)), y: Math.max(-100000, Math.min(100000, saved.y)) };
  }
  return positions;
}
