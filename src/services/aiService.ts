// ============================================
// AI Service — via CLIProxyAPI (OpenAI-compatible format)
// ============================================

import type { AiConfig } from '@/types';
import { DEFAULT_AI_CONFIG } from '@/config/ai';
import { sanitizeModelText } from './aiText';
import { t } from '@/i18n/useTranslation';

/**
 * Local-provider failure whose message is ALREADY user-facing (translated).
 * safeAiCall surfaces it verbatim instead of the generic fallback.
 */
export class LocalAiError extends Error {}

/**
 * Base function for all AI calls.
 *
 * provider 'proxy' → OpenAI-compatible chat completions against CLIProxyAPI
 * (NOT Anthropic's native format), exactly as always.
 * provider 'local' → the embedded Ollama runtime, through the main process
 * (the packaged renderer is file:// and Ollama's CORS rejects null origins).
 */
export async function callAi(
  systemPrompt: string,
  userMessage: string,
  config: AiConfig = DEFAULT_AI_CONFIG
): Promise<string> {
  if (!config.enabled) {
    throw new Error(t('ai.disabled'));
  }

  if (config.provider === 'local') {
    const ollama = window.electronAPI?.ollama;
    if (!ollama) throw new LocalAiError(t('ai.localNotReady')); // web build / no bridge
    const res = await ollama.chat({
      model: config.localModel,
      system: systemPrompt,
      user: userMessage,
    });
    if (!res.ok || res.content == null) {
      const code = res.error ?? '';
      if (code === 'not-ready' || code === 'runtime-missing' || code.startsWith('model-missing')) {
        throw new LocalAiError(t('ai.localNotReady'));
      }
      throw new Error(code || 'local AI failed');
    }
    return sanitizeModelText(res.content);
  }

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI request failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  // Harmless for Claude; load-bearing for a Qwen routed through the proxy.
  return sanitizeModelText(data.choices[0].message.content);
}

/**
 * Check if CLIProxyAPI is running and accessible.
 */
export async function testConnection(
  baseUrl: string = DEFAULT_AI_CONFIG.baseUrl
): Promise<{
  connected: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = data.data.map((m: { id: string }) => m.id);
    return { connected: true, models };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { connected: false, models: [], error: message };
  }
}

/**
 * Wrapper for safe AI calls with user-friendly error messages
 */
export async function safeAiCall<T>(
  operation: () => Promise<T>,
  fallbackMessage: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';

    // Local-provider failures carry an already-translated, actionable message.
    if (err instanceof LocalAiError) {
      return { success: false, error: err.message };
    }
    if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('NetworkError')) {
      return {
        success: false,
        error: t('ai.proxyNotRunning'),
      };
    }
    if (message.includes('429') || message.includes('rate')) {
      return {
        success: false,
        error: 'Has alcanzado el límite de uso de tu suscripción Max. Espera un rato.',
      };
    }
    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: t('ai.unexpectedFormat'),
      };
    }
    return { success: false, error: fallbackMessage };
  }
}
