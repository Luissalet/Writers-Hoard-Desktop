// ============================================================================
// AI adapters — the contract every provider implements (main process)
// ============================================================================

import type {
  AiChatRequest,
  AiConnectionSummary,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiProbeResult,
  AiStreamEvent,
} from '@/services/aiRuntime/types';

export interface AdapterContext {
  connection: AiConnectionSummary;
  /** Decrypted API key, or null. Lives in main only. */
  secret: string | null;
}

export interface ProviderAdapter {
  /** Cheap reachability check with latency, plus the model list when cheap. */
  probe(ctx: AdapterContext, signal?: AbortSignal): Promise<AiProbeResult>;
  listModels(ctx: AdapterContext, signal?: AbortSignal): Promise<AiModelDescriptor[]>;
  /** Streams events; resolves when the turn is complete. Never throws. */
  chat(
    ctx: AdapterContext,
    request: AiChatRequest,
    emit: (event: AiStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  generateImage?(ctx: AdapterContext, request: AiImageRequest, signal: AbortSignal): Promise<AiImageResult>;
}
