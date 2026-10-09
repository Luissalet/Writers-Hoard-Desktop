// ============================================================================
// Beta reading — reading a reader's response file (pure)
// ============================================================================
//
// The file comes from a stranger's machine. Nothing in it is trusted: every
// field is coerced, clipped and stripped of control characters, and anything
// that does not make a comment is dropped and counted rather than stored.

import { MAX_QUOTE_CHARS, CONTEXT_CHARS } from './anchor';
import { hashText, normalizeText } from './text';
import {
  FORMAT_VERSION, REACTIONS, RESPONSE_FORMAT,
  type ReaderResponse, type ResponseComment,
} from './types';

export const MAX_RESPONSE_BYTES = 8_000_000;
export const MAX_COMMENTS = 5000;
export const MAX_COMMENT_CHARS = 5000;
export const MAX_READER_CHARS = 80;

export class BetaFormatError extends Error {
  readonly code: 'not-json' | 'wrong-format' | 'too-large' | 'wrong-version' | 'invalid';
  constructor(code: BetaFormatError['code'], message: string) {
    super(message);
    this.name = 'BetaFormatError';
    this.code = code;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(CONTROL, '').slice(0, max) : '';
}

function isoOr(value: unknown, fallback: string): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(Date.parse(value)).toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  return fallback;
}

export interface ParsedResponse {
  response: ReaderResponse;
  /** Comments the file held that could not be used (no chapter, no text, over the cap). */
  dropped: number;
}

/** Validate and normalise a response file. Throws BetaFormatError with a reason a person can act on. */
export function parseResponse(input: string | unknown): ParsedResponse {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_RESPONSE_BYTES) throw new BetaFormatError('too-large', 'The response file is too large.');
    try { raw = JSON.parse(input); } catch { throw new BetaFormatError('not-json', 'The file is not valid JSON.'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BetaFormatError('wrong-format', 'This is not a beta reading response.');
  const source = raw as Record<string, unknown>;
  if (source.format !== RESPONSE_FORMAT) throw new BetaFormatError('wrong-format', 'This is not a beta reading response.');
  if (typeof source.formatVersion !== 'number' || source.formatVersion > FORMAT_VERSION) {
    throw new BetaFormatError('wrong-version', 'This response was made by a newer version of the format.');
  }
  const packageId = clean(source.packageId, 120).trim();
  if (!packageId) throw new BetaFormatError('invalid', 'The response does not say which package it answers.');
  const packageVersion = Number(source.packageVersion);
  if (!Number.isInteger(packageVersion) || packageVersion < 1) throw new BetaFormatError('invalid', 'The response has no valid package version.');
  const reader = normalizeText(clean(source.reader, MAX_READER_CHARS)) || 'Anonymous';
  const exportedAt = isoOr(source.exportedAt, new Date(0).toISOString());

  const chapters: ReaderResponse['chapters'] = [];
  if (Array.isArray(source.chapters)) {
    for (const item of source.chapters) {
      const row = item as Record<string, unknown> | null;
      const chapterId = clean(row?.chapterId, 200);
      if (chapterId) chapters.push({ chapterId, contentHash: clean(row?.contentHash, 40) });
    }
  }

  const reactions: Record<string, string[]> = {};
  if (source.reactions && typeof source.reactions === 'object' && !Array.isArray(source.reactions)) {
    for (const [chapterId, list] of Object.entries(source.reactions as Record<string, unknown>)) {
      if (!Array.isArray(list) || !chapterId) continue;
      const kept = [...new Set(list.filter((key): key is string => typeof key === 'string' && (REACTIONS as readonly string[]).includes(key)))];
      if (kept.length) reactions[clean(chapterId, 200)] = kept;
    }
  }

  const comments: ResponseComment[] = [];
  let dropped = 0;
  const listed = Array.isArray(source.comments) ? source.comments : [];
  for (const item of listed) {
    if (comments.length >= MAX_COMMENTS) { dropped++; continue; }
    const row = item as Record<string, unknown> | null;
    const chapterId = clean(row?.chapterId, 200);
    const text = clean(row?.text, MAX_COMMENT_CHARS).trim();
    if (!row || typeof row !== 'object' || !chapterId || !text) { dropped++; continue; }
    const paragraph = Number(row.paragraph);
    comments.push({
      id: clean(row.id, 80),
      chapterId,
      quote: normalizeText(clean(row.quote, MAX_QUOTE_CHARS * 2)).slice(0, MAX_QUOTE_CHARS),
      prefix: clean(row.prefix, CONTEXT_CHARS * 2).slice(-CONTEXT_CHARS),
      suffix: clean(row.suffix, CONTEXT_CHARS * 2).slice(0, CONTEXT_CHARS),
      paragraph: Number.isInteger(paragraph) && paragraph >= 0 && paragraph < 1_000_000 ? paragraph : 0,
      text,
      createdAt: isoOr(row.createdAt, exportedAt),
    });
  }

  return {
    response: {
      format: RESPONSE_FORMAT,
      formatVersion: FORMAT_VERSION,
      packageId, packageVersion, reader, exportedAt, chapters, reactions, comments,
    },
    dropped,
  };
}

/** Stable identity of a comment: the same words from the same reader on the same package always get the same id. */
export function commentIdFor(projectId: string, response: ReaderResponse, comment: ResponseComment): string {
  return `bc_${hashText([
    projectId, response.packageId, response.reader.toLowerCase(), comment.chapterId, comment.paragraph,
    comment.quote, comment.text, comment.createdAt,
  ].join('\u0001'))}`;
}

/** One response row per reader per package: a reader who sends a second file updates the first. */
export function responseIdFor(projectId: string, response: Pick<ReaderResponse, 'packageId' | 'reader'>): string {
  return `br_${hashText(`${projectId}\u0001${response.packageId}\u0001${response.reader.toLowerCase()}`)}`;
}
