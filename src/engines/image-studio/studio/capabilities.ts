// ============================================================================
// What this model, this backend and this request shape can actually honour
// ============================================================================
//
// The studio used to hide the cfg slider for FLUX by name. The instinct was
// right and the special case was not, so there is one descriptor now and every
// control reads it. Adding a family or a runtime field means adding a rule
// here, not another `if (modelId.includes('flux'))` somewhere in a component.
//
// Three things can refuse a knob, and they are NOT the same refusal:
//
//   1. no model is chosen at all,
//   2. the model runs at a fixed guidance / is not a local diffusion model,
//   3. the request type has no field to carry it yet.
//
// Saying (2) when the truth is (3) teaches the writer that their model cannot
// do CLIP-skip, when in fact the app cannot ask for it. Each refusal names
// itself, which is why `reasonKey` exists instead of one `unavailable`.

import type { ResolverModel } from '@/services/visualRef';
import type { RequestSupportMap } from '../operations';
import type { StudioField } from './levels';

/** A control's state. Never `hidden`: a vanished control teaches a falsehood. */
export interface FieldState {
  enabled: boolean;
  /** A locale key, never a sentence. Present whenever `enabled` is false. */
  reasonKey?: string;
}

export type StudioCapabilities = Record<StudioField, FieldState>;

export interface CapabilityInput {
  model: ResolverModel | null;
  supports: RequestSupportMap;
  /**
   * True only for the app's own stable-diffusion.cpp server. A remote
   * `/v1/images/generations` endpoint takes a prompt and a size and nothing
   * else, so every diffusion knob below is decoration against one.
   */
  managedLocal: boolean;
  /** LoRA files the runtime found in its folder. */
  loraCount?: number;
}

const OK: FieldState = { enabled: true };

function no(reasonKey: string): FieldState {
  return { enabled: false, reasonKey };
}

/**
 * Guidance above 1 means classifier-free guidance is running, which is what
 * gives a negative prompt a branch to steer with. A distilled model at cfg 1
 * encodes the negative text and throws it away.
 */
function isGuided(model: ResolverModel): boolean {
  return model.cfg === undefined || model.cfg > 1;
}

/** CLIP-skip means nothing where the conditioning is not a CLIP text stack. */
function conditionsOnClip(model: ResolverModel): boolean {
  return model.family === 'sd1' || model.family === 'sdxl' || model.family === undefined;
}

export function studioCapabilities(input: CapabilityInput): StudioCapabilities {
  const { model, supports, managedLocal } = input;
  // With no model chosen every field is refused for the same reason, and it is
  // not "this model runs at a fixed guidance" — saying that about a model the
  // writer has not picked is the kind of confident wrong answer that makes a
  // whole panel untrustworthy.
  if (!model) {
    const noModel = no('visualRef.reason.noModel');
    const all = {} as StudioCapabilities;
    for (const field of Object.keys(FIELD_DEFAULTS) as StudioField[]) all[field] = noModel;
    // The model picker is the way OUT of this state; refusing it would trap
    // the writer in the reason it is showing.
    all.model = OK;
    return all;
  }

  const guided = isGuided(model);
  const localDiffusion = managedLocal
    ? OK
    : no('visualRef.reason.serverChoosesSampler');
  // «The request has no field for this yet» is a different sentence from «this
  // model cannot do it», and the writer deserves the true one: one is a wait,
  // the other is a limit of their hardware.
  const pending = no('imageStudio.reason.noRequestField');

  return {
    model: OK,
    size: OK,
    batch: OK,
    seed: OK,

    steps: OK,
    cfg: guided ? OK : no('visualRef.reason.cfgFixed'),
    sampler: supports.sampler ? localDiffusion : pending,
    scheduler: supports.scheduler ? localDiffusion : pending,
    clipSkip: !supports.clipSkip
      ? pending
      : !conditionsOnClip(model)
        ? no('imageStudio.reason.noClipStack')
        : localDiffusion,
    negativePrompt: guided ? OK : no('visualRef.reason.cfgFixed'),
    loraStack: model.supportsLora ? OK : no('imageStudio.reason.noLoraSupport'),
    passChain: supports.hiresFix ? localDiffusion : pending,
    inpaint: !supports.maskImage
      ? pending
      : !model.supportsInitImage
        ? no('imageStudio.reason.noInitImage')
        : localDiffusion,

    allSamplers: supports.sampler ? localDiffusion : pending,
    // Not "not yet": stable-diffusion.cpp has no subseed at all, and the usual
    // approximation — re-noising the latent by hand — makes a DIFFERENT picture
    // and calls it a variation. Refused on purpose, and it says which.
    variationSeed: no('imageStudio.reason.noSubseed'),
    sigmas: supports.sigmas ? localDiffusion : pending,
    slg: supports.slg ? localDiffusion : pending,
    apg: supports.apg ? localDiffusion : pending,
    cacheMode: supports.cacheMode ? localDiffusion : pending,
    // The gateway takes a typed request, so there is nowhere for arbitrary JSON
    // to go. Shown and refused rather than left out, because an expert who has
    // used A1111 will look for it and needs to know it is not hiding.
    rawJson: no('imageStudio.reason.noPassthrough'),
  };
}

/** Every field, so the no-model branch can refuse them all without listing them twice. */
const FIELD_DEFAULTS: Record<StudioField, true> = {
  model: true, size: true, batch: true, seed: true,
  steps: true, cfg: true, sampler: true, scheduler: true, clipSkip: true,
  negativePrompt: true, loraStack: true, passChain: true, inpaint: true,
  allSamplers: true, variationSeed: true, sigmas: true, slg: true, apg: true,
  cacheMode: true, rawJson: true,
};
