import {matchesFontSignature as matchesSignature} from '../local/assetFileFormat';
export type DictionaryFontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';
export interface DictionaryFont { name: string; format: DictionaryFontFormat; dataUrl: string }
export const MAX_DICTIONARY_FONT_BYTES = 512 * 1024;
const mimeByFormat = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' } as const;

/** Fonts are embedded bytes only. Never accept a local path, URL or CSS source. */
export function decodeDictionaryFont(value: unknown): { font: DictionaryFont; bytes: Uint8Array<ArrayBuffer> } {
  if (!value || typeof value !== 'object') throw new Error('Invalid font.');
  const candidate = value as Partial<DictionaryFont>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 300 || !Object.hasOwn(mimeByFormat, candidate.format ?? '') || typeof candidate.dataUrl !== 'string' || candidate.dataUrl.length > Math.ceil(MAX_DICTIONARY_FONT_BYTES / 3) * 4 + 40) throw new Error('Invalid font.');
  const format = candidate.format as DictionaryFontFormat;
  const prefix = `data:${mimeByFormat[format]};base64,`;
  if (!candidate.dataUrl.startsWith(prefix)) throw new Error('Font must contain local bytes.');
  const encoded = candidate.dataUrl.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid font encoding.');
  const binary = atob(encoded);
  if (binary.length > MAX_DICTIONARY_FONT_BYTES) throw new Error('Font exceeds 512 KiB.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!matchesSignature(bytes, format)) throw new Error('Font signature does not match its format.');
  return { font: { name: candidate.name.trim(), format, dataUrl: candidate.dataUrl }, bytes };
}

export function parseDictionaryFont(value: unknown): DictionaryFont {
  return decodeDictionaryFont(value).font;
}

export function safeDictionaryFont(value: unknown): DictionaryFont | undefined {
  if (value === undefined) return undefined;
  try { return parseDictionaryFont(value); } catch { return undefined; }
}

export async function readDictionaryFont(file: File): Promise<DictionaryFont> {
  if (!file.size || file.size > MAX_DICTIONARY_FONT_BYTES) throw new Error('Font exceeds 512 KiB.');
  const format = file.name.split('.').pop()?.toLowerCase();
  if (!format || !Object.hasOwn(mimeByFormat, format)) throw new Error('Unsupported font format.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // Avoid argument limits for ordinary desktop font files.
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const font = parseDictionaryFont({ name: file.name, format, dataUrl: `data:${mimeByFormat[format as DictionaryFontFormat]};base64,${btoa(binary)}` });
  // Signature validation alone does not guarantee a valid font. Browser decoding
  // must succeed before the draft replaces a previously working font.
  await new FontFace(`wh-font-validation-${crypto.randomUUID()}`, bytes.buffer).load();
  return font;
}
