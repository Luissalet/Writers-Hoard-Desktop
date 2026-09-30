// ============================================
// Source grading (pure)
// ============================================
//
// Two independent axes, as analysts write them: how far the SOURCE can be
// trusted (A completely reliable … F cannot be judged) and how well this
// piece of INFORMATION holds up (1 confirmed by other sources … 6 cannot be
// judged). "B2" is a reliable source giving probably-true information.
// A citation written before grading existed has neither axis and reads as
// "ungraded": there is no default grade to fall back on.

import type { Citation, SourceCredibility, SourceReliability } from '@/types/projectTools';

export const SOURCE_RELIABILITIES: readonly SourceReliability[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SOURCE_CREDIBILITIES: readonly SourceCredibility[] = [1, 2, 3, 4, 5, 6];

export type GradableCitation = Pick<Citation, 'reliability' | 'credibility'>;
export type OriginCitation = Pick<Citation, 'id' | 'origin' | 'url' | 'publisher'>;

export function isReliability(value: unknown): value is SourceReliability {
  return typeof value === 'string' && (SOURCE_RELIABILITIES as readonly string[]).includes(value);
}

export function isCredibility(value: unknown): value is SourceCredibility {
  return typeof value === 'number' && (SOURCE_CREDIBILITIES as readonly number[]).includes(value);
}

/** "B2" when both axes are set, "B" or "2" when only one is, null when ungraded. */
export function gradeLabel(citation: GradableCitation): string | null {
  const reliability = isReliability(citation.reliability) ? citation.reliability : '';
  const credibility = isCredibility(citation.credibility) ? String(citation.credibility) : '';
  return `${reliability}${credibility}` || null;
}

export function isGraded(citation: GradableCitation): boolean {
  return gradeLabel(citation) !== null;
}

export function isRetracted(citation: Pick<Citation, 'retractedAt'>): boolean {
  return typeof citation.retractedAt === 'number' && citation.retractedAt > 0;
}

/** Parse "B2", "b", "2" (from a tool call or a text field). Null when it is not a grade. */
export function parseGrade(text: string): { reliability?: SourceReliability; credibility?: SourceCredibility } | null {
  const match = /^\s*([A-Fa-f])?\s*([1-6])?\s*$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  return {
    ...(match[1] ? { reliability: match[1].toUpperCase() as SourceReliability } : {}),
    ...(match[2] ? { credibility: Number(match[2]) as SourceCredibility } : {}),
  };
}

// Second-level registries where the registrable domain has three labels.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'or', 'ne', 'go']);

/** Registrable-ish domain of a host: `news.bbc.co.uk` → `bbc.co.uk`, `www.nytimes.com` → `nytimes.com`. */
export function registrableHost(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = last.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** The host of a URL without credentials or port, lowercase, or null when it is not a web URL. */
export function hostOfUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Who stands behind a source, for judging independence: the author's explicit
 * `origin`, else the URL host, else the publisher. Two citations with the same
 * origin count once. A citation with none of these is its own origin (keyed by
 * id) rather than being lumped with other unknowns: unknown is not "same".
 */
export function originOf(citation: OriginCitation): string {
  const explicit = citation.origin?.trim();
  if (explicit) return normalizeOrigin(explicit);
  const host = hostOfUrl(citation.url);
  if (host) return registrableHost(host);
  const publisher = citation.publisher?.trim();
  if (publisher) return normalizeOrigin(publisher);
  return `citation:${citation.id}`;
}

/** Lowercase, collapsed whitespace; a pasted URL becomes its registrable host. */
export function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  const host = /^https?:\/\//i.test(trimmed) ? hostOfUrl(trimmed) : null;
  if (host) return registrableHost(host);
  const asHost = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed) ? registrableHost(trimmed) : null;
  return (asHost ?? trimmed).toLowerCase().replace(/\s+/g, ' ');
}

/** Fields of a citation that only the grading operations may change. */
export const GRADING_FIELDS = ['reliability', 'credibility', 'origin', 'retractedAt', 'retractReason'] as const;
