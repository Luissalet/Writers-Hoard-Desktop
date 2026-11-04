// Predicate for the live sd-server check: did the server refuse a request
// because its structured `lora[]` named a LoRA that is not installed?
//
// Observed on the real pinned binary (92a3b73, sd15-q8): the request is rejected
// synchronously with HTTP 400 and the body {"error":"invalid generation parameters"},
// while the server log carries `[ERROR] common.cpp:... - invalid lora`. The body does
// not name the LoRA, so the log line is what ties the refusal to lora[]. A 503, a body
// without that exact error, an accepted job (id present) or a job that failed for
// another reason must never be credited as "the server read lora[]".
export type SdJobOutcome =
  | { httpStatus: number; error?: unknown }
  | { status?: string; error?: unknown };

export const LORA_REFUSAL_STATUS = 400;
export const LORA_REFUSAL_ERROR = 'invalid generation parameters';
export const LORA_REFUSAL_LOG = /\binvalid lora\b/i;

export function describeOutcome(outcome: SdJobOutcome): string {
  return JSON.stringify(outcome).slice(0, 300);
}

export function isMissingLoraRefusal(outcome: SdJobOutcome, serverLog: string): boolean {
  if (!outcome || typeof outcome !== 'object' || !('httpStatus' in outcome)) return false;
  if (outcome.httpStatus !== LORA_REFUSAL_STATUS) return false;
  // The live runner unwraps the body to its `error` string; the saved receipt kept the whole {error} object.
  const raw = outcome.error;
  const message = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? (raw as { error?: unknown }).error : undefined;
  if (message !== LORA_REFUSAL_ERROR) return false;
  return LORA_REFUSAL_LOG.test(String(serverLog ?? ''));
}
