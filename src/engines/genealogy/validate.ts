// ============================================================================
// Genealogy contract — pure validator (no I/O, no imports, no mutation).
//
// Contract version: 1.0.0 (see docs/GENEALOGY_CONTRACT.md).
//
// validateGenealogy(characters, proposal, relationships) takes the project's
// characters, a PROPOSAL of genealogy links and the existing generic
// relationships, and returns a result that:
//
//   - accepts each link independently: an invalid link never contaminates the
//     rest of the batch (per-link issues, not a global throw);
//   - preserves the generic relationships verbatim and never infers ancestry
//     from them (a 'family' relationship labelled 'madre' is NOT a parent edge);
//   - builds the ancestry graph only from biological_parent / adoptive_parent
//     links (multiple parents per child are allowed); guardian and partner
//     are accepted but never create ancestry;
//   - rejects self links, unknown kinds, missing refs, duplicate ids and
//     ancestry cycles (reporting the full chain);
//   - never mutates its inputs: everything is deep-copied on the way in.
//
// Identity rule: characters are matched by id ONLY. Names, same_as aliases or
// any other field never merge two ids.
// ============================================================================

/** Version of the genealogy contract this module implements. */
export const GENEALOGY_CONTRACT_VERSION = '1.0.0';

/** Link kinds that form the ancestry graph (parent -> child). */
export const ANCESTRY_KINDS = ['biological_parent', 'adoptive_parent'] as const;

/** Link kinds that are accepted but never form ancestry. */
export const NON_ANCESTRY_KINDS = ['guardian', 'partner'] as const;

export type GenealogyLinkKind = (typeof ANCESTRY_KINDS)[number] | (typeof NON_ANCESTRY_KINDS)[number];

export interface GenealogyLink {
  id: string;
  /** Parent (for ancestry kinds) or source character id. */
  from: string;
  /** Child (for ancestry kinds) or target character id. */
  to: string;
  kind: GenealogyLinkKind;
  label?: string;
}

export interface GenealogyIssue {
  code:
    | 'self_link'
    | 'missing_ref'
    | 'unknown_kind'
    | 'duplicate_id'
    | 'ancestry_cycle'
    | 'cycle_rejected'
    | 'invalid_shape';
  /** Human-readable detail; `chain` is set for ancestry_cycle. */
  detail: string;
  /** Full ancestry loop, e.g. ['A', 'B', 'C', 'A'] — only for ancestry_cycle. */
  chain?: string[];
}

export interface RejectedLink {
  /**
   * The rejected link exactly as received (deep copy). When the rejection is
   * `invalid_shape` the payload may NOT satisfy GenealogyLink (it is the raw
   * input: null, a number, a malformed object...), so the declared type is
   * `unknown`: consumers must narrow before treating it as a link.
   */
  link: unknown;
  issues: GenealogyIssue[];
}

export interface AncestryEdge {
  linkId: string;
  parent: string;
  child: string;
  kind: 'biological_parent' | 'adoptive_parent';
}

export interface GenealogyValidationResult {
  contractVersion: string;
  accepted: GenealogyLink[];
  rejected: RejectedLink[];
  /** Ancestry graph built ONLY from accepted parent-kind links. */
  ancestry: AncestryEdge[];
  /** The generic relationships, passed through untouched. */
  relationships: unknown[];
}

const VALID_KINDS: ReadonlySet<string> = new Set([...ANCESTRY_KINDS, ...NON_ANCESTRY_KINDS]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep copy that never hands a caller's object back mutated or shared. */
function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function shapeIssues(raw: unknown): GenealogyIssue[] {
  const issues: GenealogyIssue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({ code: 'invalid_shape', detail: 'link is not an object' });
    return issues;
  }
  const { id, from, to, kind } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') {
    issues.push({ code: 'invalid_shape', detail: 'link.id must be a non-empty string' });
  }
  if (typeof from !== 'string' || from === '') {
    issues.push({ code: 'invalid_shape', detail: 'link.from must be a non-empty string' });
  }
  if (typeof to !== 'string' || to === '') {
    issues.push({ code: 'invalid_shape', detail: 'link.to must be a non-empty string' });
  }
  if (typeof kind !== 'string' || kind === '') {
    issues.push({ code: 'invalid_shape', detail: 'link.kind must be a non-empty string' });
  }
  return issues;
}

/**
 * Detect a cycle that would be created by adding `link` (parent -> child) to
 * the ancestry graph, and return the full chain (e.g. A,B,C,A) or null.
 *
 * Direction: edges point parent -> child, so we walk DOWN from the proposed
 * child through existing children; reaching the proposed parent means the new
 * edge closes the loop (child ... parent -> child).
 */
