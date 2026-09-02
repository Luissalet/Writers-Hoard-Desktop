// ============================================================================
// Writers Hoard — Nominatim geocoding for the real atlas (main process)
// ============================================================================
//
// The renderer's "find coordinates" button lands here. Main makes the request
// because Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// wants an identifying User-Agent and no more than one request a second, and
// only one place in the app can keep that promise: a browser fixes the
// header itself, and two editors could ask at the same moment. Requests are
// queued and spaced a second apart; the query is bounded; the body is handed
// back as parsed JSON for the renderer to shape (`src/engines/real-atlas/geocode.ts`).
//
// Nothing is cached and nothing but the query leaves the machine. The
// renderer only calls this after the writer agreed, per project, that the map
// may talk to OpenStreetMap.

import { net } from 'electron';
import type { GeocodeResponse } from '@/engines/real-atlas/geocode';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'WritersHoard/0.1 (local desktop app)';
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 5;
/** A geocoder answer is a few kilobytes; anything past this is not one. */
const MAX_BODY_BYTES = 256 * 1024;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.replace(/\s+/g, ' ').trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}

/** Nominatim wants a language tag; anything that does not look like one falls back to English. */
function sanitizeLocale(raw: unknown): string {
  return typeof raw === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw) ? raw : 'en';
}

async function fetchNominatim(q: string, locale: string): Promise<GeocodeResponse> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(MAX_RESULTS));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', locale);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await net.fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      // The query goes to Nominatim and nowhere else: a redirect would carry
      // it (and the User-Agent) to whatever host answered, so it is an error.
      redirect: 'error',
    });
    if (!response.ok) {
      return { ok: false, code: 'http', error: `Nominatim answered HTTP ${response.status}.` };
    }
    const text = await readBounded(response);
    if (text === null) {
      return { ok: false, code: 'http', error: 'Nominatim answered with something far larger than a result list.' };
    }
    try {
      return { ok: true, results: JSON.parse(text) as unknown };
    } catch {
      // A captive portal or an outage page: the transport worked, the answer
      // is not the API's — 'http', so the renderer does not blame the network.
      return { ok: false, code: 'http', error: 'Nominatim answered with something that is not JSON.' };
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, code: 'timeout', error: `No answer from Nominatim within ${TIMEOUT_MS / 1000} s.` };
    }
    return { ok: false, code: 'network', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The body as text, or null when it is larger than `MAX_BODY_BYTES`. The
 * bound is enforced BEFORE the body is held whole: a declared length past it
 * is refused without reading, and an undeclared (chunked) body is read
 * through the stream and abandoned at the first byte over the cap, so a
 * server that answers with a gigabyte costs a quarter of a megabyte of
 * memory rather than the whole thing. Not covered by a test: the harness
 * has no network and `net.fetch` has no seam to fake one through; the
 * bounded read is short enough to be checked by reading it.
 */
async function readBounded(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > MAX_BODY_BYTES ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, received));
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * One geocoding request, queued behind any other in flight so the whole app
 * never exceeds Nominatim's one request a second. A bad query is refused
 * without joining the queue.
 */
export function geocodePlace(rawQuery: unknown, rawLocale: unknown): Promise<GeocodeResponse> {
  const q = sanitizeQuery(rawQuery);
  if (!q) {
    return Promise.resolve({ ok: false, code: 'bad-query', error: `The query must be 1 to ${MAX_QUERY_LENGTH} characters.` });
  }
  const locale = sanitizeLocale(rawLocale);
  const next = queue.then(() => fetchNominatim(q, locale));
  // A failed request must not poison the queue for the next one.
  queue = next.catch(() => undefined);
  return next;
}
