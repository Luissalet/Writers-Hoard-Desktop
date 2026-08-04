// ============================================
// Board Engine — Query language
// ============================================
//
// A board stops being readable long before it stops being useful. The query
// bar is how you get it back: type a line and the canvas either hides or dims
// everything that does not answer.
//
//   character                 free text in title, body, tags or reference
//   role:character,faction    one of several values
//   kind:frame                how the node draws
//   tag:act1 -tag:cut         include and exclude
//   layer:"Act I"             quoted values keep their spaces
//   edge:conflict             nodes touched by a conflict relation
//   near:Ariadne~2            within two hops of a node whose title matches
//   is:orphan                 orphan | pinned | locked | missing | entity |
//                             hyper | keystone | bridge | frame | collapsed
//   degree>3  between>0.5     graph metrics as first-class filters
//   weight>=2  certainty<0.5  relation strength and confidence (edges)
//   prop:threat=high          user-defined attributes
//
// Terms combine with AND; commas inside a value mean OR; a leading `-`
// negates. That is deliberately less than a real query language — it fits on
// one line and never needs parentheses.

import type { BoardEdge, BoardLayer, BoardNode } from '../types';
import type { MetricsResult } from './metrics';
import { neighborhood } from './paths';

export interface QueryContext {
  nodes: BoardNode[];
  edges: BoardEdge[];
  layers: BoardLayer[];
  metrics: MetricsResult;
}

export interface QueryResult {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  /** True when the query selects everything (empty or unparseable). */
  passthrough: boolean;
  /** Human-readable complaints; shown next to the query bar. */
  problems: string[];
}

type Operator = ':' | '=' | '>' | '<' | '>=' | '<=';

interface Term {
  negate: boolean;
  field: string;
  operator: Operator;
  values: string[];
  raw: string;
}

const NUMERIC_FIELDS = new Set([
  'degree', 'indegree', 'outdegree', 'between', 'closeness', 'clustering',
  'weight', 'certainty', 'zindex',
]);

const EDGE_ONLY_FIELDS = new Set(['weight', 'certainty', 'etag', 'elabel']);
const NODE_ONLY_FIELDS = new Set([
  'kind', 'role', 'tag', 'color', 'prop', 'near',
  'degree', 'indegree', 'outdegree', 'between', 'closeness', 'clustering', 'zindex',
]);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of query) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseQuery(query: string): Term[] {
  return tokenize(query).map((token) => {
    let negate = false;
    let body = token;
    if (body.startsWith('-') && body.length > 1) {
      negate = true;
      body = body.slice(1);
    }

    const match = body.match(/^([a-zA-Z]+)(>=|<=|>|<|:|=)(.*)$/);
    if (!match) {
      return { negate, field: 'text', operator: ':' as Operator, values: [body.toLowerCase()], raw: token };
    }

    const [, field, operator, rest] = match;
    return {
      negate,
      field: field.toLowerCase(),
      operator: operator as Operator,
      values: rest.split(',').map((value) => value.trim()).filter(Boolean),
      raw: token,
    };
  }).filter((term) => term.values.length > 0);
}

// ---------------------------------------------------------------------------
// Evaluation helpers
// ---------------------------------------------------------------------------

function compare(value: number, operator: Operator, target: number): boolean {
  switch (operator) {
    case '>': return value > target;
    case '<': return value < target;
    case '>=': return value >= target;
    case '<=': return value <= target;
    default: return value === target;
  }
}

function anyValueMatches(values: string[], candidate: string | undefined): boolean {
  if (!candidate) return false;
  const lower = candidate.toLowerCase();
  return values.some((value) => lower === value.toLowerCase() || lower.includes(value.toLowerCase()));
}