function cycleChainFor(
  link: GenealogyLink,
  edges: AncestryEdge[],
): string[] | null {
  const childOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childOf.get(edge.parent) ?? [];
    list.push(edge.child);
    childOf.set(edge.parent, list);
  }
  const target = link.from;
  const stack: Array<{ node: string; path: string[] }> = [{ node: link.to, path: [link.to] }];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === target) {
      // The walk started at link.to (the child); the new edge link.from->link.to
      // closes the loop back to that starting node.
      return [...path, path[0]];
    }
    if (seen.has(node)) continue;
    seen.add(node);
    for (const child of childOf.get(node) ?? []) {
      stack.push({ node: child, path: [...path, child] });
    }
  }
  return null;
}

export function validateGenealogy(
  characters: ReadonlyArray<{ id: string; [key: string]: unknown }>,
  proposal: ReadonlyArray<unknown>,
  relationships: ReadonlyArray<unknown> = [],
): GenealogyValidationResult {
  const characterIds = new Set(characters.map((c) => c.id));

  // Per-link pass: shape, kind, refs, self link. Invalid links are rejected
  // here and never reach the graph, so they cannot contaminate the batch.
  const accepted: GenealogyLink[] = [];
  const rejected: RejectedLink[] = [];

  // An id shared by several proposals is ambiguous: EVERY occurrence is
  // rejected, so no link enters the graph under a contested identity.
  const idCounts = new Map<string, number>();
  for (const raw of proposal) {
    if (isPlainObject(raw) && typeof raw.id === 'string') {
      idCounts.set(raw.id, (idCounts.get(raw.id) ?? 0) + 1);
    }
  }

  for (const raw of proposal) {
    const shape = shapeIssues(raw);
    if (shape.length > 0) {
      // The raw payload is kept (deep-copied) so the caller can see what was
      // rejected; it is typed `unknown` in RejectedLink for that reason.
      rejected.push({ link: deepCopy(raw), issues: shape });
      continue;
    }
    // Shape is verified above, so this cast is sound: id/from/to/kind are
    // non-empty strings and the value is a plain object.
    const link = deepCopy(raw) as GenealogyLink;

    const issues: GenealogyIssue[] = [];
    if (!VALID_KINDS.has(link.kind)) {
      issues.push({ code: 'unknown_kind', detail: `unknown genealogy kind: ${link.kind}` });
    }
    if (link.from === link.to) {
      issues.push({ code: 'self_link', detail: `link ${link.id} connects ${link.from} to itself` });
    }
    if (!characterIds.has(link.from)) {
      issues.push({ code: 'missing_ref', detail: `unknown character id: ${link.from}` });
    }
    if (!characterIds.has(link.to)) {
      issues.push({ code: 'missing_ref', detail: `unknown character id: ${link.to}` });
    }
    if (idCounts.get(link.id)! > 1) {
      issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${link.id}` });
    }

    if (issues.length > 0) {
      rejected.push({ link, issues });
      continue;
    }
    accepted.push(link);
  }

  // Cycle pass: each accepted parent link is checked against the graph of the
  // OTHER accepted parent links; a link that closes a loop is rejected.
  // finalAncestry grows as links are accepted, so it is always the graph of
  // the other accepted parent links at check time.
  const finalAccepted: GenealogyLink[] = [];
  const finalAncestry: AncestryEdge[] = [];
  for (const link of accepted) {
    if (!(ANCESTRY_KINDS as readonly string[]).includes(link.kind)) {
      finalAccepted.push(link);
      continue;
    }
    const others = finalAncestry;
    const chain = cycleChainFor(link, others);
    if (chain) {
      rejected.push({
        link,
        issues: [{
          code: 'ancestry_cycle',
          detail: `adding ${link.id} closes the ancestry chain ${chain.join('->')}`,
          chain,
        }],
      });
      continue;
    }
    finalAccepted.push(link);
    finalAncestry.push({
      linkId: link.id,
      parent: link.from,
      child: link.to,
      kind: link.kind as 'biological_parent' | 'adoptive_parent',
    });
  }

  return {
    contractVersion: GENEALOGY_CONTRACT_VERSION,
    accepted: finalAccepted,
    rejected,
    ancestry: finalAncestry,
    // Generic relationships pass through verbatim; they are never interpreted.
    relationships: deepCopy([...relationships]),
  };
}
