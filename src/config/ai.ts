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

/** Model ids the CLIProxyAPI proxy is known to serve; pinned onto its connection at migration. */
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
 * The curated local catalogue moved to `services/aiRuntime/catalog.ts`, where
 * the main process reads the same sizes for its disk guard. Kept here as a
 * derived view so nothing that still imports `LOCAL_MODELS` breaks.
 */
export { LOCAL_MODEL_CATALOG as LOCAL_MODELS } from '@/services/aiRuntime/catalog';
