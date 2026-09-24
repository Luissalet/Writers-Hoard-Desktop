// ============================================================================
// One run, planned — the single place the request is assembled
// ============================================================================
//
// The composer, the X/Y/Z plot and "vary this one" all end up here. A preview
// built by a second code path is a preview of something else, and the whole
// point of the resolved-prompt disclosure is that what it shows is what is
// sent.
//
// Pure, so the interesting claims can be tested without a backend: that the
// wildcards are resolved BEFORE the prompt is recorded, that a refused pass is
// reported rather than dropped, and that the LoRA stack reaches the request as
// an array.

import type { ResolvedGeneration } from '@/services/visualRef';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import type { GenerateAndSaveOptions } from '../operations';
import { chainToRequest, serializePassChain, type PassSupportInput, type StudioPass } from './passes';
import { stackToSelections, type LoraStackEntry } from './loraStack';
import { resolveWildcards, type WildcardPick } from './wildcards';

export interface RunInput {
  projectId: string;
  route: AiRouteSelection;
  resolved: ResolvedGeneration;
  composer: { subjects: string; scene: string; style: string };
  width: number;
  height: number;
  seed: number;
  /**
   * Seed for the wildcard picks alone. Defaults to `seed`, so the same seed
   * reproduces the same prompt. A batch that holds the diffusion seed fixed
   * passes a different one per image, which is how "same noise, different
   * wording" is done honestly — the picks it made are recorded on the row.
   */
  wildcardSeed?: number;
  /** Images per call. Batches with walking seeds are one call each. */
  n: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  clipSkip?: number;
  passes: readonly StudioPass[];
  passSupport: PassSupportInput;
  loraStack: readonly LoraStackEntry[];
  /** Named wildcard lists, from the project's own reusable fragments. */
  wildcardFiles?: Readonly<Record<string, readonly string[]>>;
  /** Conditioning bytes, already read out of Gallery. */
  referenceImages?: string[];
  controlNets?: { image: string; weight: number }[];
  /** The ControlNet the local server holds for `controlNets`. */
  controlNetModel?: string;
  /** Gallery ids of the same, so the row can point back at them. */
  refImageIds?: string[];
  controlImageId?: string;
  /** Every reference this prompt named, whether or not it carried a LoRA. */
  visualRefIds?: string[];
  /** Appended to the prompt: the X/Y/Z prompt axis, and nothing else. */
  promptSuffix?: string;
  /** Shared by every picture of one batch, so the grid groups them. */
  stamp?: number;
  /** "steps 30 · cfg 7": what this cell of an X/Y/Z grid varied. */
  gridLabel?: string;
  tags?: string[];
}

export interface RunPlan {
  options: GenerateAndSaveOptions;
  /** Passes that were on and cannot run. Shown, never swallowed. */
  refusedPasses: { id: string; kind: string; reasonKey: string }[];
  wildcards: WildcardPick[];
  /** `__names__` with no list behind them, left in the prompt exactly as typed. */
  unresolvedWildcards: string[];
}

export function planRun(input: RunInput): RunPlan {
  // Resolved with THIS run's seed, so a batch with walking seeds explores the
  // wildcards as well as the noise — and so the same seed reproduces the same
  // choices, which is the only thing that makes the stored prompt honest.
  const wildcardSeed = input.wildcardSeed ?? input.seed;
  const prompt = resolveWildcards(
    [input.resolved.prompt, input.promptSuffix].filter(Boolean).join(', '),
    wildcardSeed,
    input.wildcardFiles,
  );
  const negative = input.resolved.negativePrompt
    ? resolveWildcards(input.resolved.negativePrompt, wildcardSeed ^ 0x5f3a, input.wildcardFiles)
    : undefined;
  const chain = chainToRequest(input.passes, input.passSupport);
  const loras = stackToSelections(input.loraStack);

  return {
    options: {
      projectId: input.projectId,
      route: input.route,
      prompt: prompt.text,
      negativePrompt: negative?.text,
      width: input.width,
      height: input.height,
      n: input.n,
      seed: input.seed,
      steps: input.steps,
      guidance: input.cfg,
      sampler: input.sampler,
      scheduler: input.scheduler,
      clipSkip: input.clipSkip,
      loras: loras.length ? loras : undefined,
      hires: chain.hires,
      referenceImages: input.referenceImages?.length ? input.referenceImages : undefined,
      controlNets: input.controlNets?.length ? input.controlNets : undefined,
      controlNetModel: input.controlNets?.length ? input.controlNetModel : undefined,
      refImageIds: input.refImageIds,
      controlImageId: input.controlImageId,
      visualRefIds: input.visualRefIds,
      composer: input.composer,
      passChain: serializePassChain(input.passes),
      wildcards: prompt.picks.length ? prompt.picks : undefined,
      stamp: input.stamp,
      gridLabel: input.gridLabel,
      tags: input.tags,
    },
    refusedPasses: chain.refused,
    wildcards: prompt.picks,
    unresolvedWildcards: [...new Set([...prompt.unresolved, ...(negative?.unresolved ?? [])])],
  };
}
