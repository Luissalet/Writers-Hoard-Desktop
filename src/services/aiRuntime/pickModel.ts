// ============================================================================
// AI runtime — "the best model on this machine" (pure)
// ============================================================================
//
// Ranks the chat models a connection reports by how they would run here, so
// the settings page can offer one click instead of a dozen badges to compare.
// Tools first (a copilot without them cannot touch the app), then the fit
// label, then speed — measured when the machine has seen the model work —
// then the lighter footprint, then a writer's tie-breaks: a general model
// over a coding one, vision over none, and more parameters when everything
// else is level.

import { computeFit, fitRank, quantBitsFromLabel } from './fit';
import type { AiModelDescriptor, FitEstimate, HardwareProfile } from './types';

export interface RankedModel {
  model: AiModelDescriptor;
  fit: FitEstimate | null;
  /** Lower is better; only meaningful relative to the other entries. */
  score: number;
}

export interface RankOptions {
  requireTools?: boolean;
  /** Families to favour, e.g. /qwen/i — a nudge, never a filter. */
  preferFamily?: RegExp;
  contextTokens?: number;
}

const SPEED_RANK: Record<FitEstimate['speedHint'], number> = { fast: 0, ok: 1, slow: 2, unusable: 3 };
const CODER = /coder|-code|codestral|starcoder|deepseek-coder/i;

export function fitForDescriptor(model: AiModelDescriptor, hardware: HardwareProfile | null, contextTokens?: number): FitEstimate | null {
  if (!hardware) return null;
  return computeFit(
    hardware,
    {
      sizeBytes: model.sizeBytes,
      paramsB: model.parameterCountB,
      activeParamsB: model.activeParameterCountB,
      quantBits: quantBitsFromLabel(model.quantization),
      family: model.family,
      tag: model.id,
      vision: model.capabilities.includes('vision'),
      measured: Boolean(model.sizeBytes && model.sizeBytes > 0),
      measuredTokensPerSecond: model.measuredTokensPerSecond,
    },
    contextTokens,
  );
}

export function rankChatModels(models: AiModelDescriptor[], hardware: HardwareProfile | null, options: RankOptions = {}): RankedModel[] {
  const ranked: RankedModel[] = [];
  for (const model of models) {
    if (model.type !== 'chat') continue;
    if (!model.capabilities.includes('chat')) continue;
    if (options.requireTools !== false && !model.capabilities.includes('tools')) continue;
    const fit = fitForDescriptor(model, hardware, options.contextTokens);
    if (fit && fit.label === 'no-fit') continue;
    let score = 0;
    if (fit) {
      score += fitRank(fit.label) * 1000;
      score += SPEED_RANK[fit.speedHint] * 100;
      // Inside a band, the faster one — a measured speed counts in full, an
      // estimate at a discount, so a guess never edges out a real reading.
      if (fit.tokensPerSecond) score -= Math.min(60, fit.tokensPerSecond) * (fit.speedSource === 'measured' ? 1 : 0.7);
      // And the lighter one: less memory to page in, quicker to load.
      score += (fit.totalBytes / 1e9) * 0.5;
    }
    const haystack = `${model.family ?? ''} ${model.id}`;
    if (options.preferFamily?.test(haystack)) score -= 50;
    if (CODER.test(haystack)) score += 30;
    if (model.capabilities.includes('vision')) score -= 5;
    score -= Math.min(20, (model.parameterCountB ?? 0) * 0.2);
    ranked.push({ model, fit, score });
  }
  return ranked.sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id));
}

export function pickBestChatModel(models: AiModelDescriptor[], hardware: HardwareProfile | null, options: RankOptions = {}): RankedModel | null {
  return rankChatModels(models, hardware, options)[0] ?? null;
}
