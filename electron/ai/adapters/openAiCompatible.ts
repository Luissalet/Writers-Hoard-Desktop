// ============================================================================
// AI adapter — OpenAI-compatible servers (main process)
// ============================================================================
//
// The lingua franca: CLIProxyAPI, LM Studio, llama.cpp, vLLM, KoboldCpp,
// OpenRouter, the real OpenAI, Odysseus's diffusion server… anything that
// answers /v1/models, /v1/chat/completions and /v1/images/generations.
//
//   • chat streams over SSE; tool calls arrive as fragments keyed by index and
//     are assembled here, so the gateway only ever sees whole calls;
//   • image results may be base64 or a URL. A URL is downloaded HERE, under
//     the same network policy as everything else, with a byte cap and a
//     signature check — a server that says "image/png" and sends HTML gets
//     nothing stored.

import { net } from 'electron';
import type {
  AiCapability,
  AiChatMessage,
  AiChatRequest,
  AiGeneratedImage,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiModelType,
  AiProbeResult,
  AiStreamEvent,
  AiToolCall,
} from '@/services/aiRuntime/types';
import { classifyHost, normaliseBaseUrl, openAiBase } from '@/services/aiRuntime/urlPolicy';
import { speedFromTiming } from '@/services/aiRuntime/metrics';
import {
  AdapterError,
  combineSignals,
  errorFromException,
  errorFromResponse,
  parseJsonSafe,
  redact,
  request,
  requestJson,
  streamLines,
} from './http';
import type { AdapterContext, ProviderAdapter } from './types';

const IMAGE_ID = /dall-e|gpt-image|stable|sdxl|sd-|sd_|sd3|flux|diffusion|imagen|kandinsky|playground-v|juggernaut|dreamshaper|realvis|pixart|hidream|lumina|wan2|hunyuan|midjourney/i;
const SKIP_ID = /embed|embedding|bge-|e5-|nomic|whisper|tts|rerank|moderation|clip|colbert/i;
const VISION_ID = /vision|-vl|vl-|llava|gpt-4o|gpt-4\.1|gpt-5|o[34]\b|claude|gemini|pixtral|gemma-?[34]|qwen3\.[5-9]|qwen2\.5-?vl|minicpm-v|moondream|internvl|llama-?3\.2.*vision|llama-?4|mistral-medium|nemotron3|glm-5/i;

function classifyModel(id: string): { type: AiModelType; capabilities: AiCapability[] } | null {
  if (SKIP_ID.test(id)) return null;
  if (IMAGE_ID.test(id)) return { type: 'image', capabilities: ['image-generation'] };
  const caps: AiCapability[] = ['chat', 'streaming', 'tools'];
  if (VISION_ID.test(id)) caps.push('vision');
  return { type: 'chat', capabilities: caps };
}

interface OpenAiModelList {
  data?: Array<{ id?: string; owned_by?: string; context_length?: number; max_model_len?: number }>;
}

function toolsPayload(request: AiChatRequest): unknown[] | undefined {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function messagesPayload(messages: AiChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    }
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

interface PartialToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
}

