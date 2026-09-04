// ============================================================================
// The resolver — [@Elena] + [scene] + [style] → one generation
// ============================================================================
//
// This, not the prompt box, is the product. A chat box cannot have a resolver:
// it has one string, so every layer a writer builds up — the LoRA, the
// canonical portrait, the fragment, the hero seed, the pinned pose — has to be
// retyped into that string by hand, in the right order, every time. That is the
// lottery this replaces.
//
// Two properties are load-bearing:
//
//   * It is PURE. No clock, no dice, no Dexie, no `window`. The caller rolls
//     the explore seed and hands it in. Two calls with the same arguments
//     return the same object, which is what makes a recipe diff meaningful and
//     what lets the whole order below be tested branch by branch.
//
//   * It EXPLAINS ITSELF. Every decision appends a step, and the composer shows
//     the steps under a "resolved prompt" disclosure. A writer who cannot see
//     what was sent cannot learn the tool, and a silently rewritten prompt
//     destroys the meaning of a seed: the same number stops reproducing the
//     same picture and the writer has no way to find out why.

import type { PromptDialect, VisualRef } from '@/types/visualRef';
import { adaptDialect, joinInDialect } from './dialect';
import type { ResolverModel } from './model';

/** The working band for a pinned pose. 0.4–0.7 holds the pose; 0.9 overcooks
 *  it and drags the reference's clothing along with the skeleton. */
export const POSE_CONTROL_WEIGHT = 0.55;

/** Guidance at or below this ignores the negative prompt entirely. */
export const NEGATIVE_PROMPT_MIN_CFG = 1;

/** How each subject's identity is being carried, in the order the rules try. */
export type IdentityStrategy = 'lora' | 'reference-image' | 'photomaker' | 'prompt-only';

/** One line of the disclosure. `code` names the rule; the UI translates it. */
export interface ResolutionStep {
  code:
    | 'lora'
    | 'loraFamilyMismatch'
    | 'loraUnsupported'
    | 'referenceImage'
    | 'photoMaker'
    | 'noCanonical'
    | 'canonicalUnused'
    | 'fragment'
    | 'dialectAdapted'
    | 'scene'
    | 'style'
    | 'negative'
    | 'negativeIgnored'
    | 'pose'
    | 'poseUnsupported'
    | 'seedHero'
    | 'seedManual'
    | 'seedExplore';
  /** The reference this step is about, when it is about one. */
  refId?: string;
  refName?: string;
  /** Values the translated line interpolates, e.g. `{ weight: '0.80' }`. */
  values?: Record<string, string>;
}

/** A reference image the request must carry, and what it is there for. */
export interface ResolvedReferenceImage {
  imageId: string;
  refId: string;
  role: 'identity' | 'face' | 'pose';
  /** ControlNet strength, for `role: 'pose'`. */
  weight?: number;
}

export interface ResolvedLora {
  fileName: string;
  weight: number;
  refId: string;
}

export type SeedMode = 'lock' | 'explore' | 'manual';

export interface ResolveOptions {
  seedMode: SeedMode;
  /** Used when `seedMode` is 'manual'. */
  manualSeed?: number;
  /**
   * Used when `seedMode` is 'explore'. The caller rolls it, not the resolver:
   * a resolver that reached for `Math.random()` could not be diffed against
   * itself, and every test of every other branch would inherit the noise.
   */
  exploreSeed?: number;
  /** The ref whose pinned pose to apply, and which of its poses. */
  pose?: { refId: string; imageId: string };
}

export interface ResolvedGeneration {
  /** Exactly the text that will be sent, trigger words first. */
  prompt: string;
  /** Absent when the model cannot honour negatives — never silently dropped. */
  negativePrompt?: string;
  seed?: number;
  seedMode: SeedMode;
  loras: ResolvedLora[];
  referenceImages: ResolvedReferenceImage[];
  /** How each subject's identity ended up being carried, by ref id. */
  strategies: Record<string, IdentityStrategy>;
  /** The dialect everything was written into: the model's. */
  dialect: PromptDialect;
  /** The disclosure, in the order the rules fired. */
  steps: ResolutionStep[];
}

