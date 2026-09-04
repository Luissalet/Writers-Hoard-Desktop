// ============================================================================
// ComfyUI — recipe into graph
// ============================================================================
//
// The whole point of the Bench: a recipe declares intent, and this turns it
// into a graph ComfyUI will accept. Nothing here invents a node — it prunes
// the occurrences the recipe does not use out of a shipped template and writes
// values through the declared bindings.
//
// Node ids come from the template asset and are never regenerated, because
// ComfyUI's execution cache is keyed on them: the same recipe submitted twice
// must produce byte-identical ids or every run is a cold run.

import { applyBindings, cloneGraph, danglingLinks, pruneSlot, resolveBinding } from './bindings';
import type { ComfyGraph, ComfyGuidancePreset, ComfyInputValue, ComfyRecipe, ComfyTemplate } from './types';

/**
 * Which nodes of the guidance chain each preset keeps. The chain is authored
 * once, in the template; a preset is a subset of it, so a writer chooses
 * "Coherent" and never a PAG scale.
 */
const GUIDANCE_INSTANCES: Record<ComfyGuidancePreset, number[]> = {
  none: [],
  coherent: [0],
  detailed: [1, 2],
  'distilled-negatives': [3],
};

export const GUIDANCE_PRESETS: ReadonlyArray<{ id: ComfyGuidancePreset; label: string; note: string }> = [
  { id: 'none', label: 'Off', note: 'The model as it is.' },
  {
    id: 'coherent',
    label: 'Coherent',
    note: 'Perturbed-attention guidance: fewer melted limbs and broken structures. Roughly doubles the time per step.',
  },
  {
    id: 'detailed',
    label: 'Detailed',
    note: 'FreeU plus self-attention guidance: sharper texture and small detail. Slower, and can over-sharpen flat art.',
  },
  {
    id: 'distilled-negatives',
    label: 'Distilled-model negatives',
    note: 'Rescales CFG so a negative prompt still bites on a distilled or turbo checkpoint instead of burning the image.',
  },
];

function range(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_value, index) => index);
}

/** Which occurrence of each slot the recipe actually uses. */
export function planSlots(template: ComfyTemplate, recipe: ComfyRecipe): Record<string, number[]> {
  const plan: Record<string, number[]> = {};
  for (const [name, instances] of Object.entries(template.slots ?? {})) {
    const limit = instances.length;
    switch (name) {
      case 'lora':
        plan[name] = range(Math.min(recipe.loras.length, limit));
        break;
      case 'guidance':
        plan[name] = GUIDANCE_INSTANCES[recipe.guidance].filter((index) => index < limit);
        break;
      case 'region':
        plan[name] = range(Math.min(recipe.regions?.length ?? 0, limit));
        break;
      case 'control':
        plan[name] = range(Math.min(recipe.controls?.length ?? 0, limit));
        break;
      case 'detail':
        plan[name] = range(Math.min(recipe.detail?.length ?? 0, limit));
        break;
      default:
        // An unknown slot is kept whole: dropping occurrences of something
        // this build does not understand would quietly change the picture.
        plan[name] = range(limit);
        break;
    }
  }
  return plan;
}

