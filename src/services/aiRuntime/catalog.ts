// ============================================================================
// AI runtime — curated local model catalogue (pure data)
// ============================================================================
//
// The one list both sides read: the renderer draws cards from it and the main
// process sizes the disk guard from it, which retires the two hand-mirrored
// constants (`LOCAL_MODELS` in config/ai.ts and `KNOWN_MODEL_BYTES` in
// electron/ollama.ts) that had already drifted apart once.
//
// Sizes are the Q4_K_M downloads as published on ollama.com in August 2026.
// `paramsB`/`activeParamsB`/`layers` feed the fit estimate in ./fit.ts — they
// are architecture facts, not measurements, and the UI says "estimado" until
// the runtime has reported the real file size.

import type { AiCapability } from './types';

export interface CatalogModel {
  /** Ollama tag, exactly as `ollama pull` wants it. */
  tag: string;
  label: string;
  family: string;
  /** Total parameters, billions. */
  paramsB: number;
  /** Parameters active per token (MoE); equals paramsB for dense models. */
  activeParamsB: number;
  /** Transformer depth — drives the KV-cache estimate. */
  layers: number;
  /** Bits per weight of the published quantisation. */
  quantBits: number;
  sizeBytes: number;
  contextWindow: number;
  capabilities: AiCapability[];
  /** i18n key suffix for the one-line pitch: `settings.ai.catalog.<key>` */
  pitchKey: string;
  /** Marks the two or three choices a first-time user should see first. */
  recommended?: boolean;
}

export const LOCAL_MODEL_CATALOG: readonly CatalogModel[] = [
  {
    tag: 'qwen3.5:9b',
    label: 'Qwen3.5 9B',
    family: 'qwen3.5',
    paramsB: 9,
    activeParamsB: 9,
    layers: 36,
    quantBits: 4.5,
    sizeBytes: 6_600_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'qwen3.5-9b',
    recommended: true,
  },
  {
    tag: 'gemma4:12b',
    label: 'Gemma 4 12B',
    family: 'gemma4',
    paramsB: 12,
    activeParamsB: 12,
    layers: 48,
    quantBits: 4.5,
    sizeBytes: 7_600_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'gemma4-12b',
    recommended: true,
  },
  {
    tag: 'qwen3.5:4b',
    label: 'Qwen3.5 4B',
    family: 'qwen3.5',
    paramsB: 4,
    activeParamsB: 4,
    layers: 32,
    quantBits: 4.5,
    sizeBytes: 3_400_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'qwen3.5-4b',
  },
  {
    tag: 'granite4.2:8b',
    label: 'Granite 4.2 8B',
    family: 'granite4.2',
    paramsB: 8,
    activeParamsB: 8,
    layers: 40,
    quantBits: 4.5,
    sizeBytes: 5_300_000_000,
    contextWindow: 131_072,
    capabilities: ['chat', 'streaming', 'tools', 'thinking'],
    pitchKey: 'granite4.2-8b',
  },
  {
    tag: 'qwen3.8:27b',
    label: 'Qwen3.8 27B',
    family: 'qwen3.8',
    paramsB: 27.3,
    activeParamsB: 27.3,
    layers: 64,
    quantBits: 4.5,
    sizeBytes: 18_000_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'qwen3.8-27b',
    recommended: true,
  },
  {
    tag: 'qwen3.6:27b',
    label: 'Qwen3.6 27B',
    family: 'qwen3.6',
    paramsB: 27.3,
    activeParamsB: 27.3,
    layers: 64,
    quantBits: 4.5,
    sizeBytes: 18_000_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'qwen3.6-27b',
  },
  {
    tag: 'qwen3.5:35b-a3b',
    label: 'Qwen3.5 35B-A3B (MoE)',
    family: 'qwen3.5',
    paramsB: 36,
    activeParamsB: 3,
    layers: 40,
    quantBits: 4.5,
    sizeBytes: 24_000_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'qwen3.5-35b',
  },
  {
    tag: 'gemma4:26b',
    label: 'Gemma 4 26B',
    family: 'gemma4',
    paramsB: 26,
    activeParamsB: 26,
    layers: 60,
    quantBits: 4.5,
    sizeBytes: 19_000_000_000,
    contextWindow: 262_144,
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'thinking'],
    pitchKey: 'gemma4-26b',
  },
  {
    tag: 'nemotron-3.5-lightning:30b',
    label: 'Nemotron 3.5 Lightning 30B-A3B (MoE)',
    family: 'nemotron',
    paramsB: 30,
    activeParamsB: 3,
    layers: 52,
    quantBits: 4.5,
    sizeBytes: 25_000_000_000,
    contextWindow: 1_048_576,
    capabilities: ['chat', 'streaming', 'tools', 'thinking'],
    pitchKey: 'nemotron-3.5-30b',
  },
];

/** Bytes a download needs on disk, by tag — for the free-space guard in main. */
export function catalogSizeBytes(tag: string): number | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.tag === tag)?.sizeBytes;
}

export function catalogEntry(tag: string): CatalogModel | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.tag === tag);
}

/** Default tag the first-run path adopts: small enough for most cards. */
export const DEFAULT_LOCAL_MODEL_TAG = 'qwen3.5:9b';
