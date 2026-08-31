// ============================================================================
// AI adapter — the managed stable-diffusion.cpp server (main process)
// ============================================================================
//
// Image generation only, over the server's native async API: submit a job,
// poll it, cancel it when the user does. The model list is what the app has
// downloaded (electron/ai/sdRuntime.ts), not what the server reports — the
// server holds one model at a time and is restarted with whichever the
// request names.

import type {
  AiChatRequest,
  AiGeneratedImage,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiProbeResult,
  AiStreamEvent,
} from '@/services/aiRuntime/types';
import { imageCatalogEntry } from '@/services/aiRuntime/imageCatalog';
import { buildSdJobPayload, SD_SERVER_URL } from '@/services/aiRuntime/sdServer';
import { AdapterError, errorFromException, parseJsonSafe, readBounded, request, requestJson } from './http';
import type { AdapterContext, ProviderAdapter } from './types';
import { ensureSdServer, installedSdCatalogEntries, isSdRuntimeInstalled, getSdRuntimeStatus, touchSdServer } from '../sdRuntime';

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const POLL_MS = 500;
/** A 1024² FLUX batch on a mid-range card can take a few minutes. */
const JOB_TIMEOUT_MS = 15 * 60_000;

function descriptors(connectionId: string): AiModelDescriptor[] {
  return installedSdCatalogEntries().map((entry) => ({
    connectionId,
    id: entry.id,
    type: 'image',
    capabilities: ['image-generation'],
    label: entry.label,
    family: entry.family,
    sizeBytes: entry.totalBytes,
    installed: true,
    nativeWidth: entry.nativeWidth,
    nativeHeight: entry.nativeHeight,
  }));
}

async function listModels(ctx: AdapterContext): Promise<AiModelDescriptor[]> {
  await getSdRuntimeStatus();
  if (!isSdRuntimeInstalled()) {
    throw new AdapterError('unreachable', 'The local image runtime is not installed. Download it in AI settings → Local image models.');
  }
  return descriptors(ctx.connection.id);
}

async function probe(ctx: AdapterContext): Promise<AiProbeResult> {
  const started = Date.now();
  try {
    const models = await listModels(ctx);
    return { ok: true, latencyMs: Date.now() - started, models };
  } catch (err) {
    const e = errorFromException(err);
    return { ok: false, code: e.code, error: e.message, latencyMs: Date.now() - started };
  }
}

async function chat(_ctx: AdapterContext, _req: AiChatRequest, emit: (event: AiStreamEvent) => void): Promise<void> {
  emit({ type: 'error', code: 'bad-request', message: 'The local image server only generates images.' });
}

interface JobAccepted {
  id?: string;
  status?: string;
  error?: { message?: string } | string;
}

interface JobStatus {
  status?: 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';
  result?: { images?: Array<{ index?: number; b64_json?: string; seed?: number }> } | null;
  error?: { code?: string; message?: string } | null;
}

function decode(b64: string): AiGeneratedImage {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new AdapterError('bad-response', 'The image is larger than 24 MB.');
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) throw new AdapterError('bad-response', 'The server returned data that is not a PNG image.');
  return { base64: b64, mimeType: 'image/png' };
}