function collect(template: ComfyTemplate, recipe: ComfyRecipe, plan: Record<string, number[]>): Record<string, ComfyInputValue> {
  const values: Record<string, ComfyInputValue> = {};
  const put = (key: string, value: ComfyInputValue | undefined): void => {
    if (value === undefined) return;
    if (!(key in template.bindings)) return;
    values[key] = value;
  };

  put('checkpoint', recipe.checkpoint);
  put('prompt', recipe.prompt);
  put('negative', recipe.negativePrompt);
  put('width', recipe.width);
  put('height', recipe.height);
  put('batchSize', recipe.batchSize);
  put('seed', recipe.seed);
  put('steps', recipe.steps);
  put('cfg', recipe.cfg);
  put('samplerName', recipe.samplerName);
  put('scheduler', recipe.scheduler);
  put('denoise', recipe.denoise);
  put('filenamePrefix', recipe.filenamePrefix);
  put('sourceImage', recipe.sourceImage);
  put('maskImage', recipe.maskImage);
  put('growMaskBy', recipe.growMaskBy);

  for (const index of plan.lora ?? []) {
    const lora = recipe.loras[index];
    const slot = index + 1;
    put(`lora.${slot}.name`, lora.name);
    put(`lora.${slot}.model`, lora.weight);
    put(`lora.${slot}.clip`, lora.weight);
  }
  for (const index of plan.region ?? []) {
    const region = (recipe.regions ?? [])[index];
    const slot = index + 1;
    put(`region.${slot}.prompt`, region.prompt);
    put(`region.${slot}.mask`, region.mask);
    put(`region.${slot}.strength`, region.strength);
  }
  for (const index of plan.control ?? []) {
    const control = (recipe.controls ?? [])[index];
    const slot = index + 1;
    put(`control.${slot}.model`, control.model);
    put(`control.${slot}.image`, control.image);
    put(`control.${slot}.strength`, control.strength);
    put(`control.${slot}.start`, control.startPercent);
    put(`control.${slot}.end`, control.endPercent);
  }
  for (const index of plan.detail ?? []) {
    const stage = (recipe.detail ?? [])[index];
    const slot = index + 1;
    put(`detail.${slot}.detector`, stage.detector);
    put(`detail.${slot}.prompt`, stage.prompt);
    put(`detail.${slot}.denoise`, stage.denoise);
    put(`detail.${slot}.seed`, recipe.seed + index);
    put(`detail.${slot}.steps`, recipe.steps);
    put(`detail.${slot}.cfg`, recipe.cfg);
    put(`detail.${slot}.samplerName`, recipe.samplerName);
    put(`detail.${slot}.scheduler`, recipe.scheduler);
  }

  const crop = recipe.crop;
  if (crop) {
    // The same rectangle is written into four nodes: cut the source, cut the
    // mask, scale the result back, and paste it where it came from. Deriving
    // them here keeps "only masked" a property of the recipe rather than four
    // numbers a caller has to keep consistent.
    put('crop.x', crop.x);
    put('crop.y', crop.y);
    put('crop.width', crop.width);
    put('crop.height', crop.height);
    put('cropMask.x', crop.x);
    put('cropMask.y', crop.y);
    put('cropMask.width', crop.width);
    put('cropMask.height', crop.height);
    put('back.width', crop.width);
    put('back.height', crop.height);
    put('paste.x', crop.x);
    put('paste.y', crop.y);
    put('work.width', recipe.workWidth ?? crop.width);
    put('work.height', recipe.workHeight ?? crop.height);
    put('workMask.width', recipe.workWidth ?? crop.width);
    put('workMask.height', recipe.workHeight ?? crop.height);
  }

  if (recipe.hires) {
    put('hiresWidth', recipe.hires.width);
    put('hiresHeight', recipe.hires.height);
    put('hiresSeed', recipe.seed);
    put('hiresSteps', recipe.hires.steps);
    put('hiresCfg', recipe.cfg);
    put('hiresSamplerName', recipe.samplerName);
    put('hiresScheduler', recipe.scheduler);
    put('hiresDenoise', recipe.hires.denoise);
  }

  if (recipe.upscale) {
    put('upscaleModel', recipe.upscale.model);
    put('upscaleBy', recipe.upscale.by);
    put('denoise', recipe.upscale.denoise);
    put('tileWidth', recipe.upscale.tileWidth);
    put('tileHeight', recipe.upscale.tileHeight);
  }

  return values;
}

/**
 * A detector file under `segm/` produces a real segmentation mask on the
 * provider's second output; a `bbox/` one produces a placeholder there that
 * the detailer cannot use. So the optional input is wired only for the first
 * case — connecting it unconditionally is how "segmentation-refined" turns
 * into a run-time failure on the common setup.
 */
function wireSegmentation(graph: ComfyGraph, template: ComfyTemplate, recipe: ComfyRecipe, plan: Record<string, number[]>): void {
  for (const index of plan.detail ?? []) {
    const stage = (recipe.detail ?? [])[index];
    if (!stage || !stage.detector.startsWith('segm/')) continue;
    const detectorBinding = template.bindings[`detail.${index + 1}.detector`];
    const workerBinding = template.bindings[`detail.${index + 1}.denoise`];
    if (!detectorBinding || !workerBinding) continue;
    const detector = resolveBinding(graph, detectorBinding);
    const worker = resolveBinding(graph, workerBinding);
    if (!detector.ok || !worker.ok) continue;
    graph[worker.node].inputs.segm_detector_opt = [detector.node, 1];
  }
}

export type BuildResult = { ok: true; graph: ComfyGraph } | { ok: false; error: string };

export function buildGraph(template: ComfyTemplate, recipe: ComfyRecipe): BuildResult {
  const plan = planSlots(template, recipe);
  const graph = cloneGraph(template.graph);
  for (const [name, instances] of Object.entries(template.slots ?? {})) {
    pruneSlot(graph, instances, plan[name] ?? []);
  }
  const { graph: bound, failures } = applyBindings(template, graph, collect(template, recipe, plan));
  if (failures.length) {
    const first = failures[0];
    return { ok: false, error: `Template "${template.id}" cannot take "${first.key}": ${first.reason}.` };
  }
  wireSegmentation(bound, template, recipe, plan);
  const dangling = danglingLinks(bound);
  if (dangling.length) {
    return { ok: false, error: `Template "${template.id}" left a broken link after pruning: ${dangling[0]}.` };
  }
  return { ok: true, graph: bound };
}

// ---------------------------------------------------------------------------
// Choosing a template
// ---------------------------------------------------------------------------

export interface ComfyIntent {
  regions: number;
  controls: number;
  detailStages: number;
  hasSource: boolean;
  hasMask: boolean;
  wantsUpscale: boolean;
  wantsHires: boolean;
}

/**
 * One recipe, one template. The order is by how much of the request would be
 * thrown away by choosing something else: an upscale or a detail pass needs
 * the source image it was given, an inpaint needs its mask, and regions are
 * the reason someone picked this backend at all.
 */
export function chooseTemplateId(intent: ComfyIntent): string {
  if (intent.wantsUpscale && intent.hasSource) return 'ultimate-upscale';
  if (intent.detailStages > 0 && intent.hasSource) return 'detailer';
  if (intent.hasSource && intent.hasMask) return 'inpaint';
  if (intent.regions > 0) return 'regional';
  if (intent.controls > 0) return 'multi-controlnet';
  if (intent.wantsHires) return 'hires';
  return 'txt2img';
}
