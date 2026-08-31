// ============================================================================
// AI runtime — will this model run on this machine? (pure, no I/O)
// ============================================================================
//
// A conservative estimate, deliberately simple enough to read and check:
//
//   total = weights + KV cache(context) + runtime overhead
//
// weights  — the published download size when known (GGUF weights load 1:1),
//            else params × bits/8;
// KV cache — layers × 2 (K,V) × kv-heads × head-dim × 2 bytes × tokens, with a
//            per-family factor for hybrid architectures that only keep full
//            attention on a fraction of their layers;
// overhead — compute buffers, the vision projector, the runtime itself.
//
// Then it is compared with the GPU's usable memory and, failing that, with the
// GPU plus RAM (partial offload). The labels are the ones the settings page
// shows: perfecto / bien / justo / no cabe. Confidence is reported next to the
// number: "measured" once the runtime has told us the real file size,
// "estimated" while it is a catalogue figure. This is a clean-room estimate;
// the shape follows the public llmfit approach (MIT) rather than any GPL code.

import type { FitEstimate, FitLabel, HardwareProfile } from './types';

export interface FitInput {
  /** Bytes on disk, when known (installed model or catalogue figure). */
  sizeBytes?: number;
  paramsB?: number;
  activeParamsB?: number;
  layers?: number;
  quantBits?: number;
  family?: string;
  /** Model tag, used to spot MoE naming such as "30b-a3b". */
  tag?: string;
  vision?: boolean;
  /** True when sizeBytes came from the runtime rather than a catalogue. */
  measured?: boolean;
  /** Speed this machine has actually seen from the model; replaces the estimate. */
  measuredTokensPerSecond?: number;
}

const KV_HEADS = 8;
const HEAD_DIM = 128;
const BYTES_PER_KV_ELEMENT = 2; // fp16
const RUNTIME_OVERHEAD = 700_000_000;
const VISION_OVERHEAD = 450_000_000;
/** Driver, display and compositor keep some VRAM for themselves. */
const GPU_RESERVE = 1_000_000_000;
const RAM_SHARE = 0.75;
/** Rough sustained read bandwidth, bytes/s: a discrete GPU vs. desktop DDR5. */
const GPU_BANDWIDTH = 450e9;
const RAM_BANDWIDTH = 55e9;
const CPU_ONLY_BANDWIDTH = 45e9;

/** Ollama family names that are mixtures of experts. */
const MOE_FAMILIES = /moe|mixtral|deepseek2|deepseek3|qwen3next|nemotron_h|granitemoe|dbrx|arctic|jamba|glm4moe|minimax|gpt-oss|gptoss/i;

/**
 * Active parameters for a mixture of experts, from the tag when it says so
 * ("30b-a3b", "122b-a10b"), else from what the family is known to use.
 * Dense models return `paramsB` unchanged.
 */
export function inferActiveParams(tag: string | undefined, family: string | undefined, paramsB: number | undefined): number | undefined {
  if (paramsB === undefined) return undefined;
  const fromTag = /(\d+(?:\.\d+)?)b-a(\d+(?:\.\d+)?)b/i.exec(tag ?? '');
  if (fromTag) return Number(fromTag[2]);
  const fam = (family ?? '').toLowerCase();
  const name = (tag ?? '').toLowerCase();
  if (/mixtral/.test(fam) || /mixtral/.test(name)) return paramsB >= 100 ? 39 : 12.9;
  if (/qwen3next|coder-next/.test(fam + name)) return 3;
  if (/qwen3moe|qwen3-coder|qwen3:30b|qwen3:235b/.test(fam + name)) return paramsB >= 200 ? 22 : 3.3;
  if (/qwen35|qwen3\.5/.test(fam + name) && paramsB >= 30) return paramsB >= 100 ? 10 : 3;
  if (/nemotron/.test(fam + name) && paramsB >= 25) return 3;
  if (/gpt-oss|gptoss/.test(fam + name)) return paramsB >= 100 ? 5.1 : 3.6;
  if (/deepseek/.test(fam) && paramsB >= 200) return 37;
  if (/glm4moe|glm-4\.5-air|glm-5/.test(fam + name)) return paramsB >= 300 ? 32 : 12;
  if (MOE_FAMILIES.test(fam) && paramsB >= 20) return Math.max(3, Math.round(paramsB / 10));
  return paramsB;
}

