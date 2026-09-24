// ============================================
// AI Service — one door for the classic features
// ============================================
//
// On the desktop every call goes through the main-process gateway by
// connection id: the default chat route from AI settings (a server by IP, the
// managed Ollama, the CLIProxyAPI proxy…). The renderer never fetches a model
// server itself. The web build keeps the historical direct proxy call, since
// it has no main process to delegate to.

import type { AiConfig } from '@/types';
import { DEFAULT_AI_CONFIG } from '@/config/ai';
import { sanitizeModelText } from './aiText';
import { t } from '@/i18n/useTranslation';
import { aiApi } from './aiRuntime/client';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { DEFAULT_CONTEXT_TOKENS } from './aiRuntime/constants';
import { pickBestChatModel } from './aiRuntime/pickModel';
import type { AiCompleteResult, AiRouteSelection } from './aiRuntime/types';
import { toast } from '@/components/common/toast';

/**
 * Local-provider failure whose message is ALREADY user-facing (translated).
 * safeAiCall surfaces it verbatim instead of the generic fallback.
 */
export class LocalAiError extends Error {}

const UNAVAILABLE_CODES = new Set(['no-connection', 'model-missing', 'connection-disabled', 'unreachable', 'timeout']);
/** Routes already announced as replaced this session — one toast per route, not per call. */
const announcedFallbacks = new Set<string>();

/**
 * The best model this machine serves itself, other than `exclude` — what the
 * classic features fall back to when the configured route is a proxy that is
 * not running. Tools are not required: a summary needs none.
 */
export async function localFallbackRoute(exclude: AiRouteSelection): Promise<AiRouteSelection | null> {
  const store = useAiRuntimeStore.getState();
  if (!store.connectionsLoaded) await store.loadConnections();
  const local = useAiRuntimeStore
    .getState()
    .connections.filter((c) => c.enabled && c.kind !== 'sdcpp' && (c.locality === 'embedded' || c.locality === 'loopback'));
  await Promise.all(local.map((c) => store.loadModels(c.id).catch(() => [])));
  const state = useAiRuntimeStore.getState();
  const models = local
    .flatMap((c) => state.modelsByConnection[c.id]?.models ?? [])
    .filter((m) => !(m.connectionId === exclude.connectionId && m.id === exclude.modelId));
  const best = pickBestChatModel(models, state.hardware, { requireTools: false, contextTokens: DEFAULT_CONTEXT_TOKENS });
  return best ? { connectionId: best.model.connectionId, modelId: best.model.id } : null;
}

/**
 * Base function for all AI calls.
 *
 * Desktop: the gateway, addressed by the default chat route. When that route
 * cannot answer (a proxy that is switched off, a model that was deleted), the
 * call is retried once on the best local model and the user is told which.
 * Without a route the legacy paths still work (provider 'local' → the managed
 * Ollama over IPC; 'proxy' → direct fetch), so nothing configured before the
 * settings page existed stops working.
 */
export async function callAi(
  systemPrompt: string,
  userMessage: string,
  config: AiConfig = DEFAULT_AI_CONFIG
): Promise<string> {
  if (!config.enabled) {
    throw new Error(t('ai.disabled'));
  }

  const api = aiApi();
  const route = useAiRuntimeStore.getState().defaults.chat;
  if (api && route) {
    const completeWith = (target: AiRouteSelection): Promise<AiCompleteResult> =>
      api.complete({
        connectionId: target.connectionId,
        modelId: target.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        maxTokens: 4096,
        contextTokens: DEFAULT_CONTEXT_TOKENS,
      });
    let res = await completeWith(route);
    if ((!res.ok || res.content == null) && res.code && UNAVAILABLE_CODES.has(res.code)) {
      const fallback = await localFallbackRoute(route);
      if (fallback) {
        const retried = await completeWith(fallback);
        if (retried.ok && retried.content != null) {
          const key = `${route.connectionId}::${route.modelId}`;
          if (!announcedFallbacks.has(key)) {
            announcedFallbacks.add(key);
            toast.info(t('ai.fallbackNotice').replace('{failed}', route.modelId).replace('{model}', fallback.modelId), 6000);
          }
          res = retried;
        }
      }
    }
    if (!res.ok || res.content == null) {
      if (res.code === 'no-connection' || res.code === 'model-missing' || res.code === 'connection-disabled') {
        throw new LocalAiError(t('ai.routeNotReady'));
      }
      if (res.code === 'unreachable' || res.code === 'timeout') {
        throw new LocalAiError(`${t('ai.serverUnreachable')} ${res.error ?? ''}`.trim());
      }
      throw new Error(res.error || 'AI request failed');
    }
    return sanitizeModelText(res.content);
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
 * One-shot, non-streaming completion on an EXPLICIT route — for features that
 * must honour a per-project model choice (e.g. the project's chat model) rather
 * than the global default that `callAi` uses. Desktop only (needs the gateway);
 * falls back to the best local model when the route can't answer, like callAi.
 */
export async function completeOnRoute(
  route: AiRouteSelection,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
  options: { releaseAfter?: boolean } = {},
): Promise<string> {
  const api = aiApi();
  if (!api) throw new LocalAiError(t('ai.localNotReady'));
  const completeWith = (target: AiRouteSelection): Promise<AiCompleteResult> =>
    api.complete({
      connectionId: target.connectionId,
      modelId: target.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxTokens,
      contextTokens: DEFAULT_CONTEXT_TOKENS,
      ...(options.releaseAfter ? { releaseAfter: true } : {}),
    });
  let res = await completeWith(route);
  if ((!res.ok || res.content == null) && res.code && UNAVAILABLE_CODES.has(res.code)) {
    const fallback = await localFallbackRoute(route);
    if (fallback) {
      const retried = await completeWith(fallback);
      if (retried.ok && retried.content != null) res = retried;
    }
  }
  if (!res.ok || res.content == null) {
    if (res.code === 'no-connection' || res.code === 'model-missing' || res.code === 'connection-disabled') {
      throw new LocalAiError(t('ai.routeNotReady'));
    }
    if (res.code === 'unreachable' || res.code === 'timeout') {
      throw new LocalAiError(`${t('ai.serverUnreachable')} ${res.error ?? ''}`.trim());
    }
    throw new Error(res.error || 'AI request failed');
  }
  return sanitizeModelText(res.content);
}

/**
 * Check if an OpenAI-compatible proxy is running and accessible (web build).
 * On the desktop, connections are tested through AI settings instead.
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
    // Whole-token match: a bare `includes('rate')` also fired on "generate",
    // "moderate" or "accurate" in a server's error text and blamed a quota.
    if (/\b429\b|\brate[- ]?limit/i.test(message)) {
      return {
        success: false,
        error: t('ai.rateLimited'),
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
