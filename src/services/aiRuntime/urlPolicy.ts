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

/** The four octets of a dotted-quad IPv4 literal, or null when it is a name. */
function ipv4Octets(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** The eight 16-bit groups of an IPv6 literal, or null when it is not one. */
function ipv6Groups(raw: string): number[] | null {
  const zone = raw.indexOf('%');
  let text = zone >= 0 ? raw.slice(0, zone) : raw;
  if (!text.includes(':')) return null;
  // A trailing dotted quad (::ffff:192.168.0.1) folds into two hex groups.
  const cut = text.lastIndexOf(':');
  const tail = text.slice(cut + 1);
  if (tail.includes('.')) {
    const octets = ipv4Octets(tail);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, cut + 1)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };
  const left = parse(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parse(halves[1]);
  if (!right) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function classifyIpv4(octets: number[]): AiLocality {
  const text = octets.join('.');
  if (octets[0] === 127 || text === '0.0.0.0') return 'loopback';
  return PRIVATE_V4.some((re) => re.test(text)) ? 'lan' : 'remote';
}

function classifyIpv6(groups: number[]): AiLocality {
  const topZero = groups.slice(0, 5).every((g) => g === 0);
  // "::" (unspecified) and "::1" (loopback) both mean this machine.
  if (topZero && groups[5] === 0 && groups[6] === 0 && (groups[7] === 0 || groups[7] === 1)) {
    return 'loopback';
  }
  // IPv4-mapped: WHATWG URL rewrites ::ffff:192.168.0.1 to ::ffff:c0a8:1, so
  // the embedded address is read back out of the last 32 bits.
  if (topZero && groups[5] === 0xffff) {
    return classifyIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
  }
  if ((groups[0] & 0xffc0) === 0xfe80) return 'lan'; // fe80::/10 link-local
  if ((groups[0] & 0xfe00) === 0xfc00) return 'lan'; // fc00::/7 unique-local
  return 'remote';
}

/**
 * loopback | lan | remote for a bare hostname or IP literal.
 *
 * A private range is only private when the host really IS an IP literal:
 * "127.0.0.1.evil.com" is a name that resolves wherever its owner points it,
 * and so is any single-label name, which a search domain can send anywhere.
 */
export function classifyHost(rawHost: string): AiLocality {
  const trimmed = rawHost.trim().toLowerCase();
  // `new URL().hostname` keeps an IPv6 literal's brackets; callers may pass a
  // bracketed authority with a port too.
  const host = /^\[[^\]]*\](?::\d+)?$/.test(trimmed)
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed;
  if (!host) return 'remote';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';
  const v4 = ipv4Octets(host);
  if (v4) return classifyIpv4(v4);
  if (host.includes(':')) {
    const v6 = ipv6Groups(host);
    return v6 ? classifyIpv6(v6) : 'remote';
  }
  // mDNS and the two suffixes a home router hands out never leave the LAN.
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return 'lan';
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
  // ComfyUI's default. Probing it returns real models, because the adapter
  // reads /object_info rather than a model list endpoint — so autodetection
  // finds a running install without the user knowing its port.
  { port: 8188, kind: 'comfyui', label: 'ComfyUI' },
  { port: 1234, kind: 'openai-compatible', label: 'LM Studio' },
  { port: 8080, kind: 'openai-compatible', label: 'llama.cpp' },
  { port: 8000, kind: 'openai-compatible', label: 'vLLM' },
  { port: 8317, kind: 'openai-compatible', label: 'CLIProxyAPI' },
  { port: 5001, kind: 'openai-compatible', label: 'KoboldCpp' },
  { port: 4891, kind: 'openai-compatible', label: 'GPT4All' },
  { port: 8100, kind: 'openai-compatible', label: 'Odysseus image server' },
];
