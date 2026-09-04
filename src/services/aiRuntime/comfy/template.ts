// ============================================================================
// ComfyUI — reading a template asset
// ============================================================================
//
// Templates ship as JSON so they can be inspected, diffed and (for a power
// user) copied straight into ComfyUI. That means they are parsed, not trusted:
// a malformed asset must be reported as one bad template, never as a crash
// that takes the whole backend with it. The same parser reads a workflow the
// user drops into the project, which is what makes "bring your own" cheap.

import type { ComfyGraph, ComfyInputValue, ComfyNode, ComfySlotInstance, ComfyTemplate } from './types';

const BINDING_KINDS = new Set(['text', 'number', 'boolean', 'choice', 'image', 'seed']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseInputValue(value: unknown): ComfyInputValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return undefined;
}

export function parseGraph(raw: unknown): ComfyGraph | null {
  const record = asRecord(raw);
  if (!record) return null;
  const graph: ComfyGraph = {};
  for (const [id, value] of Object.entries(record)) {
    const node = asRecord(value);
    const classType = node?.class_type;
    if (!node || typeof classType !== 'string' || !classType) return null;
    const inputs = asRecord(node.inputs) ?? {};
    const parsed: Record<string, ComfyInputValue> = {};
    for (const [name, input] of Object.entries(inputs)) {
      const clean = parseInputValue(input);
      if (clean === undefined) return null;
      parsed[name] = clean;
    }
    const built: ComfyNode = { class_type: classType, inputs: parsed };
    const title = asRecord(node._meta)?.title;
    if (typeof title === 'string') built._meta = { title };
    graph[id] = built;
  }
  return Object.keys(graph).length ? graph : null;
}

function parseSlots(raw: unknown): Record<string, ComfySlotInstance[]> | null {
  const record = asRecord(raw);
  if (!record) return {};
  const slots: Record<string, ComfySlotInstance[]> = {};
  for (const [name, value] of Object.entries(record)) {
    if (!Array.isArray(value)) return null;
    const instances: ComfySlotInstance[] = [];
    for (const entry of value) {
      const item = asRecord(entry);
      const remove = item?.remove;
      if (!Array.isArray(remove) || !remove.every((id): id is string => typeof id === 'string')) return null;
      const passthroughRaw = item?.passthrough;
      const passthrough: ComfySlotInstance['passthrough'] = [];
      if (passthroughRaw !== undefined) {
        if (!Array.isArray(passthroughRaw)) return null;
        for (const pass of passthroughRaw) {
          const item2 = asRecord(pass);
          if (!item2 || typeof item2.node !== 'string' || typeof item2.output !== 'number' || typeof item2.input !== 'string') {
            return null;
          }
          passthrough.push({ node: item2.node, output: item2.output, input: item2.input });
        }
      }
      instances.push({ remove, passthrough });
    }
    slots[name] = instances;
  }
  return slots;
}

export function parseTemplate(raw: unknown): ComfyTemplate | null {
  const record = asRecord(raw);
  if (!record) return null;
  const { id, label, description } = record;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof description !== 'string') return null;
  const requires = record.requires;
  if (!Array.isArray(requires) || !requires.every((entry): entry is string => typeof entry === 'string')) return null;
  const bindingsRaw = asRecord(record.bindings);
  if (!bindingsRaw) return null;
  const bindings: ComfyTemplate['bindings'] = {};
  for (const [key, value] of Object.entries(bindingsRaw)) {
    const binding = asRecord(value);
    if (!binding || typeof binding.input !== 'string' || typeof binding.kind !== 'string') return null;
    if (!BINDING_KINDS.has(binding.kind)) return null;
    if (typeof binding.title !== 'string' && typeof binding.node !== 'string') return null;
    bindings[key] = {
      ...(typeof binding.title === 'string' ? { title: binding.title } : {}),
      ...(typeof binding.node === 'string' ? { node: binding.node } : {}),
      input: binding.input,
      kind: binding.kind as ComfyTemplate['bindings'][string]['kind'],
    };
  }
  const graph = parseGraph(record.graph);
  if (!graph) return null;
  const slots = parseSlots(record.slots);
  if (!slots) return null;
  return { id, label, description, requires, bindings, slots, graph };
}

export interface TemplateRegistry {
  all: ComfyTemplate[];
  byId(id: string): ComfyTemplate | null;
  /** Assets that did not parse, by index — reported, never silently dropped. */
  rejected: number[];
}

export function createTemplateRegistry(assets: readonly unknown[]): TemplateRegistry {
  const all: ComfyTemplate[] = [];
  const rejected: number[] = [];
  assets.forEach((asset, index) => {
    const template = parseTemplate(asset);
    if (template) all.push(template);
    else rejected.push(index);
  });
  const index = new Map(all.map((template) => [template.id, template]));
  return { all, rejected, byId: (id) => index.get(id) ?? null };
}
