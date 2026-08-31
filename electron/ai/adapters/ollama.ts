// ============================================================================
// AI adapter — Ollama's native API (main process)
// ============================================================================
//
// Used for the managed runtime (embedded or system) AND for any Ollama the
// user reaches by IP. Native routes rather than Ollama's /v1 shim, for the
// reason electron/ollama.ts already recorded: /v1 takes no `options`, and
// without `num_ctx` the default 4K context front-truncates a manuscript.
//
//   /api/version  → probe
//   /api/tags     → installed models, with size/quant/params and (0.33+) the
//                   capabilities list; older servers get /api/show per model
//   /api/chat     → NDJSON stream with content, thinking and tool_calls

import { speedFromTiming } from '@/services/aiRuntime/metrics';
import type {
  AiCapability,
  AiChatMessage,
  AiChatRequest,
  AiModelDescriptor,
  AiProbeResult,
  AiStreamEvent,
  AiToolCall,
  AiUsage,
} from '@/services/aiRuntime/types';
import { ollamaBase } from '@/services/aiRuntime/urlPolicy';
import { parseParameterSize } from '@/services/aiRuntime/fit';
import {
  AdapterError,
  errorFromException,
  errorFromResponse,
  parseJsonSafe,
  redact,
  request,
  requestJson,
  streamLines,
} from './http';
import type { AdapterContext, ProviderAdapter } from './types';

interface TagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: {
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
      context_length?: number;
    };
    capabilities?: string[];
  }>;
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  details?: { family?: string; parameter_size?: string; quantization_level?: string; context_length?: number };
}

function capabilitiesFrom(list: string[] | undefined, family: string | undefined): AiCapability[] {
  const caps = new Set<AiCapability>(['chat', 'streaming']);
  if (list) {
    if (list.includes('tools')) caps.add('tools');
    if (list.includes('vision')) caps.add('vision');
    if (list.includes('thinking')) caps.add('thinking');
    return [...caps];
  }
  // No capability list (old server): guess from the family, conservatively.
  if (family && /qwen3|qwen2\.5|llama3\.[1-9]|mistral|gemma4|granite|nemotron|command|hermes|glm/i.test(family)) caps.add('tools');
  if (family && /vl|llava|qwen3\.[5-9]|gemma[34]|minicpm|moondream/i.test(family)) caps.add('vision');
  return [...caps];
}

function contextFromModelInfo(info: Record<string, unknown> | undefined): number | undefined {
  if (!info) return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (/\.context_length$/.test(key) && typeof value === 'number') return value;
  }
  return undefined;
}

async function listModels(ctx: AdapterContext, signal?: AbortSignal): Promise<AiModelDescriptor[]> {
  const base = ollamaBase(ctx.connection.baseUrl);
  const tags = await requestJson<TagsResponse>(`${base}/api/tags`, { secret: ctx.secret, signal, connectTimeoutMs: 8000 });
  const rows = (tags.models ?? []).filter((m) => typeof (m.name ?? m.model) === 'string');
  const needShow = rows.filter((m) => !Array.isArray(m.capabilities)).slice(0, 24);
  const shown = new Map<string, ShowResponse>();
  // Older servers: ask each model for its capabilities, four at a time.
  for (let i = 0; i < needShow.length; i += 4) {
    await Promise.all(
      needShow.slice(i, i + 4).map(async (m) => {
        const name = (m.name ?? m.model) as string;
        try {
          shown.set(name, await requestJson<ShowResponse>(`${base}/api/show`, { body: { model: name }, secret: ctx.secret, signal, connectTimeoutMs: 8000 }));
        } catch {
          // capabilities stay guessed
        }
      }),
    );
  }
  return rows.map((m) => {
    const name = (m.name ?? m.model) as string;
    const show = shown.get(name);
    const details = m.details ?? show?.details;
    const family = details?.family;
    const caps = capabilitiesFrom(m.capabilities ?? show?.capabilities, family);
    // Embedding-only models cannot chat; keep them out of the picker.
    const isEmbedding = Array.isArray(m.capabilities ?? show?.capabilities)
      && !(m.capabilities ?? show?.capabilities ?? []).includes('completion');
    return {
      connectionId: ctx.connection.id,
      id: name,
      type: 'chat' as const,
      capabilities: isEmbedding ? [] : caps,
      family,
      contextWindow: details?.context_length ?? contextFromModelInfo(show?.model_info),
      sizeBytes: typeof m.size === 'number' ? m.size : undefined,
      parameterCountB: parseParameterSize(details?.parameter_size),
      quantization: details?.quantization_level,
      installed: true,
    };
  }).filter((m) => m.capabilities.length > 0);
}

async function probe(ctx: AdapterContext, signal?: AbortSignal): Promise<AiProbeResult> {
  const base = ollamaBase(ctx.connection.baseUrl);
  const started = Date.now();
  try {
    const version = await requestJson<{ version?: string }>(`${base}/api/version`, { secret: ctx.secret, signal, connectTimeoutMs: 4000 });
    const latencyMs = Date.now() - started;
    let models: AiModelDescriptor[] = [];
    try {
      models = await listModels(ctx, signal);
    } catch {
      // version answered: the server is up even if the tag list is slow
    }
    return { ok: true, latencyMs, version: version.version, models };
  } catch (err) {
    const e = errorFromException(err, signal, ctx.secret);
    return { ok: false, code: e.code, error: e.message, latencyMs: Date.now() - started };
  }
}

function messagesPayload(messages: AiChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.args ?? {} },
        })),
      };
    }
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_name: message.name, tool_call_id: message.toolCallId };
    }
    return { role: message.role, content: message.content };
  });
}

