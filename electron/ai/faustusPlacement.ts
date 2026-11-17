/** Where Faustus answers now. The Hub's "Run on" control can move Faustus to a Spark; this asks it, the way the Hoard
 *  commons do (`placement.js`): an address pinned by the environment wins, then this PC, then the Spark the Hub reports. */
const DEFAULT_SERVER = 'http://127.0.0.1:7000';
const DEFAULT_HUB = 'http://127.0.0.1:8810';
const clean = (url: string): string => url.trim().replace(/\/+$/, '');

async function healthy(base: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok && (await response.json())?.status === 'healthy';
  } catch { return false; }
}

export async function resolveFaustusServer(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const pinned = (env.WH_FAUSTUS_URL || env.FAUSTUS_URL || '').trim();
  if (pinned) return clean(pinned);
  if (await healthy(DEFAULT_SERVER, fetchImpl, 1500)) return DEFAULT_SERVER;
  try {
    const hub = clean(env.HOARD_HUB_URL || DEFAULT_HUB);
    const document = await (await fetchImpl(`${hub}/api/placement`, { signal: AbortSignal.timeout(1500) })).json();
    const placed = document?.urls?.faustus;
    if (document?.location === 'sparks' && !document?.job?.running && typeof placed === 'string' && /^https?:\/\//.test(placed)) return clean(placed);
  } catch { /* the Hub is silent: keep this PC's address */ }
  return DEFAULT_SERVER;
}
