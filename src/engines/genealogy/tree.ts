// ============================================================================
// Genealogy tree builder (W3) — pure structure, no I/O, no mutation.
//
// buildGenealogyTree(characters, links) turns validated genealogy links into
// the structure a tree view needs:
//
//   - ancestry nesting comes ONLY from biological_parent / adoptive_parent
//     links (parent -> child); guardian and partner never nest anyone;
//   - a character with no known parent is a root; a child of two parents
//     appears under each of them (multi-parent is allowed, as in validate.ts);
//   - links that reference an unknown character do not nest anything and are
//     reported in `orphans` (the builder is tolerant: validate.ts already
//     flags missing_ref, but the view must not crash on stale data);
//   - ancestry cycles are detected and reported in `cycles`; the cycle is
//     broken by treating every member as a root instead of recursing forever;
//   - partner links are grouped into unordered `partnerships` (a<->b once),
//     with their labels merged in first-seen order;
//   - never mutates its inputs: everything is deep-copied on the way in.
// ============================================================================

import { ANCESTRY_KINDS } from './validate.ts';

/** A character as the tree needs it: id plus display name. */
export interface TreeCharacter {
  id: string;
  name: string;
}

/** A node of the tree: a character and its nested children. */
export interface GenealogyTreeNode {
  character: TreeCharacter;
  children: GenealogyTreeNode[];
}

/** An ancestry link whose referenced character does not exist. */
export interface OrphanEdge {
  linkId: string;
  from: string;
  to: string;
  /** The id that is not among the characters. */
  missing: string;
}

/** A group of characters joined by partner links. */
export interface Partnership {
  /** Character ids, in first-seen order. */
  members: string[];
  /** Distinct labels of the partner links, in first-seen order. */
  labels: string[];
}

export interface GenealogyTree {
  roots: GenealogyTreeNode[];
  orphans: OrphanEdge[];
  partnerships: Partnership[];
  /** Each cycle as a chain of ids, e.g. ['a', 'b', 'a']. */
  cycles: string[][];
}

function isAncestryKind(kind: unknown): boolean {
  return (ANCESTRY_KINDS as readonly string[]).includes(kind as string);
}

/**
 * Detect ancestry cycles among the parent->child edges and return each cycle
 * as a closed chain of ids. Self-links are reported too.
 */
function findCycles(edges: Array<{ from: string; to: string }>): string[][] {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenOf.get(e.from) ?? [];
    list.push(e.to);
    childrenOf.set(e.from, list);
  }
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();
  // Walk from every node; stop at the first revisit to report the loop once.
  for (const start of childrenOf.keys()) {
    const stack: Array<{ node: string; path: string[] }> = [
      { node: start, path: [start] },
    ];
    while (stack.length > 0) {
      const { node, path } = stack.pop()!;
      for (const child of childrenOf.get(node) ?? []) {
        const at = path.indexOf(child);
        if (at !== -1) {
          const cycle = [...path.slice(at), child];
          // Same loop walked from a different start yields a different chain;
          // deduplicate by the set of members so each cycle is reported once.
          const key = [...new Set(cycle)].sort().join('\u0000');
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push(cycle);
          }
        } else {
          stack.push({ node: child, path: [...path, child] });
        }
      }
    }
  }
  return cycles;
}

/**
 * Build the renderable tree. `characters` must carry at least `id` and `name`;
 * `links` are genealogy links as produced by the importers/validator.
 */
export function buildGenealogyTree(
  characters: Array<{ id: string; name?: string }>,
  links: Array<{ id: string; from: string; to: string; kind: string; label?: string }>,
): GenealogyTree {
  // Deep copy on the way in: never mutate or share caller state.
  const chars: TreeCharacter[] = structuredClone(characters).map((c) => ({
    id: c.id,
    name: c.name ?? c.id,
  }));
  const byId = new Map(chars.map((c) => [c.id, c]));

  const ancestry = links.filter((l) => isAncestryKind(l.kind));
  const cycles = findCycles(ancestry.map((l) => ({ from: l.from, to: l.to })));
  const cycleMembers = new Set(cycles.flat());

  // Parent -> children map, skipping edges that reference unknown characters.
  const childrenOf = new Map<string, string[]>();
  const orphans: OrphanEdge[] = [];
  for (const link of ancestry) {
    const parentKnown = byId.has(link.from);
    const childKnown = byId.has(link.to);
    if (!parentKnown || !childKnown) {
      orphans.push({
        linkId: link.id,
        from: link.from,
        to: link.to,
        missing: parentKnown ? link.to : link.from,
      });
      continue;
    }
    const list = childrenOf.get(link.from) ?? [];
    list.push(link.to);
    childrenOf.set(link.from, list);
  }

  // A node is a root when it has no known parent edge that actually nested it.
  const hasParent = new Set<string>();
  for (const kids of childrenOf.values()) for (const k of kids) hasParent.add(k);

  const built = new Map<string, GenealogyTreeNode>();
  function nodeFor(id: string): GenealogyTreeNode {
    const existing = built.get(id);
    if (existing) return existing;
    const node: GenealogyTreeNode = {
      character: byId.get(id) ?? { id, name: id },
      children: [],
    };
    built.set(id, node);
    // A cycle member is a broken root: it does not nest its ancestry children,
    // otherwise the loop would render inside itself (A under B under A...).
    if (cycleMembers.has(id)) return node;
    for (const child of childrenOf.get(id) ?? []) node.children.push(nodeFor(child));
    return node;
  }

  const roots: GenealogyTreeNode[] = [];
  for (const c of chars) {
    // Cycle members are always roots: the loop is broken at every member so
    // the view renders instead of recursing forever.
    if (hasParent.has(c.id) && !cycleMembers.has(c.id)) continue;
    roots.push(nodeFor(c.id));
  }

  // Partnerships: unordered pairs, deduplicated, labels merged in first-seen
  // order. Self-partnership (a partner a) is kept as a single-member group.
  const pairIndex = new Map<string, Partnership>();
  const partnerships: Partnership[] = [];
  for (const link of links) {
    if (link.kind !== 'partner') continue;
    const key = [link.from, link.to].sort().join('\u0000');
    let p = pairIndex.get(key);
    if (!p) {
      p = { members: [...new Set([link.from, link.to])], labels: [] };
      pairIndex.set(key, p);
      partnerships.push(p);
    }
    if (link.label && !p.labels.includes(link.label)) p.labels.push(link.label);
  }

  return { roots, orphans, partnerships, cycles };
}

/** Summary numbers for the tree view header. */
export function treeStats(tree: GenealogyTree): {
  characters: number;
  roots: number;
  depth: number;
  orphans: number;
  partnerships: number;
} {
  let depth = 0;
  const stack: Array<{ node: GenealogyTreeNode; level: number }> = tree.roots.map((r) => ({
    node: r,
    level: 1,
  }));
  while (stack.length > 0) {
    const { node, level } = stack.pop()!;
    depth = Math.max(depth, level);
    for (const child of node.children) stack.push({ node: child, level: level + 1 });
  }
  return {
    characters: countNodes(tree.roots),
    roots: tree.roots.length,
    depth,
    orphans: tree.orphans.length,
    partnerships: tree.partnerships.length,
  };
}

function countNodes(roots: GenealogyTreeNode[]): number {
  let n = 0;
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    n += 1;
    stack.push(...node.children);
  }
  return n;
}