async function cancelJob(jobId: string): Promise<void> {
  try {
    await request(`${SD_SERVER_URL}/sdcpp/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {}, connectTimeoutMs: 5000 });
  } catch {
    // the server may already be gone
  }
}

async function generateImage(_ctx: AdapterContext, req: AiImageRequest, signal: AbortSignal): Promise<AiImageResult> {
  const entry = imageCatalogEntry(req.modelId);
  if (!entry) return { ok: false, code: 'model-missing', error: `"${req.modelId}" is not a local image model.` };
  const started = await ensureSdServer(req.modelId);
  if (!started.ok) {
    const message =
      started.error === 'runtime-missing'
        ? 'The local image runtime is not installed. Download it in AI settings → Local image models.'
        : started.error === 'model-missing'
          ? `"${entry.label}" is not downloaded. Download it in AI settings → Local image models.`
          : `The local image server could not start: ${started.error ?? 'unknown'}`;
    return { ok: false, code: 'unreachable', error: message };
  }
  if (signal.aborted) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
  touchSdServer();

  // Pick the seed here when the caller left it random: the Gallery row then
  // records a number that reproduces the picture, instead of "unknown".
  const seed = req.seed ?? Math.floor(Math.random() * 2_147_483_647);
  let jobId: string | null = null;
  try {
    const accepted = await requestJson<JobAccepted>(`${SD_SERVER_URL}/sdcpp/v1/img_gen`, {
      body: buildSdJobPayload({ ...req, seed }, entry),
      signal,
      connectTimeoutMs: 30_000,
    });
    if (accepted.error) {
      throw new AdapterError('server-error', typeof accepted.error === 'string' ? accepted.error : accepted.error.message ?? 'server error');
    }
    if (!accepted.id) throw new AdapterError('bad-response', 'The server did not return a job id.');
    jobId = accepted.id;

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    for (;;) {
      if (signal.aborted) {
        await cancelJob(jobId);
        return { ok: false, code: 'cancelled', error: 'Cancelled.' };
      }
      if (Date.now() > deadline) {
        await cancelJob(jobId);
        throw new AdapterError('timeout', 'The image took too long to generate.');
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      // A long generation is still activity: keep the idle-stop timer pushed
      // back so the server is not killed out from under its own job.
      touchSdServer();
      // A busy sd-server (CPU fallback, or the GPU shared with a resident LLM)
      // may not answer a status poll for many seconds. A slow or dropped poll
      // is NOT a failed generation: swallow it and poll again until the overall
      // deadline. Only an explicit `failed` status, an abort, or the deadline
      // ends the job. Otherwise a single stalled poll threw away a good image.
      let job: JobStatus | null = null;
      try {
        const res = await request(`${SD_SERVER_URL}/sdcpp/v1/jobs/${encodeURIComponent(jobId)}`, { signal, connectTimeoutMs: 30_000 });
        if (res.status === 404 || res.status === 410) throw new AdapterError('server-error', 'The server forgot the job.');
        // A completed job embeds the batch as base64; bound the read so a
        // malformed oversized body can't be pulled whole into memory. request()
        // does not enforce maxBodyBytes (it also serves streaming), so bound here.
        if (res.ok) job = parseJsonSafe<JobStatus>(await readBounded(res, MAX_IMAGE_BYTES * 4 * 2));
        else await res.body?.cancel().catch(() => undefined);
      } catch (pollErr) {
        if (signal.aborted) throw pollErr;
        if (pollErr instanceof AdapterError && pollErr.code === 'server-error') throw pollErr;
        // transient (timeout / connection reset): keep waiting.
        continue;
      }
      if (!job) continue;
      if (job.status === 'completed') {
        const images: AiGeneratedImage[] = [];
        for (const item of job.result?.images ?? []) {
          if (!item.b64_json) continue;
          const image = decode(item.b64_json);
          // sd.cpp seeds a batch as seed, seed+1, … in index order.
          image.seed = typeof item.seed === 'number' ? item.seed : seed + (typeof item.index === 'number' ? item.index : images.length);
          images.push(image);
        }
        if (!images.length) throw new AdapterError('bad-response', 'The server finished the job without images.');
        touchSdServer();
        return { ok: true, images };
      }
      if (job.status === 'failed') throw new AdapterError('server-error', job.error?.message ?? 'Generation failed.');
      if (job.status === 'cancelled') return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    }
  } catch (err) {
    if (signal.aborted) {
      if (jobId) await cancelJob(jobId);
      return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    }
    const e = errorFromException(err, signal);
    return { ok: false, code: e.code, error: e.message };
  }
}

export const sdcppAdapter: ProviderAdapter = { probe, listModels, chat, generateImage };
