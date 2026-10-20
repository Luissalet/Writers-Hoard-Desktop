/** Portable diagram input. No storage, editor, network or rendering side effects. */
export interface PortableFigure extends Record<string, unknown> {
  format: 'vitruvius.figure/1';
  document_id: string;
  revision: number;
  title?: string;
  page_id?: string | null;
  state_id?: string | null;
  content: Record<string, unknown>;
  origin?: Record<string, string>;
  preview: { mime: 'image/png'; data: string; [key: string]: unknown };
}

export interface ParsedFigure {
  figure: PortableFigure;
  /** Original supplied JSON text, or complete JSON encoding of an object input. */
  sourceJson: string;
  png: Uint8Array;
  width: number;
  height: number;
  /** Pixel decoding must still succeed before inserting an image in an editor. */
  pngValidation: 'signature-and-dimensions';
}

export class FigureImportError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'FigureImportError';
    this.field = field;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(field: string, message: string): never {
  throw new FigureImportError(field, message);
}

function completeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'number' && !Number.isFinite(item)) fail('source', 'Numbers must be finite.');
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item)) fail('source', 'Use complete JSON values.');
      return item;
    });
    if (encoded === undefined) fail('source', 'Choose a JSON figure.');
    return encoded;
  } catch (error) {
    if (error instanceof FigureImportError) throw error;
    return fail('source', 'Use a complete, non-circular JSON figure.');
  }
}

/** Retain every supplied JSON field, including future optional /1 extensions. */
export function parsePortableFigure(input: unknown): ParsedFigure {
  const sourceJson = typeof input === 'string' ? input : completeJson(input);
  let value: unknown;
  try { value = JSON.parse(sourceJson); }
  catch { return fail('source', 'Choose a valid JSON figure.'); }
  completeJson(value);
  if (!object(value)) fail('source', 'The figure must be a JSON object.');
  if (value.format !== 'vitruvius.figure/1') fail('format', 'Expected vitruvius.figure/1.');
  if (typeof value.document_id !== 'string' || !/^[0-9a-f]{12}$/.test(value.document_id)) fail('document_id', 'Expected the 12-character source document ID.');
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) fail('revision', 'Expected a positive integer source revision.');
  if (value.title !== undefined && typeof value.title !== 'string') fail('title', 'Expected a title string.');
  if (!object(value.content) || !object(value.content.diagram) || !Array.isArray(value.content.diagram.nodes)) fail('content', 'Retain the complete native diagram source.');
  const content = value.content;
  if (value.page_id !== undefined && value.page_id !== null) {
    const pages = object(content.view) ? content.view.pages : undefined;
    if (typeof value.page_id !== 'string' || !Array.isArray(pages) || !pages.some(page => object(page) && page.id === value.page_id)) fail('page_id', 'The captured page must exist in the retained source.');
  }
  if (value.state_id !== undefined && value.state_id !== null) {
    const states = object(content.mechanism) ? content.mechanism.states : undefined;
    if (value.page_id != null || typeof value.state_id !== 'string' || value.state_id.length < 1 || value.state_id.length > 60 ||
        (content.diagram as Record<string, unknown>).type !== 'isometric' || !Array.isArray(states) ||
        !states.some(state => object(state) && state.id === value.state_id)) fail('state_id', 'The captured state must exist in the retained isometric source, without a page selection.');
  }
  if (value.origin !== undefined) {
    if (!object(value.origin)) fail('origin', 'Expected HTTP(S) origin links.');
    for (const [key, link] of Object.entries(value.origin)) {
      if (typeof link !== 'string') fail(`origin.${key}`, 'Expected an HTTP(S) link.');
      let url: URL;
      try { url = new URL(link); }
      catch { return fail(`origin.${key}`, 'Expected an HTTP(S) link.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(`origin.${key}`, 'Use HTTP(S) without credentials.');
    }
  }
  if (!object(value.preview) || value.preview.mime !== 'image/png' || typeof value.preview.data !== 'string') fail('preview', 'Retain a base64 PNG capture.');
  const encoded = value.preview.data;
  if (!encoded.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('preview.data', 'Expected complete base64 PNG data.');
  let png: Uint8Array;
  try { png = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { return fail('preview.data', 'Expected complete base64 PNG data.'); }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || !signature.every((byte, index) => png[index] === byte)) fail('preview.data', 'Expected a PNG signature and complete IHDR.');
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (header.getUint32(8) !== 13 || String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') fail('preview.data', 'Expected the PNG IHDR header.');
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height) fail('preview.data', 'PNG dimensions must be positive.');
  return { figure: value as PortableFigure, sourceJson, png, width, height, pngValidation: 'signature-and-dimensions' };
}

/** Stable complete-capture identity; distinct revisions/pages/states remain distinct. */
export async function figureFingerprint(figure: PortableFigure): Promise<string> {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ordered(figure))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
