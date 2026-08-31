// ============================================================================
// AI runtime — measured model speed (pure)
// ============================================================================
//
// The fit badge starts from a bandwidth estimate; the first real answer from a
// model replaces it with what this machine actually did. One smoothed number
// per connection+model, kept by the main process; the maths lives here so a
// test can pin it down without a file system.

import type { AiUsage, ModelSpeedMetric } from './types';

/** Answers shorter than this say more about latency than about speed. */
export const MIN_SAMPLE_TOKENS = 24;
/** No local model generates faster than this; anything above it is a lying server. */
export const MAX_PLAUSIBLE_TPS = 2000;
/** Weight of the newest sample: quick to follow a real change, slow to chase noise. */
const SMOOTHING = 0.35;

export function metricKey(connectionId: string, modelId: string): string {
  return `${connectionId}::${modelId}`;
}

/** Fold one finished answer into the running figure; `undefined` when it teaches nothing. */
export function mergeSpeedSample(previous: ModelSpeedMetric | undefined, usage: AiUsage, now = Date.now()): ModelSpeedMetric | undefined {
  const tps = usage.tokensPerSecond;
  const tokens = usage.completionTokens ?? 0;
  // A ceiling as well as a floor: a server that reports 10^8 "tokens" over a
  // 300 ms window must not poison the stored figure with one sample.
  if (tps === undefined || !Number.isFinite(tps) || tps <= 0 || tps > MAX_PLAUSIBLE_TPS || tokens < MIN_SAMPLE_TOKENS) return previous;
  if (!previous || previous.samples === 0) {
    return { tokensPerSecond: round(tps), samples: 1, lastAt: now, lastCompletionTokens: tokens, approximate: usage.approximate };
  }
  // A server-counted sample supersedes character-counted history outright.
  if (previous.approximate && !usage.approximate) {
    return { tokensPerSecond: round(tps), samples: 1, lastAt: now, lastCompletionTokens: tokens, approximate: false };
  }
  const smoothed = previous.tokensPerSecond + SMOOTHING * (tps - previous.tokensPerSecond);
  return {
    tokensPerSecond: round(smoothed),
    samples: previous.samples + 1,
    lastAt: now,
    lastCompletionTokens: tokens,
    approximate: previous.approximate && usage.approximate,
  };
}

/** Wall-clock speed for servers that report no timing: tokens (or characters/4) over the streaming window. */
export function speedFromTiming(
  completionTokens: number | undefined,
  characters: number,
  firstDeltaAt: number | null,
  lastDeltaAt: number | null,
): Pick<AiUsage, 'tokensPerSecond' | 'evalDurationMs' | 'approximate' | 'completionTokens'> | null {
  if (firstDeltaAt === null || lastDeltaAt === null) return null;
  const elapsedMs = lastDeltaAt - firstDeltaAt;
  if (elapsedMs < 250) return null;
  const tokens = completionTokens ?? Math.round(characters / 4);
  if (tokens <= 0) return null;
  return {
    completionTokens: tokens,
    evalDurationMs: elapsedMs,
    tokensPerSecond: round(tokens / (elapsedMs / 1000)),
    approximate: completionTokens === undefined,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