function fragmentFor(
  ref: VisualRef,
  model: ResolverModel,
  steps: ResolutionStep[],
): string {
  const fragment = ref.promptFragment?.trim();
  if (!fragment) return '';
  const adapted = adaptDialect(fragment, ref.dialect, model.dialect);
  steps.push({ code: 'fragment', refId: ref.id, refName: ref.name });
  if (ref.dialect !== model.dialect) {
    steps.push({
      code: 'dialectAdapted',
      refId: ref.id,
      refName: ref.name,
      values: { from: ref.dialect, to: model.dialect },
    });
  }
  return adapted;
}

/**
 * Decide how one subject's identity is carried, in the order the contract
 * fixes: a matching LoRA, else a reference image, else a face adapter, else
 * the words alone. Appends its own steps; returns the text it contributes.
 */
function resolveSubject(
  ref: VisualRef,
  model: ResolverModel,
  out: {
    loras: ResolvedLora[];
    referenceImages: ResolvedReferenceImage[];
    strategies: Record<string, IdentityStrategy>;
    steps: ResolutionStep[];
  },
): string[] {
  const parts: string[] = [];
  const lora = ref.lora;
  let strategy: IdentityStrategy = 'prompt-only';

  if (lora) {
    if (!model.supportsLora) {
      out.steps.push({ code: 'loraUnsupported', refId: ref.id, refName: ref.name });
    } else if (model.family && lora.baseFamily !== model.family) {
      // Across families a LoRA is not weak, it is wrong: the weights address
      // layers that do not mean the same thing in the other architecture.
      out.steps.push({
        code: 'loraFamilyMismatch',
        refId: ref.id,
        refName: ref.name,
        values: { loraFamily: lora.baseFamily, modelFamily: model.family },
      });
    } else {
      strategy = 'lora';
      out.loras.push({ fileName: lora.fileName, weight: lora.weight, refId: ref.id });
      out.steps.push({
        code: 'lora',
        refId: ref.id,
        refName: ref.name,
        values: { file: lora.fileName, weight: lora.weight.toFixed(2) },
      });
      // The trigger word goes FIRST, before anything else this ref adds: the
      // token is what the LoRA was fused onto, and burying it behind a scene
      // description is the single most common reason a trained LoRA "does
      // nothing".
      if (ref.triggerWord?.trim()) parts.push(ref.triggerWord.trim());
    }
  }

  if (strategy === 'prompt-only' && model.supportsReferenceImages) {
    if (ref.canonicalImageId) {
      strategy = 'reference-image';
      out.referenceImages.push({ imageId: ref.canonicalImageId, refId: ref.id, role: 'identity' });
      out.steps.push({
        code: 'referenceImage',
        refId: ref.id,
        refName: ref.name,
        values: { index: String(out.referenceImages.length) },
      });
      // An edit model is instructed, not described: it needs to be told which
      // image the subject is in, and the ordinal must match the attachment.
      parts.push(`the person in image ${out.referenceImages.length}`);
    } else {
      out.steps.push({ code: 'noCanonical', refId: ref.id, refName: ref.name });
    }
  }

  if (strategy === 'prompt-only' && model.supportsPhotoMaker && ref.canonicalImageId) {
    strategy = 'photomaker';
    out.referenceImages.push({ imageId: ref.canonicalImageId, refId: ref.id, role: 'face' });
    out.steps.push({ code: 'photoMaker', refId: ref.id, refName: ref.name });
  }

  // A portrait the writer marked "this is her" and nothing can carry has to be
  // said out loud. Falling through to the words alone without a word about it
  // is how a writer concludes the portrait does something when it does not.
  if (strategy === 'prompt-only' && ref.canonicalImageId) {
    out.steps.push({ code: 'canonicalUnused', refId: ref.id, refName: ref.name });
  }

  // Always, whatever carried the face: the words still describe her.
  const fragment = fragmentFor(ref, model, out.steps);
  if (fragment) parts.push(fragment);
  // A ref with nothing but a name still names her — that is the whole point of
  // an object where every field is optional.
  if (parts.length === 0 && ref.name.trim()) parts.push(ref.name.trim());

  out.strategies[ref.id] = strategy;
  return parts;
}