/** Hybrid (linear-attention) families keep KV for only some layers. */
const FAMILY_KV_FACTOR: Record<string, number> = {
  'qwen3.5': 0.35,
  'qwen3.6': 0.35,
  'qwen3.8': 0.35,
  qwen35: 0.35,
  nemotron: 0.3,
  qwen3next: 0.3,
  // Gemma keeps full attention on one layer in six; the rest are sliding-window.
  gemma3: 0.3,
  gemma4: 0.3,
};

function guessLayers(paramsB: number): number {
  if (paramsB <= 2) return 24;
  if (paramsB <= 5) return 32;
  if (paramsB <= 10) return 36;
  if (paramsB <= 16) return 40;
  if (paramsB <= 35) return 48;
  if (paramsB <= 80) return 64;
  return 80;
}

/** Parse "27.3B" / "4B" / "0.8B" the way Ollama's /api/tags reports it. */
export function parseParameterSize(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const match = /([\d.]+)\s*([BM])/i.exec(label);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2].toUpperCase() === 'M' ? value / 1000 : value;
}

/** "Q4_K_M" → 4.5, "Q8_0" → 8.5, "F16" → 16. Effective bits per weight. */
export function quantBitsFromLabel(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const upper = label.toUpperCase();
  if (/F16|BF16|FP16/.test(upper)) return 16;
  if (/F32|FP32/.test(upper)) return 32;
  const q = /Q(\d)/.exec(upper);
  if (q) {
    const bits = Number(q[1]);
    // K-quants carry scales; the file is a little bigger than the nominal bits.
    return /_K/.test(upper) ? bits + 0.5 : bits + 0.25;
  }
  if (/INT4|NVFP4|MXFP4/.test(upper)) return 4.25;
  if (/INT8|MXFP8|FP8/.test(upper)) return 8.25;
  return undefined;
}

export function estimateWeightsBytes(input: FitInput): number {
  if (input.sizeBytes && input.sizeBytes > 0) return input.sizeBytes;
  const params = input.paramsB ?? 7;
  const bits = input.quantBits ?? 4.5;
  return params * 1e9 * (bits / 8);
}

export function estimateKvCacheBytes(input: FitInput, contextTokens: number): number {
  const layers = input.layers ?? guessLayers(input.paramsB ?? 7);
  const factor = FAMILY_KV_FACTOR[(input.family ?? '').toLowerCase()] ?? 1;
  return layers * 2 * KV_HEADS * HEAD_DIM * BYTES_PER_KV_ELEMENT * contextTokens * factor;
}

/** The single GPU we plan for: the biggest one when several are present. */
export function primaryGpuBytes(hardware: HardwareProfile): number {
  let best = 0;
  for (const gpu of hardware.gpus) {
    if (gpu.vramTotalBytes && gpu.vramTotalBytes > best) best = gpu.vramTotalBytes;
  }
  return best;
}

