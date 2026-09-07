import type { ReferenceSection } from './types';

const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'but', 'not',
  'una', 'uno', 'unos', 'unas', 'del', 'las', 'los', 'por', 'para', 'que',
  'como', 'con', 'sin', 'sus', 'está', 'esta', 'ese', 'esa', 'entre', 'sobre',
]);

export function foldJudgeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

export function lexicalTerms(value: string): string[] {
  const terms = foldJudgeText(value).match(WORD) ?? [];
  return [...new Set(terms.filter(term => !STOP_WORDS.has(term)))];
}

export async function sha256Hex(value: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const owned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(owned).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', owned);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

interface DraftSection {
  page?: number;
  heading?: string;
  text: string;
}

/** Split prose without cutting every citation at an arbitrary character. */
function chunkText(text: string, maxCharacters = 2_400): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(value => value.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      push();
      for (let start = 0; start < paragraph.length; start += maxCharacters) {
        chunks.push(paragraph.slice(start, start + maxCharacters).trim());
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxCharacters) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks;
}

function markdownDrafts(text: string): DraftSection[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections: DraftSection[] = [];
  let heading: string | undefined;
  let body: string[] = [];
  const flush = () => {
    const value = body.join('\n').trim();
    if (value) {
      for (const chunk of chunkText(value)) sections.push({ heading, text: chunk });
    }
    body = [];
  };
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (match) {
      flush();
      heading = match[1].trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

function plainTextDrafts(text: string): DraftSection[] {
  const pages = text.replace(/\r\n?/g, '\n').split('\f');
  return pages.flatMap((pageText, pageIndex) =>
    chunkText(pageText).map(textChunk => ({
      ...(pages.length > 1 ? { page: pageIndex + 1 } : {}),
      text: textChunk,
    })),
  );
}

async function pdfDrafts(
  bytes: Uint8Array,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<DraftSection[]> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;
  const loadingTask = getDocument({ data: bytes });
  const abort = () => { void loadingTask.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loadingTask.promise;
    const drafts: DraftSection[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal?.aborted) throw new DOMException('Reference indexing cancelled', 'AbortError');
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map(item => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      for (const chunk of chunkText(text)) {
        drafts.push({ page: pageNumber, heading: `Page ${pageNumber}`, text: chunk });
      }
      onProgress?.(pageNumber, pdf.numPages);
    }
    return drafts;
  } finally {
    signal?.removeEventListener('abort', abort);
    await loadingTask.destroy().catch(() => undefined);
  }
}

export type SupportedReferenceKind = 'pdf' | 'markdown' | 'text';

export function referenceKind(file: Pick<File, 'name' | 'type'>): SupportedReferenceKind | null {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  if (file.type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (file.type === 'text/markdown' || extension === 'md' || extension === 'markdown') return 'markdown';
  if (file.type === 'text/plain' || extension === 'txt') return 'text';
  return null;
}

export async function extractReferenceSections(
  documentId: string,
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    /** Already-read bytes, so hashing + extraction never hold two file reads. */
    buffer?: ArrayBuffer;
  } = {},
): Promise<ReferenceSection[]> {
  const kind = referenceKind(file);
  if (!kind) throw new Error('unsupported-reference-format');
  const buffer = options.buffer ?? await file.arrayBuffer();
  if (options.signal?.aborted) throw new DOMException('Reference indexing cancelled', 'AbortError');
  const drafts = kind === 'pdf'
    ? await pdfDrafts(new Uint8Array(buffer), options.signal, options.onProgress)
    : kind === 'markdown'
      ? markdownDrafts(new TextDecoder().decode(buffer))
      : plainTextDrafts(new TextDecoder().decode(buffer));
  const nonEmpty = drafts.filter(draft => draft.text.trim());
  if (nonEmpty.length === 0) throw new Error(kind === 'pdf' ? 'pdf-has-no-text-layer' : 'reference-is-empty');

  const sections: ReferenceSection[] = [];
  for (let order = 0; order < nonEmpty.length; order++) {
    const draft = nonEmpty[order];
    sections.push({
      id: `${documentId}:section:${order + 1}`,
      documentId,
      order,
      page: draft.page,
      heading: draft.heading,
      text: draft.text,
      textHash: await sha256Hex(draft.text),
      terms: lexicalTerms(draft.text),
    });
  }
  return sections;
}
