// ============================================================================
// PNG generation metadata — read and write, over bytes alone
// ============================================================================
//
// Two chunks, two audiences.
//
// `parameters` is the A1111 spelling every other tool in this ecosystem reads —
// Diffusion Toolkit, the WebUI's own PNG-info tab, Civitai's uploader — and it
// is what stable-diffusion.cpp writes when a job asks for
// `embed_image_metadata`. Keeping it means an image leaving Writers Hoard is
// still legible where the reader takes it.
//
// `writershoard` is ours: the JSON record behind "iterate on this image" and
// "compare recipes", carrying the things the A1111 line flattens or drops —
// the LoRA list as a list, the reference image ids, the model digest.
//
// Both are pure functions over bytes: no Electron, no DOM, no Buffer. That is
// what lets the main process, the renderer and the tests all call them.
//
// Encoding: PNG says a tEXt value is Latin-1. Every writer in this ecosystem,
// stable-diffusion.cpp included, puts UTF-8 bytes there anyway, and a prompt
// with an em dash or a Japanese name would otherwise be unwritable. We match
// them — and read the value back as UTF-8, falling back to Latin-1 for a file
// that really did follow the spec.

/** Our own chunk keyword. Lower case: PNG reserves capitalised keywords. */
export const WRITERS_HOARD_KEYWORD = 'writershoard';
/** The keyword the rest of the ecosystem agreed on. */
export const PARAMETERS_KEYWORD = 'parameters';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export interface PngMetadata {
  /** The A1111-style one-liner, verbatim. */
  parameters?: string;
  /** Our record, already parsed. Absent when missing or not valid JSON. */
  writersHoard?: Record<string, unknown>;
}

// ---- CRC-32, as PNG defines it ---------------------------------------------

let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Text codecs -----------------------------------------------------------

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * UTF-8 first, Latin-1 as the fallback. A tEXt chunk that really is Latin-1
 * would come back as replacement characters through a strict UTF-8 decoder,
 * and a prompt full of "" is indistinguishable from a corrupt file.
 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

/** A PNG keyword is 1–79 printable Latin-1 characters and never a lone byte outside that. */
function isLegalKeyword(keyword: string): boolean {
  if (keyword.length < 1 || keyword.length > 79) return false;
  for (let i = 0; i < keyword.length; i += 1) {
    const code = keyword.charCodeAt(i);
    const printable = (code >= 32 && code <= 126) || (code >= 161 && code <= 255);
    if (!printable) return false;
  }
  return true;
}

function keywordBytes(keyword: string): Uint8Array {
  const out = new Uint8Array(keyword.length);
  for (let i = 0; i < keyword.length; i += 1) out[i] = keyword.charCodeAt(i) & 0xff;
  return out;
}

// ---- Chunk walking ---------------------------------------------------------

