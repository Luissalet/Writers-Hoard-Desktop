// ============================================
// World Markdown export — pictures and sounds under media/
// ============================================

import type JSZip from 'jszip';
import { NameRegistry, safeName } from './names';
import { MEDIA_FILE_LIMIT_BYTES, MEDIA_TOTAL_LIMIT_BYTES, type MediaLimits } from './limits';

const megabytes = (bytes: number) => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0);
/** Wording of the guard warnings, in the language of the export. */
export interface MediaWarningTexts { tooBig(name: string, mb: string, limitMb: string): string; capped(count: number, limitMb: string): string }
const PLAIN_TEXTS: MediaWarningTexts = {
  tooBig: (name, mb, limitMb) => `${name} (${mb} MB) is over the ${limitMb} MB limit per file and was left out.`,
  capped: (count, limitMb) => `${count} file(s) were left out because the media reached ${limitMb} MB.`,
};

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov',
};

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)((?:;[^,;]*)*),([\s\S]*)$/;

export interface ParsedDataUrl { mime: string; ext: string; bytes: Uint8Array }

export function parseDataUrl(value: string): ParsedDataUrl | null {
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = EXTENSIONS[mime] ?? ((mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin');
  try {
    if (/;base64/i.test(match[2])) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, ext, bytes };
    }
    return { mime, ext, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
  } catch { return null; }
}

/** Decoded size of a data URL without decoding it. */
export function dataUrlBytes(value: string | undefined | null): number {
  if (!value || !value.startsWith('data:')) return 0;
  const comma = value.indexOf(',');
  if (comma < 0) return 0;
  if (/;base64$/i.test(value.slice(0, comma))) {
    const payload = value.length - comma - 1;
    return Math.max(0, Math.floor(payload * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0));
  }
  return value.length - comma - 1;
}

/** Counts embedded pictures (data URLs inside <img>) of rich text. */
export function inlineImageBytes(html: string | undefined): number {
  if (!html || !html.includes('data:')) return 0;
  let total = 0;
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*"(data:[^"]*)"/gi)) total += dataUrlBytes(match[1]);
  return total;
}

/**
 * Where pictures and sounds go. When media is off, `add` answers null and the
 * caller writes a plain "not included" marker instead.
 */
export class MediaSink {
  private readonly names = new Map<string, NameRegistry>();
  private readonly seen = new Map<string, string>();
  files = 0;
  bytes = 0;
  skipped = 0;
  /** Files left out because one alone was over the per-file limit. */
  tooBig = 0;
  /** Files left out because the total limit had been reached. */
  capped = 0;
  private stopped = false;
  private readonly oversize: string[] = [];
  private readonly zip: JSZip;
  readonly enabled: boolean;
  private readonly limits: MediaLimits;
  private readonly texts: MediaWarningTexts;
  constructor(zip: JSZip, enabled: boolean, limits: Partial<MediaLimits> = {}, texts: MediaWarningTexts = PLAIN_TEXTS) {
    this.zip = zip; this.enabled = enabled; this.texts = texts;
    this.limits = { perFile: limits.perFile ?? MEDIA_FILE_LIMIT_BYTES, total: limits.total ?? MEDIA_TOTAL_LIMIT_BYTES };
  }

  /** The guards: a file over the per-file limit is skipped; past the total limit nothing more is added. */
  private admit(label: string, size: number): boolean {
    if (size > this.limits.perFile) { this.tooBig++; this.oversize.push(this.texts.tooBig(label, megabytes(size), megabytes(this.limits.perFile))); return false; }
    if (this.stopped || this.bytes + size > this.limits.total) { this.stopped = true; this.capped++; return false; }
    return true;
  }
  /** Human warnings about everything the guards left out. */
  warnings(): string[] {
    return [...this.oversize, ...(this.capped ? [this.texts.capped(this.capped, megabytes(this.limits.total))] : [])];
  }

  private slot(folder: string, stem: string, ext: string): string {
    let registry = this.names.get(folder);
    if (!registry) { registry = new NameRegistry(); this.names.set(folder, registry); }
    return `media/${folder}/${registry.take(stem, 'file')}.${ext}`;
  }

  /** Writes a data-URL picture; returns its path inside the ZIP, or null. */
  addDataUrl(dataUrl: string | undefined | null, folder: string, stem: string): string | null {
    if (!this.enabled || !dataUrl) return null;
    const known = this.seen.get(dataUrl);
    if (known) return known;
    if (!this.admit(`${folder}/${stem}`, dataUrlBytes(dataUrl))) return null;
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !parsed.bytes.byteLength) { this.skipped++; return null; }
    const path = this.slot(folder, stem, parsed.ext);
    this.zip.file(path, parsed.bytes, { compression: 'STORE' });
    this.seen.set(dataUrl, path);
    this.files++; this.bytes += parsed.bytes.byteLength;
    return path;
  }

  /** Writes a stored sound or video; the file name keeps its own extension. */
  async addBlob(blob: Blob, folder: string, filename: string): Promise<string | null> {
    if (!this.enabled) return null;
    const dot = filename.lastIndexOf('.');
    const stem = safeName(dot > 0 ? filename.slice(0, dot) : filename, 'media');
    const ext = dot > 0 ? filename.slice(dot + 1).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin' : 'bin';
    if (!this.admit(filename, blob.size)) return null;
    const path = this.slot(folder, stem, ext);
    this.zip.file(path, blob, { compression: 'STORE' });
    this.files++; this.bytes += blob.size;
    return path;
  }
}
