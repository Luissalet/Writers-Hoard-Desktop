// ============================================================================
// AI runtime — base URL normalisation and network policy (pure)
// ============================================================================
//
// The settings page accepts whatever the user pastes — "192.168.1.20:1234",
// "http://host:8080/v1/", "https://api.example.com" — and everything past that
// point works with ONE normalised form. Locality is derived here too, because
// it decides two things at once: the Local/LAN/Remote badge, and whether plain
// HTTP is acceptable (loopback and LAN: yes; the open internet: only with an
// explicit opt-in, since a bearer token would travel in clear).

import type { AiConnectionKind, AiLocality } from './types';

export interface NormalisedBaseUrl {
  ok: true;
  /** Origin plus base path, no trailing slash. */
  baseUrl: string;
  locality: AiLocality;
  protocol: 'http:' | 'https:';
  host: string;
}

export interface BaseUrlProblem {
  ok: false;
  code: 'empty' | 'bad-url' | 'bad-scheme' | 'userinfo' | 'query' | 'bad-port';
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
];

/** loopback | lan | remote for a bare hostname or IP literal. */
export function classifyHost(rawHost: string): AiLocality {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return 'remote';
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return 'loopback';
  if (/^127\./.test(host)) return 'loopback';
  if (host === '::' || host === '0.0.0.0') return 'loopback';
  // IPv4-mapped IPv6 (::ffff:192.168.0.1) and plain IPv4.
  const v4 = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(host)?.[1];
  if (v4) {
    if (/^127\./.test(v4)) return 'loopback';
    return PRIVATE_V4.some((re) => re.test(v4)) ? 'lan' : 'remote';
  }
  // Link-local and unique-local IPv6.
  if (/^fe[89ab][0-9a-f]:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) return 'lan';
  // mDNS names and bare single-label machine names never leave the LAN.
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return 'lan';
  if (!host.includes('.')) return 'lan';
  return 'remote';
}

/**
 * Turn user input into a base URL every adapter can extend with its routes.
 *
 * Rules: scheme optional (http assumed); userinfo, query and fragment are
 * refused rather than dropped, because a pasted key in the URL is exactly the
 * kind of thing that must not be stored by accident; a trailing slash is
 * removed; "/v1" is kept when given (an OpenAI-style server usually wants it)
 * and left off when not — `openAiPath()` below adds it when missing.
 */
export function normaliseBaseUrl(input: string): NormalisedBaseUrl | BaseUrlProblem {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { ok: false, code: 'empty' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: 'bad-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'bad-scheme' };
  if (url.username || url.password) return { ok: false, code: 'userinfo' };
  if (url.search || url.hash) return { ok: false, code: 'query' };
  if (url.port && !/^\d{1,5}$/.test(url.port)) return { ok: false, code: 'bad-port' };
  const path = url.pathname.replace(/\/+$/, '');
  const baseUrl = `${url.protocol}//${url.host}${path}`;
  return {
    ok: true,
    baseUrl,
    locality: classifyHost(url.hostname),
    protocol: url.protocol as 'http:' | 'https:',
    host: url.hostname,
  };
}

/** Base for OpenAI-style routes: appends "/v1" unless the user already gave one. */
export function openAiBase(baseUrl: string): string {
  return /\/v\d+$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

/** Base for Ollama's native routes: strips a "/v1" the user may have pasted. */
export function ollamaBase(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/i, '');
}

/**
 * Plain HTTP is fine on the machine and on the LAN. Across the internet it is
 * a credential leak waiting to happen, so it needs the user's explicit word.
 */
export function isTransportAcceptable(
  normalised: NormalisedBaseUrl,
  allowInsecureRemote: boolean | undefined,
): boolean {
  if (normalised.protocol === 'https:') return true;
  if (normalised.locality !== 'remote') return true;
  return allowInsecureRemote === true;
}

/** Two URLs that differ only by trailing slash or case of host are one server. */
export function sameServer(a: string, b: string): boolean {
  const na = normaliseBaseUrl(a);
  const nb = normaliseBaseUrl(b);
  if (!na.ok || !nb.ok) return false;
  return na.baseUrl.toLowerCase() === nb.baseUrl.toLowerCase();
}

/**
 * A short allowlist of ports local inference servers listen on by default.
 * "Detect on this computer" probes exactly these, in parallel, on loopback —
 * never the LAN, never silently at start-up.
 */
export const LOCAL_DETECT_TARGETS: ReadonlyArray<{
  port: number;
  kind: AiConnectionKind;
  label: string;
}> = [
  { port: 11434, kind: 'ollama', label: 'Ollama' },
  { port: 1234, kind: 'openai-compatible', label: 'LM Studio' },
  { port: 8080, kind: 'openai-compatible', label: 'llama.cpp' },
  { port: 8000, kind: 'openai-compatible', label: 'vLLM' },
  { port: 8317, kind: 'openai-compatible', label: 'CLIProxyAPI' },
  { port: 5001, kind: 'openai-compatible', label: 'KoboldCpp' },
  { port: 4891, kind: 'openai-compatible', label: 'GPT4All' },
  { port: 8100, kind: 'openai-compatible', label: 'Odysseus image server' },
];
