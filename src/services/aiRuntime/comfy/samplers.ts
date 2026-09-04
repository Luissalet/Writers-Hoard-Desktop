// ============================================================================
// ComfyUI — sampler and scheduler names
// ============================================================================
//
// The app's sampler names are stable-diffusion.cpp's; ComfyUI's k-diffusion
// names are different words for mostly the same algorithms. A recipe made on
// the Studio has to mean the same thing on the Bench, so it is translated —
// and then checked against what THIS build offers, because both projects add
// samplers and a name ComfyUI does not know is rejected at validation with a
// combo error that says nothing useful.

const SAMPLER_TRANSLATION: Record<string, string> = {
  euler: 'euler',
  euler_a: 'euler_ancestral',
  heun: 'heun',
  dpm2: 'dpm_2',
  'dpm++2s_a': 'dpmpp_2s_ancestral',
  'dpm++2m': 'dpmpp_2m',
  'dpm++2mv2': 'dpmpp_2m',
  ipndm: 'ipndm',
  ipndm_v: 'ipndm_v',
  lcm: 'lcm',
  ddim_trailing: 'ddim',
  res_multistep: 'res_multistep',
  er_sde: 'er_sde',
  euler_cfg_pp: 'euler_cfg_pp',
  euler_a_cfg_pp: 'euler_ancestral_cfg_pp',
  euler_ge: 'gradient_estimation',
};

const SCHEDULER_TRANSLATION: Record<string, string> = {
  discrete: 'normal',
  karras: 'karras',
  exponential: 'exponential',
  sgm_uniform: 'sgm_uniform',
  simple: 'simple',
  kl_optimal: 'kl_optimal',
};

function choose(candidates: readonly string[], offered: readonly string[], fallback: string): string {
  for (const candidate of candidates) {
    if (offered.includes(candidate)) return candidate;
  }
  if (offered.includes(fallback)) return fallback;
  return offered[0] ?? fallback;
}

/** `name` may already be a ComfyUI name — a user's own workflow uses those. */
export function comfySamplerName(name: string | undefined, offered: readonly string[]): string {
  const translated = name ? SAMPLER_TRANSLATION[name] : undefined;
  return choose([translated, name].filter((entry): entry is string => Boolean(entry)), offered, 'euler');
}

export function comfySchedulerName(name: string | undefined, offered: readonly string[]): string {
  const translated = name ? SCHEDULER_TRANSLATION[name] : undefined;
  return choose([translated, name].filter((entry): entry is string => Boolean(entry)), offered, 'normal');
}
