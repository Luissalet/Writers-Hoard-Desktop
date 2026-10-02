import type { Session } from 'electron';
import { checkPublicUrl, type PublicPolicyOptions } from './commons';

const POLICY_TIMEOUT_MS = 10000;

/** Fail closed if DNS stalls; never cache approval across requests. */
export async function publicUrlReason(url: string, options?: PublicPolicyOptions): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      checkPublicUrl(url, options),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve('URL policy timed out'), POLICY_TIMEOUT_MS); }),
    ]);
  } catch {
    return 'URL policy could not validate the destination';
  } finally {
    clearTimeout(timer);
  }
}

/** Covers document redirects, frames, fetch, assets and WebSocket handshakes. */
export function guardCaptureSession(captureSession: Session, signal?: AbortSignal, options?: PublicPolicyOptions): () => void {
  let disposed = false;
  captureSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    // Inline assets have no network destination. Every other scheme is checked
    // (and refused by the public policy unless it is HTTP/S).
    if (/^(?:data|blob|about):/i.test(details.url)) {
      callback({ cancel: disposed || Boolean(signal?.aborted) });
      return;
    }
    const url = details.url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
    void publicUrlReason(url, options).then((reason) => {
      callback({ cancel: disposed || Boolean(signal?.aborted) || reason !== null });
    });
  });
  return () => {
    disposed = true;
    captureSession.webRequest.onBeforeRequest(null);
  };
}