interface ChatChunk {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  /** Nanoseconds, on the final chunk. */
  eval_duration?: number;
  prompt_eval_duration?: number;
  error?: string;
}

/** Ollama's final chunk carries exact counts and nanosecond timings. */
export function usageFromChunk(chunk: ChatChunk): AiUsage {
  const usage: AiUsage = { promptTokens: chunk.prompt_eval_count, completionTokens: chunk.eval_count };
  if (typeof chunk.eval_duration === 'number' && chunk.eval_duration > 0 && typeof chunk.eval_count === 'number') {
    usage.evalDurationMs = Math.round(chunk.eval_duration / 1e6);
    usage.tokensPerSecond = Math.round((chunk.eval_count / (chunk.eval_duration / 1e9)) * 10) / 10;
  }
  return usage;
}

async function chat(
  ctx: AdapterContext,
  req: AiChatRequest,
  emit: (event: AiStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = ollamaBase(ctx.connection.baseUrl);
  const build = (withThink: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: messagesPayload(req.messages),
      stream: true,
      // A text→image hand-off asks for the model to be dropped the moment the
      // answer ends, so the diffusion model gets the GPU (see AiChatRequest).
      keep_alive: req.releaseAfter ? 0 : '30m',
      options: {
        num_ctx: req.contextTokens ?? 32_768,
        num_predict: req.maxTokens ?? 4096,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
    }
    // Thinking families answer faster with it off; older servers reject the
    // field, and the caller retries without it.
    if (withThink && req.disableThinking !== false) body.think = false;
    return body;
  };

  let res: Response;
  try {
    res = await request(`${base}/api/chat`, { body: build(true), secret: ctx.secret, signal, connectTimeoutMs: 600_000 });
    if (res.status === 400) {
      const text = await res.text().catch(() => '');
      if (/think/i.test(text)) {
        res = await request(`${base}/api/chat`, { body: build(false), secret: ctx.secret, signal, connectTimeoutMs: 600_000 });
      } else if (/tool/i.test(text)) {
        emit({ type: 'error', code: 'tools-unsupported', message: `This model does not support tools: ${redact(text, ctx.secret).slice(0, 200)}` });
        return;
      } else {
        emit({ type: 'error', code: 'bad-request', message: `Ollama rejected the request: ${redact(text, ctx.secret).slice(0, 300)}` });
        return;
      }
    }
  } catch (err) {
    const e = errorFromException(err, signal, ctx.secret);
    emit(signal.aborted ? { type: 'cancelled' } : { type: 'error', code: e.code, message: e.message });
    return;
  }
  if (!res.ok) {
    const e = await errorFromResponse(res, ctx.secret);
    emit({ type: 'error', code: e.code, message: e.message });
    return;
  }

  emit({ type: 'started', connectionId: ctx.connection.id, modelId: req.modelId });
  let seq = 0;
  let sawToolCalls = false;
  const turn: { finish: 'stop' | 'tool-calls' | 'length' | 'unknown' } = { finish: 'unknown' };
  // Wall-clock fallback for the speed badge: a server that omits
  // eval_duration (older builds, some proxies) still gets an approximate
  // figure, flagged as such, instead of no figure at all.
  let firstDeltaAt: number | null = null;
  let lastDeltaAt: number | null = null;
  let characters = 0;
  try {
    await streamLines(
      res,
      (line) => {
        const chunk = parseJsonSafe<ChatChunk>(line);
        if (!chunk) return;
        if (chunk.error) throw new AdapterError('server-error', redact(chunk.error, ctx.secret));
        // Only emit strings: a variant returning structured content would be
        // coerced to "[object Object]" in the assistant message otherwise.
        if (typeof chunk.message?.thinking === 'string' && chunk.message.thinking) emit({ type: 'reasoning', text: chunk.message.thinking });
        if (typeof chunk.message?.content === 'string' && chunk.message.content) {
          const now = Date.now();
          if (firstDeltaAt === null) firstDeltaAt = now;
          lastDeltaAt = now;
          characters += chunk.message.content.length;
          emit({ type: 'delta', text: chunk.message.content });
        }
        for (const raw of chunk.message?.tool_calls ?? []) {
          const name = raw.function?.name;
          if (!name) continue;
          let args: Record<string, unknown> = {};
          const a = raw.function?.arguments;
          if (a && typeof a === 'object' && !Array.isArray(a)) args = a as Record<string, unknown>;
          else if (typeof a === 'string') {
            const parsed = parseJsonSafe<unknown>(a);
            args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { _raw: a };
          }
          const call: AiToolCall = { id: raw.id || `call_${Date.now().toString(36)}_${(seq += 1)}`, name, args };
          sawToolCalls = true;
          emit({ type: 'tool-call', call });
        }
        if (chunk.done) {
          const usage = usageFromChunk(chunk);
          if (usage.tokensPerSecond === undefined) {
            const timed = speedFromTiming(usage.completionTokens, characters, firstDeltaAt, lastDeltaAt);
            if (timed) Object.assign(usage, timed);
          }
          emit({ type: 'usage', usage });
          turn.finish = chunk.done_reason === 'length' ? 'length' : 'stop';
        }
      },
      { signal, idleTimeoutMs: 600_000 },
    );
  } catch (err) {
    if (signal.aborted) {
      emit({ type: 'cancelled' });
      return;
    }
    const e = errorFromException(err, signal, ctx.secret);
    emit({ type: 'error', code: e.code, message: e.message });
    return;
  }
  const finish = turn.finish;
  emit({ type: 'done', finishReason: sawToolCalls && finish !== 'length' ? 'tool-calls' : finish === 'unknown' ? 'stop' : finish });
}

export const ollamaAdapter: ProviderAdapter = { probe, listModels, chat };
