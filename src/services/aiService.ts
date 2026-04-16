// ============================================
// AI Service — via CLIProxyAPI (OpenAI-compatible format)
// ============================================

import type { AiConfig } from '@/types';
import { DEFAULT_AI_CONFIG } from '@/config/ai';
import { t } from '@/i18n/useTranslation';

/**
 * Base function for all AI calls.
 * Uses OpenAI-compatible chat completions format (NOT Anthropic's native format).
 */
export async function callAi(
  systemPrompt: string,
  userMessage: string,
  config: AiConfig = DEFAULT_AI_CONFIG
): Promise<string> {
  if (!config.enabled) {
    throw new Error(t('ai.disabled'));
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
  return data.choices[0].message.content;
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
