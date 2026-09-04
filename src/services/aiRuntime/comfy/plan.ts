// ============================================================================
// ComfyUI — everything that must be true before a prompt is submitted
// ============================================================================
//
// Degradation is a requirement, not a courtesy, so it lives in one pure
// function the adapter calls and the tests exercise: a template whose node
// pack is missing is refused with the pack's name, a model a recipe names but
// this install does not have is refused with the nearest thing installed, and
// neither ever reaches /prompt. A workflow ComfyUI rejects on validation is
// worse than a feature the user can see is unavailable.

import { buildGraph } from './build';
import { classesUsed } from './bindings';
import { checkTemplate } from './capability';
import { missingModelMessage } from './match';
import { joinNames, packsForClasses } from './nodePacks';
import {
  hasClass,
  listCheckpoints,
  listControlNets,
  listDetectors,
  listLoras,
  listUpscaleModels,
  type ComfyObjectInfo,
} from './objectInfo';
import type { TemplateRegistry } from './template';
import type { AiErrorCode } from '../types';
import type { ComfyGraph, ComfyRecipe, ComfyTemplate } from './types';

export type PlanResult =
  | { ok: true; template: ComfyTemplate; graph: ComfyGraph }
  | { ok: false; code: AiErrorCode; error: string };

export function missingClassMessage(missing: readonly string[]): string {
  const packs = packsForClasses(missing);
  if (packs.length) {
    return `This needs ${joinNames(packs.map((pack) => pack.pack))}. Install it with ComfyUI Manager and restart ComfyUI.`;
  }
  return `This ComfyUI does not provide ${joinNames(missing)}. Update ComfyUI.`;
}

/**
 * A recipe carrying something the chosen template has nowhere to put. It is an
 * error rather than a shrug: rendering a two-character scene without its
 * regions, or an inpaint without its mask, gives back a picture that looks
 * finished and is not the one that was asked for.
 */
function unusedFeature(template: ComfyTemplate, recipe: ComfyRecipe): string | null {
  const slot = (name: string): boolean => Boolean(template.slots?.[name]?.length);
  const binding = (key: string): boolean => key in template.bindings;
  if (recipe.regions?.length && !slot('region')) return `"${template.label}" cannot take masked regions. Use the regional prompting template.`;
  if (recipe.controls?.length && !slot('control')) return `"${template.label}" cannot take ControlNets. Use the multi-ControlNet template.`;
  if (recipe.detail?.length && !slot('detail')) return `"${template.label}" cannot take a detail pass. Use the detail template.`;
  if (recipe.loras.length && !slot('lora')) return `"${template.label}" cannot take LoRAs.`;
  if (recipe.guidance !== 'none' && !slot('guidance')) return `"${template.label}" has no guidance presets; set guidance to off.`;
  if (recipe.upscale && !binding('upscaleModel')) return `"${template.label}" is not a tiled upscale. Use the Ultimate SD Upscale template.`;
  if (recipe.hires && !binding('hiresWidth')) return `"${template.label}" has no second pass, so the hires settings would be ignored. Turn them off, or upscale the result afterwards.`;
  if (recipe.crop && !binding('crop.x')) return `"${template.label}" repaints the whole picture, so the "only masked" area would be ignored.`;
  if (recipe.sourceImage && !binding('sourceImage')) return `"${template.label}" does not take a source image.`;
  if (recipe.maskImage && !binding('maskImage')) return `"${template.label}" does not take a mask.`;
  return null;
}

export function planSubmission(registry: TemplateRegistry, info: ComfyObjectInfo, recipe: ComfyRecipe): PlanResult {
  const template = registry.byId(recipe.templateId);
  if (!template) {
    return { ok: false, code: 'bad-request', error: `There is no ComfyUI template called "${recipe.templateId}".` };
  }
  const availability = checkTemplate(template, info);
  if (!availability.ok) return { ok: false, code: 'bad-request', error: availability.message };

  const unused = unusedFeature(template, recipe);
  if (unused) return { ok: false, code: 'bad-request', error: unused };

  const checkpoints = listCheckpoints(info);
  if (!checkpoints.includes(recipe.checkpoint)) {
    return { ok: false, code: 'model-missing', error: missingModelMessage('checkpoint', recipe.checkpoint, checkpoints) };
  }
  const loras = listLoras(info);
  for (const lora of recipe.loras) {
    if (!loras.includes(lora.name)) {
      return { ok: false, code: 'model-missing', error: missingModelMessage('LoRA', lora.name, loras) };
    }
  }
  const controlNets = listControlNets(info);
  for (const control of recipe.controls ?? []) {
    if (!controlNets.includes(control.model)) {
      return { ok: false, code: 'model-missing', error: missingModelMessage('ControlNet', control.model, controlNets) };
    }
  }
  const detectors = listDetectors(info);
  for (const stage of recipe.detail ?? []) {
    if (!detectors.includes(stage.detector)) {
      return { ok: false, code: 'model-missing', error: missingModelMessage('detector', stage.detector, detectors) };
    }
  }
  if (recipe.upscale) {
    const upscalers = listUpscaleModels(info);
    if (!upscalers.includes(recipe.upscale.model)) {
      return { ok: false, code: 'model-missing', error: missingModelMessage('upscale model', recipe.upscale.model, upscalers) };
    }
  }

  const built = buildGraph(template, recipe);
  if (!built.ok) return { ok: false, code: 'bad-request', error: built.error };

  // The template's own `requires` covers the graph it ships with; this covers
  // what the recipe kept — a guidance preset or a detail pass can bring in a
  // class the minimum graph never touches.
  const missing = classesUsed(built.graph).filter((className) => !hasClass(info, className));
  if (missing.length) return { ok: false, code: 'bad-request', error: missingClassMessage(missing) };

  return { ok: true, template, graph: built.graph };
}