export function computeFit(
  hardware: HardwareProfile,
  input: FitInput,
  contextTokens = 32_768,
): FitEstimate {
  const weightsBytes = estimateWeightsBytes(input);
  const kvCacheBytes = estimateKvCacheBytes(input, contextTokens);
  const overhead = RUNTIME_OVERHEAD + (input.vision ? VISION_OVERHEAD : 0);
  const totalBytes = weightsBytes + kvCacheBytes + overhead;
  const confidence = input.measured ? 'measured' : 'estimated';

  const gpuTotal = primaryGpuBytes(hardware);
  const gpuUsable = Math.max(0, gpuTotal - GPU_RESERVE);
  const ramBudget = hardware.ramTotalBytes * RAM_SHARE;
  const paramsB = input.paramsB;
  const activeB = input.activeParamsB ?? inferActiveParams(input.tag, input.family, paramsB) ?? paramsB ?? 7;
  const isMoe = paramsB !== undefined && activeB < paramsB * 0.5;
  // Bytes read per generated token: the whole file for a dense model, the
  // active slice for a mixture of experts.
  const bytesPerToken = isMoe && paramsB ? weightsBytes * (activeB / paramsB) : weightsBytes;

  const base = { totalBytes, weightsBytes, kvCacheBytes, contextTokens, confidence } as const;
  const estimated = (tokensPerSecond: number, rest: Pick<FitEstimate, 'label' | 'placement'>): FitEstimate => ({
    ...base,
    ...rest,
    speedHint: speedFor(tokensPerSecond),
    tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
    speedSource: 'estimated',
  });

  const estimateFit = (): FitEstimate => {
    // No usable GPU: everything runs on the CPU, bounded by memory bandwidth.
    if (gpuUsable <= 0 || hardware.gpuConfidence === 'none') {
      if (totalBytes > ramBudget) {
        return { ...base, label: 'no-fit', placement: 'none', speedHint: 'unusable', speedSource: 'estimated' };
      }
      const tps = CPU_ONLY_BANDWIDTH / bytesPerToken;
      return estimated(tps, { label: speedFor(tps) === 'unusable' ? 'no-fit' : 'tight', placement: 'cpu' });
    }

    if (totalBytes <= gpuUsable * 0.9) return estimated(GPU_BANDWIDTH / bytesPerToken, { label: 'perfect', placement: 'gpu' });
    if (totalBytes <= gpuUsable) return estimated(GPU_BANDWIDTH / bytesPerToken, { label: 'good', placement: 'gpu' });

    // Partial offload: what does not fit on the card streams from RAM every token.
    if (totalBytes > gpuUsable + ramBudget) {
      return { ...base, label: 'no-fit', placement: 'none', speedHint: 'unusable', speedSource: 'estimated' };
    }
    const gpuShare = Math.min(1, Math.max(0, (gpuUsable - kvCacheBytes - overhead) / weightsBytes));
    const seconds = (bytesPerToken * gpuShare) / GPU_BANDWIDTH + (bytesPerToken * (1 - gpuShare)) / RAM_BANDWIDTH;
    const tps = 1 / Math.max(seconds, 1e-6);
    const speedHint = speedFor(tps);
    if (speedHint === 'unusable') return estimated(tps, { label: 'no-fit', placement: 'split' });
    // A mixture of experts with a small active set streams well from RAM: that
    // is the "big free model" case and it deserves "good", not "tight".
    const label: FitLabel = isMoe && (speedHint === 'fast' || speedHint === 'ok') ? 'good' : 'tight';
    return estimated(tps, { label, placement: 'split' });
  };

  return withMeasuredSpeed(estimateFit(), input.measuredTokensPerSecond);
}

/** Tokens/s → the band the badge shows. */
export function speedFor(tokensPerSecond: number): FitEstimate['speedHint'] {
  return tokensPerSecond >= 15 ? 'fast' : tokensPerSecond >= 6 ? 'ok' : tokensPerSecond >= 1.5 ? 'slow' : 'unusable';
}

/**
 * A speed this machine has actually produced beats any estimate: it replaces
 * the band, and — when the model did not fit on the card — the label too,
 * since "tight" only ever meant "expect it to be slow".
 */
export function withMeasuredSpeed(estimate: FitEstimate, measuredTokensPerSecond: number | undefined): FitEstimate {
  if (measuredTokensPerSecond === undefined || !Number.isFinite(measuredTokensPerSecond) || measuredTokensPerSecond <= 0) {
    return estimate;
  }
  if (estimate.placement === 'none') return estimate;
  const speedHint = speedFor(measuredTokensPerSecond);
  let label = estimate.label;
  if (estimate.placement !== 'gpu') {
    label = speedHint === 'unusable' ? 'no-fit' : speedHint === 'slow' ? 'tight' : 'good';
  }
  return { ...estimate, label, speedHint, tokensPerSecond: Math.round(measuredTokensPerSecond * 10) / 10, speedSource: 'measured' };
}

/** Rank for sorting: the better the fit, the lower the number. */
export function fitRank(label: FitLabel): number {
  return label === 'perfect' ? 0 : label === 'good' ? 1 : label === 'tight' ? 2 : 3;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

/** Binary units, the way Windows reports RAM and VRAM ("128 GB", "12.0 GB"). */
export function formatBinaryBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—';
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib >= 100 ? Math.round(gib) : gib.toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