/**
 * The one entry point. `refs` are the subjects in the order the writer put them
 * in the composer; `scene` and `style` are the free-text slots.
 */
export function resolve(
  refs: readonly VisualRef[],
  scene: string,
  style: string,
  model: ResolverModel,
  options: ResolveOptions,
): ResolvedGeneration {
  const loras: ResolvedLora[] = [];
  const referenceImages: ResolvedReferenceImage[] = [];
  const strategies: Record<string, IdentityStrategy> = {};
  const steps: ResolutionStep[] = [];
  const out = { loras, referenceImages, strategies, steps };

  const parts: string[] = [];
  for (const ref of refs) parts.push(...resolveSubject(ref, model, out));

  const sceneText = scene.trim();
  if (sceneText) {
    parts.push(sceneText);
    steps.push({ code: 'scene' });
  }
  const styleText = style.trim();
  if (styleText) {
    parts.push(styleText);
    steps.push({ code: 'style' });
  }

  // --- negatives -----------------------------------------------------------
  // A distilled model runs at cfg 1, where classifier-free guidance has no
  // negative branch to steer with: the text is encoded and thrown away. Showing
  // the field working would teach the writer that their negative prompt did
  // something, and they would go on writing longer ones.
  const negativeParts = refs
    .map((ref) => {
      const negative = ref.negativeFragment?.trim();
      return negative ? adaptDialect(negative, ref.dialect, model.dialect) : '';
    })
    .filter(Boolean);
  const negativesHonoured = model.cfg === undefined || model.cfg > NEGATIVE_PROMPT_MIN_CFG;
  let negativePrompt: string | undefined;
  if (negativeParts.length > 0) {
    if (negativesHonoured) {
      negativePrompt = joinInDialect(negativeParts, model.dialect);
      steps.push({ code: 'negative' });
    } else {
      steps.push({ code: 'negativeIgnored', values: { cfg: String(model.cfg) } });
    }
  }

  // --- pinned pose ---------------------------------------------------------
  if (options.pose) {
    const pinned = options.pose;
    if (model.supportsControlNet) {
      referenceImages.push({
        imageId: pinned.imageId,
        refId: pinned.refId,
        role: 'pose',
        weight: POSE_CONTROL_WEIGHT,
      });
      steps.push({ code: 'pose', refId: pinned.refId, values: { weight: POSE_CONTROL_WEIGHT.toFixed(2) } });
    } else {
      steps.push({ code: 'poseUnsupported', refId: pinned.refId });
    }
  }

  // --- seed ----------------------------------------------------------------
  let seed: number | undefined;
  if (options.seedMode === 'lock') {
    const hero = refs.find((ref) => typeof ref.heroSeed === 'number');
    if (hero) {
      seed = hero.heroSeed;
      steps.push({ code: 'seedHero', refId: hero.id, refName: hero.name, values: { seed: String(hero.heroSeed) } });
    }
  } else if (options.seedMode === 'manual') {
    seed = options.manualSeed;
    if (seed !== undefined) steps.push({ code: 'seedManual', values: { seed: String(seed) } });
  } else {
    seed = options.exploreSeed;
    steps.push({ code: 'seedExplore', values: seed === undefined ? undefined : { seed: String(seed) } });
  }

  return {
    prompt: joinInDialect(parts, model.dialect),
    negativePrompt,
    seed,
    seedMode: options.seedMode,
    loras,
    referenceImages,
    strategies,
    dialect: model.dialect,
    steps,
  };
}
