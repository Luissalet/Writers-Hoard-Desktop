// ============================================================================
// ComfyUI — bring your own workflow
// ============================================================================
//
// A power user exports an API-format workflow from ComfyUI and drops it into
// the project. The app reads /object_info, lists the literal inputs the graph
// exposes, and lets them point app concepts — the prompt, the seed, a
// reference image — at node inputs. That is the whole feature: the binding
// resolver already exists, so this adds a listing and a guess, and no canvas.

import { isLink } from './bindings';
import { inputSpec, type ComfyObjectInfo } from './objectInfo';
import { parseGraph } from './template';
import type { ComfyBinding, ComfyBindingKind, ComfyGraph, ComfyInputValue, ComfyTemplate } from './types';

export interface DiscoveredInput {
  node: string;
  title: string;
  classType: string;
  input: string;
  kind: ComfyBindingKind;
  value: ComfyInputValue;
  /** Combo inputs carry their option list, which is what the folder holds. */
  options?: string[];
}

const SEED_NAMES = new Set(['seed', 'noise_seed']);
const IMAGE_INPUTS = new Set(['image']);

function inferKind(classType: string, input: string, type: string, options: string[] | undefined): ComfyBindingKind | null {
  if (options) return IMAGE_INPUTS.has(input) && /LoadImage/.test(classType) ? 'image' : 'choice';
  if (type === 'STRING') return 'text';
  if (type === 'BOOLEAN') return 'boolean';
  if (type === 'INT') return SEED_NAMES.has(input) ? 'seed' : 'number';
  if (type === 'FLOAT') return 'number';
  return null;
}

/** Every literal input of the graph that a recipe could sensibly drive. */
export function discoverInputs(graph: ComfyGraph, info: ComfyObjectInfo): DiscoveredInput[] {
  const found: DiscoveredInput[] = [];
  for (const id of Object.keys(graph).sort((a, b) => a.localeCompare(b, 'en'))) {
    const node = graph[id];
    for (const [input, value] of Object.entries(node.inputs)) {
      // A linked input is produced by another node: driving it from a recipe
      // would mean cutting the link, which is graph editing, not binding.
      if (isLink(value)) continue;
      const spec = inputSpec(info, node.class_type, input);
      if (!spec) continue;
      const kind = inferKind(node.class_type, input, spec.type, spec.options);
      if (!kind) continue;
      found.push({
        node: id,
        title: node._meta?.title ?? node.class_type,
        classType: node.class_type,
        input,
        kind,
        value,
        ...(spec.options ? { options: spec.options } : {}),
      });
    }
  }
  return found;
}

export type ComfyConcept = 'prompt' | 'negative' | 'seed' | 'width' | 'height' | 'batchSize' | 'checkpoint' | 'reference';

export type ComfyMapping = Partial<Record<ComfyConcept, { node: string; input: string }>>;

function pick(inputs: readonly DiscoveredInput[], match: (input: DiscoveredInput) => boolean): DiscoveredInput | undefined {
  return inputs.find(match);
}

/** A first guess the user corrects, not a decision made behind their back. */
export function suggestMapping(inputs: readonly DiscoveredInput[]): ComfyMapping {
  const texts = inputs.filter((entry) => entry.classType === 'CLIPTextEncode' && entry.input === 'text');
  const positive = pick(texts, (entry) => /pos/i.test(entry.title)) ?? texts[0];
  const negative = pick(texts, (entry) => /neg/i.test(entry.title)) ?? texts.find((entry) => entry !== positive);
  const mapping: ComfyMapping = {};
  const set = (concept: ComfyConcept, entry: DiscoveredInput | undefined): void => {
    if (entry) mapping[concept] = { node: entry.node, input: entry.input };
  };
  set('prompt', positive);
  set('negative', negative);
  set('seed', pick(inputs, (entry) => entry.kind === 'seed'));
  set('width', pick(inputs, (entry) => entry.classType === 'EmptyLatentImage' && entry.input === 'width'));
  set('height', pick(inputs, (entry) => entry.classType === 'EmptyLatentImage' && entry.input === 'height'));
  set('batchSize', pick(inputs, (entry) => entry.classType === 'EmptyLatentImage' && entry.input === 'batch_size'));
  set('checkpoint', pick(inputs, (entry) => entry.classType === 'CheckpointLoaderSimple' && entry.input === 'ckpt_name'));
  set('reference', pick(inputs, (entry) => entry.kind === 'image'));
  return mapping;
}

/** Concept names are the binding keys the builder already writes. */
const CONCEPT_KEYS: Record<ComfyConcept, string> = {
  prompt: 'prompt',
  negative: 'negative',
  seed: 'seed',
  width: 'width',
  height: 'height',
  batchSize: 'batchSize',
  checkpoint: 'checkpoint',
  reference: 'sourceImage',
};

const CONCEPT_KINDS: Record<ComfyConcept, ComfyBindingKind> = {
  prompt: 'text',
  negative: 'text',
  seed: 'seed',
  width: 'number',
  height: 'number',
  batchSize: 'number',
  checkpoint: 'choice',
  reference: 'image',
};

export type AdoptResult = { ok: true; template: ComfyTemplate } | { ok: false; error: string };

/**
 * Turn a user's workflow into a template. It binds by node id AND by the
 * node's own title, so a user who re-exports the workflow after renumbering
 * keeps their mapping as long as they left the titles alone.
 */
export function adoptWorkflow(raw: unknown, mapping: ComfyMapping, meta: { id: string; label: string }): AdoptResult {
  const graph = parseGraph(raw);
  if (!graph) return { ok: false, error: 'That file is not a ComfyUI workflow in API format. In ComfyUI, use Workflow → Export (API).' };
  const outputs = Object.values(graph).filter((node) => node.class_type === 'SaveImage' || node.class_type === 'PreviewImage');
  if (outputs.length === 0) {
    return { ok: false, error: 'That workflow has no Save Image or Preview Image node, so nothing would come back from it.' };
  }
  const bindings: Record<string, ComfyBinding> = {};
  for (const [concept, target] of Object.entries(mapping) as Array<[ComfyConcept, { node: string; input: string }]>) {
    const node = graph[target.node];
    if (!node) return { ok: false, error: `The workflow has no node "${target.node}" to map ${concept} onto.` };
    if (!(target.input in node.inputs)) {
      return { ok: false, error: `Node "${target.node}" (${node.class_type}) has no input "${target.input}".` };
    }
    const title = node._meta?.title;
    bindings[CONCEPT_KEYS[concept]] = {
      ...(title ? { title } : {}),
      node: target.node,
      input: target.input,
      kind: CONCEPT_KINDS[concept],
    };
  }
  return {
    ok: true,
    template: {
      id: meta.id,
      label: meta.label,
      description: 'Your own workflow.',
      requires: [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
      bindings,
      slots: {},
      graph,
    },
  };
}
