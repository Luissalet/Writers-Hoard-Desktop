// ============================================
// AI Configuration Defaults
// ============================================

import type { AiConfig } from '@/types';

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'http://localhost:8317',
  model: 'claude-haiku-4-5-20251001',
  enabled: true,
  // 'proxy' keeps existing setups exactly as they were; 'local' switches the
  // features to the embedded Ollama runtime (see electron/ollama.ts).
  provider: 'proxy',
  localModel: 'qwen3.5:9b',
};

export const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (rápido)', description: 'Menor consumo de quota' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4 (equilibrado)', description: 'Balance velocidad/calidad' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5 (mejor)', description: 'Mayor calidad, más lento' },
] as const;

// Settings keys for Dexie persistence
export const AI_SETTINGS_KEYS = {
  BASE_URL: 'ai_base_url',
  MODEL: 'ai_model',
  ENABLED: 'ai_enabled',
  PROVIDER: 'ai_provider',
  LOCAL_MODEL: 'ai_local_model',
} as const;

/**
 * Curated local models (Ollama tags). Spanish literals follow the
 * AVAILABLE_MODELS precedent above. `sizeBytes` feeds the disk-space guard
 * (mirrored in electron/ollama.ts KNOWN_MODEL_BYTES — keep both in sync) and
 * the size labels in Settings. Sized for the resident hardware: RTX 4070 Ti
 * (12 GB VRAM) + 128 GB RAM.
 */
export const LOCAL_MODELS = [
  {
    tag: 'qwen3.5:35b-a3b',
    label: 'Qwen3.5 35B (el tocho)',
    sizeBytes: 20_000_000_000,
    sizeLabel: '~20 GB',
    description: 'Máxima calidad. MoE con 3B activos: rápido pese a su tamaño. Usa GPU + RAM.',
  },
  {
    tag: 'qwen3.5:9b',
    label: 'Qwen3.5 9B (ligero)',
    sizeBytes: 6_600_000_000,
    sizeLabel: '~6,6 GB',
    description: 'Cabe entero en la GPU (12 GB). Respuestas más rápidas.',
  },
] as const;