function nodeText(node: BoardNode): string {
  return [node.title, node.content, node.ref?.title, node.ref?.subtitle, ...(node.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function evaluateQuery(query: string, context: QueryContext): QueryResult {
  const terms = parseQuery(query.trim());
  const allNodes = new Set(context.nodes.map((node) => node.id));
  const allEdges = new Set(context.edges.map((edge) => edge.id));

  if (terms.length === 0) {
    return { nodeIds: allNodes, edgeIds: allEdges, passthrough: true, problems: [] };
  }

  const problems: string[] = [];
  for (const term of terms) {
    // `degree:3` is almost always a typo for `degree=3`; comparing a metric
    // against a non-number silently matches nothing, so say so out loud.
    if (NUMERIC_FIELDS.has(term.field) && Number.isNaN(Number(term.values[0]))) {
      problems.push(`${term.field} expects a number, got "${term.values[0]}"`);
    }
  }
  const layerByName = new Map(context.layers.map((layer) => [layer.name.toLowerCase(), layer.id]));
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const { byNode, summary, adjacency } = context.metrics;
  const bridges = new Set(summary.bridgeEdgeIds);
  const keystones = new Set(summary.keystoneIds);

  // `near:` resolves once per term rather than per node.
  const nearSets = new Map<string, Set<string>>();
  for (const term of terms) {
    if (term.field !== 'near') continue;
    const focusIds: string[] = [];
    let depth = 1;
    for (const value of term.values) {
      const [reference, depthText] = value.split('~');
      if (depthText) depth = Math.max(1, Number(depthText) || 1);
      if (nodeById.has(reference)) {
        focusIds.push(reference);
        continue;
      }
      const lower = reference.toLowerCase();
      const matched = context.nodes.filter((node) => node.title.toLowerCase().includes(lower));
      if (matched.length === 0) problems.push(`near: no node matches "${reference}"`);
      for (const node of matched) focusIds.push(node.id);
    }
    nearSets.set(term.raw, neighborhood(adjacency, focusIds, depth).nodeIds);
  }

  const edgeKindByNode = new Map<string, Set<string>>();
  for (const edge of context.edges) {
    for (const endpoint of [...edge.sources, ...edge.targets]) {
      if (endpoint.on !== 'node') continue;
      const bucket = edgeKindByNode.get(endpoint.id);
      if (bucket) bucket.add(edge.kind);
      else edgeKindByNode.set(endpoint.id, new Set([edge.kind]));
    }
  }

  const matchNodeTerm = (term: Term, node: BoardNode): boolean => {
    const metrics = byNode.get(node.id);
    switch (term.field) {
      case 'text':
        return term.values.some((value) => nodeText(node).includes(value));
      case 'kind':
        return term.values.some((value) => node.kind === value.toLowerCase());
      case 'role':
        return anyValueMatches(term.values, node.role);
      case 'tag':
        return (node.tags ?? []).some((tag) => anyValueMatches(term.values, tag));
      case 'color':
        return term.values.some((value) => node.color.toLowerCase() === value.toLowerCase());
      case 'layer': {
        if (!node.layerId) return false;
        return term.values.some(
          (value) => node.layerId === value || layerByName.get(value.toLowerCase()) === node.layerId,
        );
      }
      case 'edge':
        return term.values.some((value) => edgeKindByNode.get(node.id)?.has(value.toLowerCase()) ?? false);
      case 'near':
        return nearSets.get(term.raw)?.has(node.id) ?? false;
      case 'prop': {
        return term.values.some((value) => {
          const [key, expected] = value.split('=');
          const actual = node.props?.[key];
          if (actual === undefined) return false;
          return expected === undefined || String(actual).toLowerCase() === expected.toLowerCase();
        });
      }
      case 'is':
        return term.values.some((value) => {
          switch (value.toLowerCase()) {
            case 'orphan': return (metrics?.degree ?? 0) === 0;
            case 'pinned': return Boolean(node.pinned);
            case 'locked': return Boolean(node.locked);
            case 'missing': return Boolean(node.ref?.missing);
            case 'entity': return node.kind === 'entity' || Boolean(node.ref);
            case 'frame': return node.kind === 'frame';
            case 'collapsed': return Boolean(node.collapsed);
            case 'keystone': return keystones.has(node.id);
            case 'articulation': return Boolean(metrics?.articulation);
            case 'hyper':
            case 'bridge':
              return false; // edge-only flags
            default:
              problems.push(`is: unknown flag "${value}"`);
              return false;
          }
        });
      case 'degree': return compare(metrics?.degree ?? 0, term.operator, Number(term.values[0]));
      case 'indegree': return compare(metrics?.inDegree ?? 0, term.operator, Number(term.values[0]));
      case 'outdegree': return compare(metrics?.outDegree ?? 0, term.operator, Number(term.values[0]));
      case 'between': return compare(metrics?.betweenness ?? 0, term.operator, Number(term.values[0]));
      case 'closeness': return compare(metrics?.closeness ?? 0, term.operator, Number(term.values[0]));
      case 'clustering': return compare(metrics?.clustering ?? 0, term.operator, Number(term.values[0]));
      case 'zindex': return compare(node.zIndex ?? 0, term.operator, Number(term.values[0]));
      default:
        if (EDGE_ONLY_FIELDS.has(term.field)) return true;
        problems.push(`unknown filter "${term.field}"`);
        return true;
    }
  };

  const matchEdgeTerm = (term: Term, edge: BoardEdge): boolean => {
    switch (term.field) {
      case 'edge':
        return term.values.some((value) => edge.kind === value.toLowerCase());
      case 'etag':
        return (edge.tags ?? []).some((tag) => anyValueMatches(term.values, tag));
      case 'elabel':
        return term.values.some((value) => (edge.label ?? '').toLowerCase().includes(value.toLowerCase()));
      case 'weight':
        return compare(edge.weight, term.operator, Number(term.values[0]));
      case 'certainty':
        return compare(edge.certainty, term.operator, Number(term.values[0]));
      case 'layer':
        return term.values.some(
          (value) => edge.layerId === value || layerByName.get(value.toLowerCase()) === edge.layerId,
        );
      case 'is':
        return term.values.some((value) => {
          switch (value.toLowerCase()) {
            case 'hyper': return edge.sources.length > 1 || edge.targets.length > 1;
            case 'bridge': return bridges.has(edge.id);
            case 'meta': return [...edge.sources, ...edge.targets].some((e) => e.on === 'edge');
            default: return true; // node-scoped flags never hide an edge on their own
          }
        });
      case 'text':
        return term.values.some(
          (value) =>
            (edge.label ?? '').toLowerCase().includes(value) ||
            edge.kind.toLowerCase().includes(value) ||
            (edge.notes ?? '').toLowerCase().includes(value),
        );
      default:
        if (NODE_ONLY_FIELDS.has(term.field)) return true;
        return true;
    }
  };

  const nodeIds = new Set<string>();
  for (const node of context.nodes) {
    const matched = terms.every((term) => {
      const value = matchNodeTerm(term, node);
      return term.negate ? !value : value;
    });
    if (matched) nodeIds.add(node.id);
  }

  // A text-only query should still surface a node whose *relation* matched,
  // otherwise searching for "betrayal" hides the two people it happened to.
  for (const edge of context.edges) {
    const edgeMatched = terms.every((term) => {
      if (NODE_ONLY_FIELDS.has(term.field) && term.field !== 'near') return true;
      const value = matchEdgeTerm(term, edge);
      return term.negate ? !value : value;
    });
    if (!edgeMatched) continue;
    const touchesEdgeField = terms.some(
      (term) => EDGE_ONLY_FIELDS.has(term.field) || term.field === 'edge' || term.field === 'elabel',
    );
    if (!touchesEdgeField) continue;
    for (const endpoint of [...edge.sources, ...edge.targets]) {
      if (endpoint.on === 'node' && nodeById.has(endpoint.id)) nodeIds.add(endpoint.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of context.edges) {
    const endpointsVisible = [...edge.sources, ...edge.targets].every(
      (endpoint) => endpoint.on === 'edge' || nodeIds.has(endpoint.id),
    );
    if (!endpointsVisible) continue;
    const matched = terms.every((term) => {
      if (NODE_ONLY_FIELDS.has(term.field)) return true;
      const value = matchEdgeTerm(term, edge);
      return term.negate ? !value : value;
    });
    if (matched) edgeIds.add(edge.id);
  }

  // Edge-to-edge anchors are only meaningful while their target edge is shown.
  for (const edge of context.edges) {
    if (!edgeIds.has(edge.id)) continue;
    const anchored = [...edge.sources, ...edge.targets].filter((endpoint) => endpoint.on === 'edge');
    if (anchored.some((endpoint) => !edgeIds.has(endpoint.id))) edgeIds.delete(edge.id);
  }

  return { nodeIds, edgeIds, passthrough: false, problems: Array.from(new Set(problems)) };
}
