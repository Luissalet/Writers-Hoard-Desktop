// ============================================================================
// ComfyUI — the binding layer (never a node editor)
// ============================================================================
//
// Two rules earn this file its existence:
//
//  1. Resolve a binding BY TITLE first, by node id second. ComfyUI renumbers
//     nodes whenever a workflow is re-exported, so an id-only binding breaks
//     the moment the user re-saves a template — the brittleness every ComfyUI
//     integration hits. Titles survive.
//
//  2. Node ids are NEVER regenerated. ComfyUI's execution cache is keyed on
//     them, so a fresh id per submission turns every run into a cold run while
//     the graph still looks correct. Templates ship with literal ids and every
//     operation here preserves them; dropping an unused occurrence rewires the
//     links instead of renumbering what is left.

import type { ComfyGraph, ComfyLink, ComfyInputValue, ComfyNode, ComfySlotInstance, ComfyTemplate } from './types';

export type BindingResolution =
  | { ok: true; node: string; input: string }
  | { ok: false; reason: string };

export function isLink(value: ComfyInputValue): value is ComfyLink {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

/** Deep copy that keeps links as fresh arrays, so a build never edits the asset. */
export function cloneGraph(graph: ComfyGraph): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    const inputs: Record<string, ComfyInputValue> = {};
    for (const [name, value] of Object.entries(node.inputs)) {
      inputs[name] = isLink(value) ? [value[0], value[1]] : value;
    }
    const copy: ComfyNode = { class_type: node.class_type, inputs };
    if (node._meta?.title !== undefined) copy._meta = { title: node._meta.title };
    out[id] = copy;
  }
  return out;
}

/**
 * Lowest id wins when two nodes share a title. Deterministic beats clever: a
 * duplicate title is an authoring mistake the template test catches, and a
 * build that silently picked a different node on each run would be worse than
 * one that always picks the same wrong node.
 */
export function findNodeByTitle(graph: ComfyGraph, title: string): string | null {
  const matches = Object.keys(graph).filter((id) => graph[id]._meta?.title === title);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => a.localeCompare(b, 'en'))[0];
}

export function resolveBinding(graph: ComfyGraph, binding: { title?: string; node?: string; input: string }): BindingResolution {
  const byTitle = binding.title ? findNodeByTitle(graph, binding.title) : null;
  const id = byTitle ?? (binding.node && graph[binding.node] ? binding.node : null);
  if (!id) {
    const named = binding.title ? `titled "${binding.title}"` : `with id "${binding.node ?? '?'}"`;
    return { ok: false, reason: `no node ${named} in this graph` };
  }
  if (!(binding.input in graph[id].inputs)) {
    return { ok: false, reason: `node "${id}" (${graph[id].class_type}) has no input "${binding.input}"` };
  }
  return { ok: true, node: id, input: binding.input };
}

export type ApplyFailure = { key: string; reason: string };

/**
 * Write bound values into a copy of the graph. A value for a key the template
 * does not declare is a caller bug and is reported, not ignored: silently
 * dropping "seed" would produce a picture nobody asked for.
 */
export function applyBindings(
  template: ComfyTemplate,
  graph: ComfyGraph,
  values: Record<string, ComfyInputValue | undefined>,
): { graph: ComfyGraph; failures: ApplyFailure[] } {
  const next = cloneGraph(graph);
  const failures: ApplyFailure[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const binding = template.bindings[key];
    if (!binding) {
      failures.push({ key, reason: 'the template declares no such input' });
      continue;
    }
    const resolved = resolveBinding(next, binding);
    if (!resolved.ok) {
      failures.push({ key, reason: resolved.reason });
      continue;
    }
    next[resolved.node].inputs[resolved.input] = value;
  }
  return { graph: next, failures };
}

/** Every link in the graph that points at `[node, output]`, repointed. */
function repoint(graph: ComfyGraph, from: ComfyLink, to: ComfyInputValue): void {
  for (const node of Object.values(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value) && value[0] === from[0] && value[1] === from[1]) {
        node.inputs[name] = isLink(to) ? [to[0], to[1]] : to;
      }
    }
  }
}

/**
 * Keep only the listed occurrences of a slot and remove the rest. Dropping is
 * done from the last occurrence backwards so a chain collapses one link at a
 * time: each removed node's consumers are repointed at whatever fed the input
 * its output passes through, which for a LoRA chain, a region combine or a
 * ControlNet apply is exactly the upstream node.
 *
 * A dropped occurrence is DELETED, not orphaned: ComfyUI validates the
 * class_type of every node in a prompt, reachable or not, so an orphan whose
 * pack is missing would still fail the whole submission.
 */
export function pruneSlot(graph: ComfyGraph, instances: readonly ComfySlotInstance[], keep: readonly number[]): void {
  const kept = new Set(keep);
  for (let index = instances.length - 1; index >= 0; index -= 1) {
    if (kept.has(index)) continue;
    const instance = instances[index];
    for (const pass of instance.passthrough ?? []) {
      const node = graph[pass.node];
      if (!node) continue;
      const source = node.inputs[pass.input];
      if (source === undefined) continue;
      repoint(graph, [pass.node, pass.output], source);
    }
    for (const id of instance.remove) delete graph[id];
  }
}

/** Links that point at a node the graph no longer holds. Always empty in a good build. */
export function danglingLinks(graph: ComfyGraph): string[] {
  const bad: string[] = [];
  for (const [id, node] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value) && !graph[value[0]]) bad.push(`${id}.${name} → ${value[0]}`);
    }
  }
  return bad;
}

/** Node classes the graph actually uses — what the capability check must cover. */
export function classesUsed(graph: ComfyGraph): string[] {
  return [...new Set(Object.values(graph).map((node) => node.class_type))].sort();
}
