import { buildSubscriptionPrompt, parseSubscriptionResponse, SubscriptionProtocolError } from '@/services/aiRuntime/subscriptionProtocol';
import type { ProviderAdapter } from './types';
import { AdapterError } from './http';
import { checkSubscription, subscriptionAnswer, type SubscriptionKind } from '../subscriptionClient';
const models: ProviderAdapter['listModels'] = async ({ connection }) => [{ connectionId: connection.id, id: 'client-default', label: 'Modelo predeterminado de la suscripción', type: 'chat', capabilities: ['chat', 'tools'] }];
export const subscriptionAdapter: ProviderAdapter = {
  listModels: async (ctx, signal) => { await checkSubscription(ctx.connection.kind as SubscriptionKind, signal); return models(ctx); },
  async probe(ctx, signal) {
    const at = Date.now();
    try { await checkSubscription(ctx.connection.kind as SubscriptionKind, signal); return { ok: true, latencyMs: Date.now() - at, models: await models(ctx) }; }
    catch (err) { const error = err instanceof AdapterError ? err : new AdapterError('unreachable', 'No se pudo comprobar la suscripción.'); return { ok: false, code: error.code, error: error.message }; }
  },
  async chat(ctx, request, emit, signal) {
    try {
      emit({ type: 'started', connectionId: ctx.connection.id, modelId: request.modelId });
      const text = await subscriptionAnswer(ctx.connection.kind as SubscriptionKind, request.modelId, buildSubscriptionPrompt(request), signal);
      if (!text.trim()) throw new AdapterError('bad-response', 'El cliente no devolvió texto.');
      const response = parseSubscriptionResponse(text, request);
      if (response.content) emit({ type: 'delta', text: response.content });
      for (const call of response.toolCalls) emit({ type: 'tool-call', call });
      emit({ type: 'done', finishReason: response.toolCalls.length ? 'tool-calls' : 'stop' });
    } catch (err) {
      if (signal.aborted) emit({ type: 'cancelled' });
      else { const error = err instanceof AdapterError ? err : err instanceof SubscriptionProtocolError ? new AdapterError('bad-response', err.message) : new AdapterError('server-error', 'El cliente oficial no pudo completar la respuesta.'); emit({ type: 'error', code: error.code, message: error.message }); }
    }
  },
};
