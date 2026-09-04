// ============================================================================
// The samplers, curated — and the sentence that says what each one is FOR
// ============================================================================
//
// A dropdown of eighteen names is a worse product than a dropdown of eight,
// because the writer has no way to choose between `res_2s` and `ipndm_v` and
// will therefore never touch either. So Studio offers a curated subset and
// Expert offers the whole vocabulary the runtime knows.
//
// Two rules hold this file together:
//
//   * Every name here comes from `SD_SAMPLERS` / `SD_SCHEDULERS`, which are the
//     runtime's own `sample_method_to_str` tables. A name the server does not
//     recognise is DROPPED and the request succeeds with the default quietly in
//     its place — a picture made with the wrong sampler and labelled with the
//     right one, which the Gallery would then repeat forever. The guard below
//     is not defensive coding; it is the difference between a recipe and a lie.
//
//   * Every entry carries a one-line explanation, because this is exactly the
//     vocabulary a novelist does not have and cannot acquire from a dropdown.

import { SD_SAMPLERS, SD_SCHEDULERS } from '@/services/aiRuntime/sdServer';

export interface SamplerEntry {
  /** The name on the wire, exactly as the server's parser spells it. */
  id: string;
  /** Locale key suffix: `imageStudio.sampler.<key>`. */
  key: string;
}

/**
 * The eight that cover what a writer actually needs: a deterministic reference,
 * an ancestral one, the SDXL workhorse and its v2, an ancestral 2S, the CFG++
 * reparameterisation, a distilled-checkpoint sampler and a modern multistep.
 */
const CURATED_SAMPLER_IDS: ReadonlyArray<[id: string, key: string]> = [
  ['euler', 'euler'],
  ['euler_a', 'eulerA'],
  ['heun', 'heun'],
  ['dpm++2m', 'dpmpp2m'],
  ['dpm++2mv2', 'dpmpp2mv2'],
  ['dpm++2s_a', 'dpmpp2sA'],
  ['euler_cfg_pp', 'eulerCfgPp'],
  ['lcm', 'lcm'],
];

const CURATED_SCHEDULER_IDS: ReadonlyArray<[id: string, key: string]> = [
  ['discrete', 'discrete'],
  ['karras', 'karras'],
  ['exponential', 'exponential'],
  ['simple', 'simple'],
  ['sgm_uniform', 'sgmUniform'],
  ['ays', 'ays'],
];

/** A name the runtime cannot parse never reaches a dropdown. */
function known(pairs: ReadonlyArray<[string, string]>, vocabulary: readonly string[]): SamplerEntry[] {
  return pairs
    .filter(([id]) => vocabulary.includes(id))
    .map(([id, key]) => ({ id, key }));
}

export const CURATED_SAMPLERS: readonly SamplerEntry[] = known(CURATED_SAMPLER_IDS, SD_SAMPLERS);
export const CURATED_SCHEDULERS: readonly SamplerEntry[] = known(CURATED_SCHEDULER_IDS, SD_SCHEDULERS);

/** Everything the runtime parses, curated ones first so the list stays readable. */
export function allSamplers(): SamplerEntry[] {
  const curated = CURATED_SAMPLERS.map((entry) => entry.id);
  return [
    ...CURATED_SAMPLERS,
    ...SD_SAMPLERS.filter((id) => !curated.includes(id)).map((id) => ({ id, key: samplerKey(id) })),
  ];
}

export function allSchedulers(): SamplerEntry[] {
  const curated = CURATED_SCHEDULERS.map((entry) => entry.id);
  return [
    ...CURATED_SCHEDULERS,
    ...SD_SCHEDULERS.filter((id) => !curated.includes(id)).map((id) => ({ id, key: samplerKey(id) })),
  ];
}

/**
 * Locale-key suffix for a name that is not in the curated table. `++` and `_`
 * are not key material, so they are folded the same way every time rather than
 * by a lookup that would have to be kept in step with the runtime's tables.
 */
export function samplerKey(id: string): string {
  return id
    .replace(/\+\+/g, 'pp')
    .replace(/_(\w)/g, (_all, letter: string) => letter.toUpperCase());
}

export function isKnownSampler(id: string): boolean {
  return (SD_SAMPLERS as readonly string[]).includes(id);
}

export function isKnownScheduler(id: string): boolean {
  return (SD_SCHEDULERS as readonly string[]).includes(id);
}
