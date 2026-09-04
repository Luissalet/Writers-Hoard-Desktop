// ============================================================================
// A recipe — everything a picture was made from, and how two of them differ
// ============================================================================
//
// «Iterate on this» and «Compare» both need the same thing: the full set of
// knobs behind one generated image, read back out of the Gallery row. The
// recipe diff is the part a chat log structurally cannot show — «steps 20→30 ·
// seed changed · LoRA 0.8→1.0» is how a writer learns what the knobs do, and a
// stream of pictures with their prompts underneath never teaches it.
//
// The AI-runtime branch is widening `ImageGenerationInfo` with cfg, sampler,
// scheduler, a model hash and the LoRAs. Every one of them is read here as
// optional and feature-detected, so this compiles against today's shape and
// starts diffing more the day the wider one lands.

import type { ImageGenerationInfo } from '@/types';

/**
 * The fields the AI-runtime branch is adding to `ImageGenerationInfo`. Declared
 * as an intersection rather than waited for: `ImageGenerationInfo & Partial<T>`
 * is legal whether or not the real type has grown them yet, so nothing here
 * needs an `unknown` cast and nothing breaks on the merge.
 */
interface WidenedGenerationInfo {
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  /** Content hash of the weights: what tells a recipe its model changed. */
  modelHash?: string;
  loras?: { name: string; weight: number }[];
  /** The visual refs that were resolved into this generation. */
  visualRefIds?: string[];
}

export interface Recipe {
  prompt: string;
  negativePrompt?: string;
  connectionId: string;
  modelId: string;
  modelHash?: string;
  seed?: number;
  width: number;
  height: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  loras: { name: string; weight: number }[];
  visualRefIds: string[];
  createdAt: number;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Read a Gallery row's provenance as a recipe. Absent fields stay absent. */
export function readRecipe(info: ImageGenerationInfo): Recipe {
  const wide = info as ImageGenerationInfo & Partial<WidenedGenerationInfo>;
  return {
    prompt: info.prompt,
    negativePrompt: stringOrUndefined(info.negativePrompt),
    connectionId: info.connectionId,
    modelId: info.modelId,
    modelHash: stringOrUndefined(wide.modelHash),
    seed: numberOrUndefined(info.seed),
    width: info.width,
    height: info.height,
    steps: numberOrUndefined(info.steps),
    cfg: numberOrUndefined(wide.cfg),
    sampler: stringOrUndefined(wide.sampler),
    scheduler: stringOrUndefined(wide.scheduler),
    loras: Array.isArray(wide.loras)
      ? wide.loras.filter((lora) => typeof lora?.name === 'string').map((lora) => ({
        name: lora.name,
        weight: numberOrUndefined(lora.weight) ?? 1,
      }))
      : [],
    visualRefIds: Array.isArray(wide.visualRefIds)
      ? wide.visualRefIds.filter((id): id is string => typeof id === 'string')
      : [],
  createdAt: info.createdAt,
  };
}

/** One difference between two recipes, ready to be shown under a comparison. */
export interface RecipeDifference {
  field: string;
  /** Absent when the field was unset on that side. */
  before?: string;
  after?: string;
}

const SCALAR_FIELDS = ['steps', 'cfg', 'sampler', 'scheduler', 'width', 'height', 'seed', 'modelId'] as const;

function show(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

/**
 * What changed between two recipes. Prompts are compared whole rather than
 * word by word: a partial prompt diff reads as a rewrite even when only a
 * comma moved, and the composer already shows both prompts in full.
 */
export function diffRecipes(before: Recipe, after: Recipe): RecipeDifference[] {
  const differences: RecipeDifference[] = [];
  for (const field of SCALAR_FIELDS) {
    const left = show(before[field]);
    const right = show(after[field]);
    if (left !== right) differences.push({ field, before: left, after: right });
  }
  if (before.prompt.trim() !== after.prompt.trim()) {
    differences.push({ field: 'prompt', before: before.prompt, after: after.prompt });
  }
  if ((before.negativePrompt ?? '').trim() !== (after.negativePrompt ?? '').trim()) {
    differences.push({ field: 'negativePrompt', before: before.negativePrompt, after: after.negativePrompt });
  }
  const names = new Set([...before.loras, ...after.loras].map((lora) => lora.name));
  for (const name of [...names].sort()) {
    const left = before.loras.find((lora) => lora.name === name);
    const right = after.loras.find((lora) => lora.name === name);
    const leftWeight = left ? left.weight.toFixed(2) : undefined;
    const rightWeight = right ? right.weight.toFixed(2) : undefined;
    if (leftWeight !== rightWeight) {
      differences.push({ field: `lora:${name}`, before: leftWeight, after: rightWeight });
    }
  }
  return differences;
}

/**
 * Whether the weights a recipe was made with are still the ones installed.
 *
 * `'gone'` means the model id is not installed at all; `'changed'` means the id
 * is there but the file behind it is not the same one. Both must be SAID, never
 * worked around: silently generating with the nearest model destroys the
 * meaning of every recipe the writer has stored, because the next one that
 * reproduces will do so by luck.
 */
export function checkRecipeModel(
  recipe: Recipe,
  installed: readonly { id: string; fileHash?: string }[],
): 'ok' | 'gone' | 'changed' {
  const match = installed.find((model) => model.id === recipe.modelId);
  if (!match) return 'gone';
  if (recipe.modelHash && match.fileHash && recipe.modelHash !== match.fileHash) return 'changed';
  return 'ok';
}

/** Seeds for a batch of variations: the recipe's seed, then ±1, ±2, … */
export function variationSeeds(seed: number, count: number): number[] {
  const seeds: number[] = [];
  for (let offset = 0; seeds.length < count; offset += 1) {
    if (offset === 0) seeds.push(seed);
    else {
      // Seeds are unsigned on every server here; stepping below zero would be
      // silently clamped to a repeat of 0 and the batch would show duplicates.
      if (seeds.length < count) seeds.push(seed + offset);
      if (seeds.length < count && seed - offset >= 0) seeds.push(seed - offset);
    }
  }
  return seeds.slice(0, count);
}