function parseArgs(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const parsed = parseJsonSafe<unknown>(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  // Some servers double-encode the arguments object.
  if (typeof parsed === 'string') {
    const inner = parseJsonSafe<unknown>(parsed);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return { _raw: text };
}

async function chat(
  ctx: AdapterContext,
  req: AiChatRequest,
  emit: (event: AiStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = openAiBase(ctx.connection.baseUrl);
  const body: Record<string, unknown> = {
    model: req.modelId,
    messages: messagesPayload(req.messages),
    stream: true,
    max_tokens: req.maxTokens ?? 4096,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  const tools = toolsPayload(req);
  if (tools) body.tools = tools;

  let res: Response;
  try {
    res = await request(`${base}/chat/completions`, { body, secret: ctx.secret, signal, connectTimeoutMs: 60_000 });
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
  const partial = new Map<number, PartialToolCall>();
  const turn: { finish: 'stop' | 'tool-calls' | 'length' | 'unknown' } = { finish: 'unknown' };
  let sawDone = false;
  let sawToolCalls = false;
  let seq = 0;
  // No server timing on this protocol: clock the streaming window ourselves.
  const clock = { firstDeltaAt: null as number | null, lastDeltaAt: null as number | null, characters: 0 };
  let serverUsage: { promptTokens?: number; completionTokens?: number } | undefined;

  const flushToolCalls = (): void => {
    for (const [, call] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
      if (!call.name) continue;
      const toolCall: AiToolCall = {
        id: call.id || `call_${Date.now().toString(36)}_${(seq += 1)}`,
        name: call.name,
        args: parseArgs(call.argumentsText),
      };
      emit({ type: 'tool-call', call: toolCall });
      sawToolCalls = true;
    }
    partial.clear();
  };

  try {
    await streamLines(
      res,
      (line) => {
        if (!line.startsWith('data:')) {
          // Some servers stream bare JSON errors without the SSE prefix.
          const bare = parseJsonSafe<StreamChunk>(line);
          if (bare?.error) throw new AdapterError('server-error', redact(typeof bare.error === 'string' ? bare.error : bare.error.message ?? 'server error', ctx.secret));
          return;
        }
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          sawDone = true;
          return;
        }
        const chunk = parseJsonSafe<StreamChunk>(payload);
        if (!chunk) return;
        if (chunk.error) {
          throw new AdapterError('server-error', redact(typeof chunk.error === 'string' ? chunk.error : chunk.error.message ?? 'server error', ctx.secret));
        }
        if (chunk.usage) {
          serverUsage = { promptTokens: chunk.usage.prompt_tokens ?? undefined, completionTokens: chunk.usage.completion_tokens ?? undefined };
        }
        const choice = chunk.choices?.[0];
        if (!choice) return;
        const delta = choice.delta ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        // Only emit strings: a server sending content as an array/number would
        // otherwise be coerced to "[object Object]" in the assistant message.
        if (typeof reasoning === 'string' && reasoning) emit({ type: 'reasoning', text: reasoning });
        if (typeof delta.content === 'string' && delta.content) emit({ type: 'delta', text: delta.content });
        if (delta.content || reasoning || delta.tool_calls?.length) {
          const now = Date.now();
          if (clock.firstDeltaAt === null) clock.firstDeltaAt = now;
          clock.lastDeltaAt = now;
          clock.characters += (delta.content?.length ?? 0) + (reasoning?.length ?? 0);
          for (const fragment of delta.tool_calls ?? []) clock.characters += fragment.function?.arguments?.length ?? 0;
        }
        for (const fragment of delta.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const current = partial.get(index) ?? { id: '', name: '', argumentsText: '' };
          if (fragment.id) current.id = fragment.id;
          // The name arrives once (first delta); assign, don't concatenate, or a
          // server that repeats it per delta yields "get_xget_xget_x".
          if (fragment.function?.name && !current.name) current.name = fragment.function.name;
          if (fragment.function?.arguments) current.argumentsText += fragment.function.arguments;
          partial.set(index, current);
        }
        if (choice.finish_reason) {
          turn.finish =
            choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
              ? 'tool-calls'
              : choice.finish_reason === 'length'
                ? 'length'
                : choice.finish_reason === 'stop'
                  ? 'stop'
                  : 'unknown';
        }
      },
      { signal },
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
  void sawDone;
  flushToolCalls();
  const timing = speedFromTiming(serverUsage?.completionTokens, clock.characters, clock.firstDeltaAt, clock.lastDeltaAt);
  // The duration here is local wall-clock (inflated by network gaps), not a
  // server eval-duration, so the tok/s is approximate even with server token
  // counts — keep the flag true so it never supersedes real server-timed history.
  if (serverUsage || timing) emit({ type: 'usage', usage: { ...serverUsage, ...timing, ...(timing ? { approximate: true } : {}) } });
  let finish = turn.finish;
  if (sawToolCalls && finish !== 'length') finish = 'tool-calls';
  emit({ type: 'done', finishReason: finish === 'unknown' ? 'stop' : finish });
}

async function listModels(ctx: AdapterContext, signal?: AbortSignal): Promise<AiModelDescriptor[]> {
  const base = openAiBase(ctx.connection.baseUrl);
  const data = await requestJson<OpenAiModelList>(`${base}/models`, { secret: ctx.secret, signal, connectTimeoutMs: 8000 });
  const out: AiModelDescriptor[] = [];
  const seen = new Set<string>();
  for (const row of data.data ?? []) {
    if (typeof row.id !== 'string' || seen.has(row.id)) continue;
    const classified = classifyModel(row.id);
    if (!classified) continue;
    seen.add(row.id);
    out.push({
      connectionId: ctx.connection.id,
      id: row.id,
      type: classified.type,
      capabilities: classified.capabilities,
      contextWindow: row.context_length ?? row.max_model_len,
      family: row.owned_by,
    });
  }
  return out;
}

async function probe(ctx: AdapterContext, signal?: AbortSignal): Promise<AiProbeResult> {
  const started = Date.now();
  try {
    const models = await listModels(ctx, signal);
    return { ok: true, latencyMs: Date.now() - started, models };
  } catch (err) {
    const e = errorFromException(err, signal, ctx.secret);
    // A server without /models is still usable with pinned model ids — but
    // discovery must not mistake any port that answers 404 for a model server.
    if (e.code === 'bad-request' && e.status === 404) {
      return { ok: true, latencyMs: Date.now() - started, models: [], modelsRouteMissing: true };
    }
    return { ok: false, code: e.code, error: e.message, latencyMs: Date.now() - started };
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

/**
 * Fetch a result URL the server handed back. Only http(s); the host must be
 * the connection's own or a public https host; no redirects; bounded; the
 * bytes must actually be an image.
 */
async function downloadImageUrl(url: string, ctx: AdapterContext, signal: AbortSignal): Promise<AiGeneratedImage> {
  // A real result URL is a signed URL with a query string, so it cannot go
  // through normaliseBaseUrl (which refuses queries); parse it directly and
  // enforce the SAME network policy via classifyHost.
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AdapterError('bad-response', 'The server returned an unusable image URL.');
  }
  if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.username || target.password) {
    throw new AdapterError('bad-response', 'The server returned an unusable image URL.');
  }
  const targetHost = target.hostname.toLowerCase();
  const own = normaliseBaseUrl(ctx.connection.baseUrl);
  const sameHost = own.ok && own.host.toLowerCase() === targetHost;
  if (!sameHost && !(target.protocol === 'https:' && classifyHost(target.hostname) === 'remote')) {
    throw new AdapterError('policy', `Refused to download an image from ${targetHost}: not the connection's host and not a public https address.`);
  }
  // A total timeout so a stalled/dribbling download can't wedge the serialized
  // image queue forever (the chat path has a hard-stop; this one had none).
  const res = await net.fetch(url, { signal: combineSignals([signal, AbortSignal.timeout(120_000)]).signal, redirect: 'manual' });
  if (!res.ok || !res.body) throw new AdapterError('bad-response', `Image download failed (HTTP ${res.status}).`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new AdapterError('bad-response', 'The image is larger than 24 MB.');
    }
    parts.push(value);
  }
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const mime = sniffImage(bytes);
  if (!mime) throw new AdapterError('bad-response', 'The downloaded file is not a PNG, JPEG, WebP or GIF image.');
  return { base64: bytes.toString('base64'), mimeType: mime };
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string; seed?: number }>;
  error?: { message?: string } | string;
}

function decodeB64Image(b64: string): AiGeneratedImage {
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new AdapterError('bad-response', 'The image is larger than 24 MB.');
  const mime = sniffImage(bytes);
  if (!mime) throw new AdapterError('bad-response', 'The server returned data that is not an image.');
  return { base64: clean, mimeType: mime };
}

async function generateOnce(
  ctx: AdapterContext,
  req: AiImageRequest,
  n: number,
  signal: AbortSignal,
): Promise<AiGeneratedImage[]> {
  const base = openAiBase(ctx.connection.baseUrl);
  const body: Record<string, unknown> = {
    model: req.modelId,
    prompt: req.prompt,
    n,
    size: `${req.width}x${req.height}`,
    response_format: 'b64_json',
  };
  if (req.quality) body.quality = req.quality;
  // Extras only when set: a strict server (OpenAI) rejects unknown fields,
  // and a user of a strict server would leave these empty.
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed !== undefined) body.seed = req.seed;
  if (req.steps !== undefined) body.steps = req.steps;
  if (req.guidance !== undefined) body.guidance_scale = req.guidance;

  const data = await requestJson<ImagesResponse>(`${base}/images/generations`, {
    body,
    secret: ctx.secret,
    signal,
    connectTimeoutMs: 600_000,
    maxBodyBytes: MAX_IMAGE_BYTES * Math.max(1, n) * 2,
  });
  if (data.error) {
    throw new AdapterError('server-error', redact(typeof data.error === 'string' ? data.error : data.error.message ?? 'server error', ctx.secret));
  }
  const out: AiGeneratedImage[] = [];
  for (const item of data.data ?? []) {
    let image: AiGeneratedImage;
    if (item.b64_json) image = decodeB64Image(item.b64_json);
    else if (item.url) image = await downloadImageUrl(item.url, ctx, signal);
    else continue;
    image.revisedPrompt = item.revised_prompt;
    image.seed = typeof item.seed === 'number' ? item.seed : req.seed;
    out.push(image);
  }
  if (!out.length) throw new AdapterError('bad-response', 'The server returned no images.');
  return out;
}

async function generateImage(ctx: AdapterContext, req: AiImageRequest, signal: AbortSignal): Promise<AiImageResult> {
  const wanted = Math.max(1, Math.min(4, Math.floor(req.n || 1)));
  try {
    try {
      return { ok: true, images: await generateOnce(ctx, req, wanted, signal) };
    } catch (err) {
      const e = errorFromException(err, signal, ctx.secret);
      // Many local servers only do one image per call: fall back to a loop.
      if (wanted > 1 && e.code === 'bad-request') {
        const images: AiGeneratedImage[] = [];
        for (let i = 0; i < wanted; i += 1) {
          if (signal.aborted) break;
          images.push(...(await generateOnce(ctx, { ...req, seed: req.seed === undefined ? undefined : req.seed + i }, 1, signal)));
        }
        if (images.length) return { ok: true, images };
      }
      throw e;
    }
  } catch (err) {
    const e = errorFromException(err, signal, ctx.secret);
    return { ok: false, code: signal.aborted ? 'cancelled' : e.code, error: e.message };
  }
}

export const openAiCompatibleAdapter: ProviderAdapter = { probe, listModels, chat, generateImage };
