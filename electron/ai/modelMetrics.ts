// ============================================================================
// AI runtime — measured model speed, kept between sessions (main process)
// ============================================================================
//
// <userData>/ai/model-metrics.json: one smoothed tokens/s figure per
// connection+model, written after every answer long enough to mean something
// (src/services/aiRuntime/metrics.ts decides). The gateway folds it into the
// model descriptors so the settings badge and the picker rank on what this
// machine has actually done rather than on a bandwidth guess.

import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AiUsage, ModelSpeedMetric } from '@/services/aiRuntime/types';
import { mergeSpeedSample, metricKey } from '@/services/aiRuntime/metrics';

interface MetricsFile {
  version: 1;
  models: Record<string, ModelSpeedMetric>;
}

let cache: MetricsFile | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function file(): string {
  return path.join(app.getPath('userData'), 'ai', 'model-metrics.json');
}

async function load(): Promise<MetricsFile> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse((await fs.readFile(file(), 'utf8')).replace(/^\uFEFF/, '')) as Partial<MetricsFile>;
    cache = { version: 1, models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {} };
  } catch {
    cache = { version: 1, models: {} };
  }
  return cache;
}

function save(next: MetricsFile): void {
  cache = next;
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(path.dirname(file()), { recursive: true });
      const temporary = `${file()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(temporary, file());
    })
    .catch((err) => console.error('[ai] metrics save failed', err));
}

export async function getModelMetric(connectionId: string, modelId: string): Promise<ModelSpeedMetric | undefined> {
  return (await load()).models[metricKey(connectionId, modelId)];
}

export async function getAllModelMetrics(): Promise<Record<string, ModelSpeedMetric>> {
  return { ...(await load()).models };
}

/**
 * Called by the gateway for every `usage` event; short answers are ignored.
 * The merge runs INSIDE the write chain: two usage events in the same tick each
 * read the same snapshot before either wrote, and a plain read-modify-write let
 * the second clobber the first. Chaining makes each merge see the prior result.
 */
export function recordModelUsage(connectionId: string, modelId: string, usage: AiUsage): Promise<void> {
  const run = writeChain.then(async () => {
    const store = await load();
    const key = metricKey(connectionId, modelId);
    const next = mergeSpeedSample(store.models[key], usage);
    if (!next || next === store.models[key]) return;
    const merged = { ...store, models: { ...store.models, [key]: next } };
    cache = merged;
    await fs.mkdir(path.dirname(file()), { recursive: true });
    const temporary = `${file()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(merged, null, 2), 'utf8');
    await fs.rename(temporary, file());
  });
  const settled = run.catch((err) => console.error('[ai] metrics save failed', err));
  writeChain = settled;
  return settled;
}

export async function forgetModelMetrics(connectionId: string): Promise<void> {
  const store = await load();
  const models: Record<string, ModelSpeedMetric> = {};
  for (const [key, value] of Object.entries(store.models)) {
    if (!key.startsWith(`${connectionId}::`)) models[key] = value;
  }
  save({ ...store, models });
}