interface PngChunk {
  type: string;
  /** Offset of the chunk's length field. */
  start: number;
  /** Offset one past the chunk's CRC. */
  end: number;
  data: Uint8Array;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeUint32(into: Uint8Array, at: number, value: number): void {
  into[at] = (value >>> 24) & 0xff;
  into[at + 1] = (value >>> 16) & 0xff;
  into[at + 2] = (value >>> 8) & 0xff;
  into[at + 3] = value & 0xff;
}

/**
 * Every chunk that parses. A file truncated mid-chunk, or one claiming a length
 * that runs past its own end, yields the chunks read so far rather than an
 * exception: a half-written PNG on disk must still show the settings it does
 * have, and a reader is never the right place to lose data.
 */
function chunks(bytes: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = readUint32(bytes, at);
    // A length beyond the file, or beyond what PNG allows, means the stream is
    // no longer chunk-aligned; nothing after it can be trusted.
    if (length > 0x7fffffff || at + 12 + length > bytes.length) break;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    out.push({ type, start: at, end: at + 12 + length, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

/** Split `keyword\0value` — the tEXt layout. Returns null when there is no separator. */
function splitKeyedText(data: Uint8Array): { keyword: string; value: Uint8Array } | null {
  const nul = data.indexOf(0);
  if (nul < 1) return null;
  const keyword = decodeText(data.subarray(0, nul));
  return { keyword, value: data.subarray(nul + 1) };
}

/**
 * The iTXt layout: keyword, compression flag, compression method, language
 * tag, translated keyword, then the UTF-8 text. A compressed one is skipped —
 * inflating it would need an async DecompressionStream, and these functions
 * are synchronous by contract. Nothing this app writes is compressed.
 */
function splitInternationalText(data: Uint8Array): { keyword: string; value: Uint8Array } | null {
  const nul = data.indexOf(0);
  if (nul < 1 || nul + 2 >= data.length) return null;
  const keyword = decodeText(data.subarray(0, nul));
  if (data[nul + 1] !== 0) return null;
  const languageEnd = data.indexOf(0, nul + 3);
  if (languageEnd < 0) return null;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) return null;
  return { keyword, value: data.subarray(translatedEnd + 1) };
}

// ---- Reading ---------------------------------------------------------------

/**
 * What a PNG says about how it was made.
 *
 * Nothing here throws. A file that is not a PNG, has no text chunks, or is
 * damaged reads back as `{}` — the caller's question is "does this image carry
 * its recipe", and "no" is a perfectly good answer to hand back.
 */
export function readPngMetadata(bytes: Uint8Array): PngMetadata {
  const out: PngMetadata = {};
  if (!isPng(bytes)) return out;
  for (const chunk of chunks(bytes)) {
    if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') continue;
    const parsed = chunk.type === 'tEXt' ? splitKeyedText(chunk.data) : splitInternationalText(chunk.data);
    if (!parsed) continue;
    // First one wins: a file written twice keeps the record of the first tool
    // that claimed it, which is the same rule the rest of the ecosystem uses.
    if (parsed.keyword === PARAMETERS_KEYWORD && out.parameters === undefined) {
      out.parameters = decodeText(parsed.value);
    } else if (parsed.keyword === WRITERS_HOARD_KEYWORD && out.writersHoard === undefined) {
      try {
        const record: unknown = JSON.parse(decodeText(parsed.value));
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          out.writersHoard = record as Record<string, unknown>;
        }
      } catch {
        // Somebody else's `writershoard`, or ours from a version that wrote
        // something else. An unreadable record is not an unreadable image.
      }
    }
  }
  return out;
}

// ---- Writing ---------------------------------------------------------------

function textChunk(keyword: string, value: string): Uint8Array {
  const key = keywordBytes(keyword);
  const text = utf8Encode(value);
  const length = key.length + 1 + text.length;
  const chunk = new Uint8Array(12 + length);
  writeUint32(chunk, 0, length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // 'tEXt'
  chunk.set(key, 8);
  chunk[8 + key.length] = 0;
  chunk.set(text, 9 + key.length);
  writeUint32(chunk, 8 + length, crc32(chunk.subarray(4, 8 + length)));
  return chunk;
}

export interface PngMetadataToWrite {
  parameters?: string;
  writersHoard?: Record<string, unknown>;
}

/**
 * The same image, carrying this record.
 *
 * The new chunks go immediately after IHDR and any existing `parameters` /
 * `writershoard` chunk is dropped, so writing twice does not accumulate
 * conflicting recipes. Every other chunk keeps its bytes and its order.
 *
 * A non-PNG input is returned untouched: this function's job is to add a
 * record, never to decide what a file is.
 */
export function writePngMetadata(bytes: Uint8Array, metadata: PngMetadataToWrite): Uint8Array {
  if (!isPng(bytes)) return bytes;
  const parsed = chunks(bytes);
  const ihdr = parsed.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) return bytes;

  const ours = new Set<string>([PARAMETERS_KEYWORD, WRITERS_HOARD_KEYWORD]);
  const dropped = new Set<number>();
  for (const chunk of parsed) {
    if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') continue;
    const keyed = chunk.type === 'tEXt' ? splitKeyedText(chunk.data) : splitInternationalText(chunk.data);
    if (keyed && ours.has(keyed.keyword)) dropped.add(chunk.start);
  }

  const inserted: Uint8Array[] = [];
  if (metadata.parameters !== undefined && isLegalKeyword(PARAMETERS_KEYWORD)) {
    inserted.push(textChunk(PARAMETERS_KEYWORD, metadata.parameters));
  }
  if (metadata.writersHoard !== undefined) {
    inserted.push(textChunk(WRITERS_HOARD_KEYWORD, JSON.stringify(metadata.writersHoard)));
  }

  // Anything the chunk walker could not parse (a truncated tail) is carried
  // through byte for byte rather than silently truncated away.
  const parsedEnd = parsed.length ? parsed[parsed.length - 1].end : 8;
  const pieces: Uint8Array[] = [bytes.subarray(0, ihdr.end)];
  for (const chunk of inserted) pieces.push(chunk);
  for (const chunk of parsed) {
    if (chunk.start < ihdr.end || dropped.has(chunk.start)) continue;
    pieces.push(bytes.subarray(chunk.start, chunk.end));
  }
  if (parsedEnd < bytes.length) pieces.push(bytes.subarray(parsedEnd));

  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

// ---- The A1111 line --------------------------------------------------------

/**
 * The `key: value` tail of an A1111 `parameters` string, as a map.
 *
 * The format has no escaping, so this is a best effort by design: the prompt
 * and negative prompt come off the first lines, and the last line is split on
 * commas. A value containing a comma (a `Size: 512x512` is safe, a stray one in
 * a sampler name is not) will split wrongly — which is why the structured
 * `writershoard` record exists and is preferred whenever it is present.
 */
export function parseA1111Parameters(text: string): {
  prompt: string;
  negativePrompt?: string;
  fields: Record<string, string>;
} {
  const lines = text.split('\n');
  const fields: Record<string, string> = {};
  let negativePrompt: string | undefined;
  let settingsLine = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/(^|,\s*)(Steps|Seed|Sampler|Size|Model):\s/.test(lines[i])) {
      settingsLine = i;
      break;
    }
  }
  const promptLines: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i === settingsLine) continue;
    if (lines[i].startsWith('Negative prompt: ')) {
      negativePrompt = lines[i].slice('Negative prompt: '.length);
      continue;
    }
    if (settingsLine >= 0 && i > settingsLine) continue;
    promptLines.push(lines[i]);
  }
  if (settingsLine >= 0) {
    // stable-diffusion.cpp appends `, SDCPP: {…}` to this line, and that JSON
    // is full of commas. Splitting through it would fill `fields` with
    // fragments like `{"schema"` and could shadow a real key; the structured
    // record is read separately by `readSdcppRecord`.
    const sdcpp = lines[settingsLine].lastIndexOf(', SDCPP: ');
    const settings = sdcpp >= 0 ? lines[settingsLine].slice(0, sdcpp) : lines[settingsLine];
    for (const pair of settings.split(',')) {
      const colon = pair.indexOf(':');
      if (colon < 1) continue;
      const key = pair.slice(0, colon).trim();
      if (!key) continue;
      fields[key] = pair.slice(colon + 1).trim();
    }
  }
  return { prompt: promptLines.join('\n').trim(), negativePrompt, fields };
}

/**
 * stable-diffusion.cpp appends its own JSON to the A1111 line as
 * `, SDCPP: {…}`. It is richer than the flat fields and, unlike them, is
 * escaped — so when it is there, prefer it.
 */
export function readSdcppRecord(parameters: string): Record<string, unknown> | undefined {
  const marker = parameters.lastIndexOf(', SDCPP: ');
  if (marker < 0) return undefined;
  try {
    const record: unknown = JSON.parse(parameters.slice(marker + ', SDCPP: '.length));
    if (record && typeof record === 'object' && !Array.isArray(record)) return record as Record<string, unknown>;
  } catch {
    // Truncated or from a build that spells it differently.
  }
  return undefined;
}
