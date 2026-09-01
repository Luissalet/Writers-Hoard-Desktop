// ============================================
// Manuscript import — the way in for a book that already exists
// ============================================
//
// Someone arrives with a finished novel: a .docx out of Word, a folder of
// Markdown chapters, one very long .md, or forty thousand words on the
// clipboard. Until now the only doors were Fountain/FDX (screenplays) and a
// linked Google Doc, so a prose novelist had to paste every chapter by hand.
//
// Three steps, the same shape `dialog-scene` uses for screenplays
// (`fountainImport.ts` + `importPersist.ts`) and for the same reason — nothing
// reaches Dexie until the writer has seen exactly what will be created:
//
//   parse    here + `manuscriptDocx.ts` / `manuscriptText.ts`. PURE: bytes or
//            text in, `ManuscriptBlock[]` out. No database, no React.
//   split    `splitIntoChapters()`. Pure arithmetic over parsed blocks — every
//            block already carries its word count — so the preview can rerun
//            it on each keystroke of the separator box. That is what makes the
//            splitting rule adjustable instead of a guess made behind the
//            writer's back.
//   persist  `manuscriptPersist.ts`. One transaction, create-only.
//
// No path here parses foreign HTML: the readers BUILD their html out of
// escaped text, and `manuscriptPersist` runs the app's `sanitizeRichHtml` over
// every chapter before storing it. A .docx off the internet is untrusted
// input and is treated as such.
//
// Everything long-running is chunked and yields (`yieldToUi`) with progress,
// so a 120 000-word manuscript never freezes the window — see the note on
// `yieldToUi` for why this is not a Worker.

/** Locale-key suffix under `writings.manuscriptImport.error.*`. */
export type ManuscriptErrorCode =
  /** Nothing was chosen, or the pasted box is blank. */
  | 'empty'
  /** A file this importer does not read (.doc, .rtf, .odt, .pdf …). */
  | 'unsupported'
  /** Past the byte cap — refused rather than attempted. */
  | 'too-large'
  /** The browser could not read the file off disk. */
  | 'read-failed'
  /** A .docx that is not a zip at all (renamed .doc, truncated download). */
  | 'not-zip'
  /** A zip without `word/document.xml` — not a Word document. */
  | 'invalid-docx'
  /** Read fine, contained no text. */
  | 'no-text'
  /** Split fine, every chapter was empty or dropped. */
  | 'no-chapters';

/**
 * A refusal with a reason the writer can act on. `detail` names the file when
 * one file out of many is the problem.
 *
 * (`readonly code` as a field rather than a constructor parameter property:
 * `erasableSyntaxOnly` is on in tsconfig.)
 */
export class ManuscriptImportError extends Error {
  readonly code: ManuscriptErrorCode;
  readonly detail?: string;

  constructor(code: ManuscriptErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ManuscriptImportError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * One block of the source document — a paragraph, a heading, a list, a quote.
 * The readers produce these; nothing downstream ever looks at the original
 * file again.
 */
export interface ManuscriptBlock {
  /** 0 for body content; 1–6 when this block is a heading (a possible boundary). */
  level: number;
  /**
   * The block as written. Chapter titles come from this (headings store their
   * text without the `#`), and the separator rule compares against it — which
   * is why it is the RAW line for body blocks: a `***` scene break is still
   * `***` here even though its html is an `<hr>`.
   */
  text: string;
  /** Block-level html, already escaped, ready to concatenate into a chapter. */
  html: string;
  /** Counted once at parse time so re-splitting stays arithmetic. */
  words: number;
}

/** One file (or the pasted box), reduced to blocks. */
export interface ManuscriptSource {
  /** File name as chosen, or the label given to pasted text. */
  name: string;
  /** `name` without extension, tidied — the fallback title for a whole-file chapter. */
  stem: string;
  blocks: ManuscriptBlock[];
}

export type ManuscriptPhase = 'reading' | 'writing';

export interface ManuscriptProgress {
  phase: ManuscriptPhase;
  /** 0–1 across the whole phase. */
  ratio: number;
  /** The file being read, when there is one. */
  detail?: string;
}

export type ManuscriptProgressFn = (progress: ManuscriptProgress) => void;

/** Per-file cap. A 120 000-word .docx is ~1 MB; this is two orders above it. */
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
/** Cap across one import, so a whole folder cannot be dropped in by mistake. */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** What the file picker offers. */
export const MANUSCRIPT_ACCEPT = '.docx,.md,.markdown,.txt';

const DOCX_EXTENSION = /\.docx$/i;
const TEXT_EXTENSION = /\.(?:md|markdown|mdown|txt|text)$/i;

/**
 * Hand the frame back to the browser: paint the progress bar, run the click
 * that cancels, keep the window alive.
 *
 * Why this and not a Worker: the .docx path needs JSZip to inflate
 * `word/document.xml`, and a Worker built from a Blob URL cannot import a
 * bundled module — it would need a hand-written inflate, which is exactly the
 * kind of code that must not be trusted with someone's only manuscript. So the
 * work stays on this thread and is cut into pieces small enough that no single
 * piece is visible: JSZip's own async pipeline already inflates in chunks, and
 * every loop below stops every few hundred blocks to yield here.
 *
 * `setTimeout(0)` (a macrotask) rather than a microtask on purpose — a
 * microtask would let the loop starve rendering forever.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ---------------------------------------------------------------------------
// Reading sources
// ---------------------------------------------------------------------------

/** "Chapter-01.md" → "Chapter 01". */
function stemOf(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch {
    throw new ManuscriptImportError('read-failed', file.name);
  }
}

async function readText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch {
    throw new ManuscriptImportError('read-failed', file.name);
  }
}

async function readOneFile(file: File, report: (ratio: number) => void): Promise<ManuscriptBlock[]> {
  // Extension, not MIME type: browsers report .md as everything from
  // text/markdown to the empty string depending on the OS.
  if (DOCX_EXTENSION.test(file.name)) {
    const buffer = await readArrayBuffer(file);
    const { parseDocxBlocks } = await import('./manuscriptDocx');
    return parseDocxBlocks(buffer, report);
  }
  if (TEXT_EXTENSION.test(file.name)) {
    const text = await readText(file);
    const { parseTextBlocks } = await import('./manuscriptText');
    return parseTextBlocks(text, report);
  }
  throw new ManuscriptImportError('unsupported', file.name);
}

/**
 * Read every chosen file into blocks. Throws `ManuscriptImportError` on the
 * first file it cannot honestly read — a half-imported manuscript is worse
 * than a refused one, and nothing has been written yet either way.
 */
export async function readManuscriptFiles(
  files: File[],
  onProgress?: ManuscriptProgressFn,
): Promise<ManuscriptSource[]> {
  if (files.length === 0) throw new ManuscriptImportError('empty');

  // A folder of chapters arrives in whatever order the OS handed over, and in
  // "one file, one chapter" that order IS the book. Numeric collation so
  // `chapter-2` sorts before `chapter-10`.
  const ordered = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );

  let totalBytes = 0;
  for (const file of ordered) {
    if (file.size > MAX_SOURCE_BYTES) throw new ManuscriptImportError('too-large', file.name);
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new ManuscriptImportError('too-large');

  const sources: ManuscriptSource[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const file = ordered[index];
    const report = (ratio: number): void => {
      onProgress?.({
        phase: 'reading',
        ratio: (index + Math.min(1, Math.max(0, ratio))) / ordered.length,
        detail: file.name,
      });
    };
    report(0);
    const blocks = await readOneFile(file, report);
    // An empty file among many is skipped, not fatal: exporters routinely
    // leave a stray `notes.md`. Every file empty is caught below.
    if (blocks.length > 0) {
      sources.push({ name: file.name, stem: stemOf(file.name), blocks });
    }
  }

  if (sources.length === 0) throw new ManuscriptImportError('no-text');
  onProgress?.({ phase: 'reading', ratio: 1 });
  return sources;
}

/** The pasted box, read exactly like a Markdown file. */
export async function readPastedManuscript(
  text: string,
  label: string,
): Promise<ManuscriptSource> {
  if (!text.trim()) throw new ManuscriptImportError('empty');
  if (text.length > MAX_SOURCE_BYTES) throw new ManuscriptImportError('too-large');
  const { parseTextBlocks } = await import('./manuscriptText');
  const blocks = await parseTextBlocks(text);
  if (blocks.length === 0) throw new ManuscriptImportError('no-text');
  return { name: label, stem: label, blocks };
}

// ---------------------------------------------------------------------------
// Splitting into chapters
// ---------------------------------------------------------------------------

export type ChapterSplitMode =
  /** Headings at or above `headingLevel` start a chapter. The default. */
  | 'heading'
  /** A line the writer types (`***`, `#`, `— fin —`) starts a chapter. */
  | 'separator'
  /** One file, one chapter — the folder-of-Markdown case. */
  | 'file';

export interface ChapterSplitOptions {
  mode: ChapterSplitMode;
  /** `heading` mode: a heading this deep or shallower opens a chapter (1–6). */
  headingLevel: number;
  /** `separator` mode: the line, compared trimmed against the block as written. */
  separator: string;
  /** Names a chunk that carries no title of its own. Called with 1, 2, 3 … */
  fallbackTitle: (index: number) => string;
}

export interface ParsedChapter {
  /**
   * `source:block` of the boundary that opened it. Stable across a rule change
   * whenever the boundary survives it, which is what lets the preview keep a
   * rename after the writer nudges the heading level.
   */
  key: string;
  title: string;
  blocks: ManuscriptBlock[];
  words: number;
}

interface Chunk {
  key: string;
  title: string | null;
  blocks: ManuscriptBlock[];
}

/**
 * Cut the parsed sources into chapters. Pure, cheap, and re-runnable: the
 * preview calls it again on every change of the rule.
 *
 * A boundary heading becomes the chapter's TITLE and is not repeated in its
 * body — the writing already shows its title above the editor. Deeper headings
 * inside a chapter stay in the body as headings.
 */
export function splitIntoChapters(
  sources: ManuscriptSource[],
  options: ChapterSplitOptions,
): ParsedChapter[] {
  const separator = options.separator.trim();
  const boundaryLevel = Math.min(6, Math.max(1, Math.round(options.headingLevel)));
  const chapters: ParsedChapter[] = [];

  for (let s = 0; s < sources.length; s += 1) {
    const source = sources[s];
    const chunks: Chunk[] = [{ key: `${s}:0`, title: null, blocks: [] }];

    for (let b = 0; b < source.blocks.length; b += 1) {
      const block = source.blocks[b];
      if (options.mode === 'heading' && block.level >= 1 && block.level <= boundaryLevel) {
        chunks.push({ key: `${s}:${b}`, title: block.text.trim() || null, blocks: [] });
        continue;
      }
      if (
        options.mode === 'separator' &&
        separator.length > 0 &&
        block.level === 0 &&
        block.text.trim() === separator
      ) {
        chunks.push({ key: `${s}:${b}`, title: null, blocks: [] });
        continue;
      }
      chunks[chunks.length - 1].blocks.push(block);
    }

    for (const chunk of chunks) {
      let blocks = chunk.blocks;
      let title = chunk.title;
      // A chunk that opens with a heading of its own is named by it: the front
      // matter before the first boundary, and every file in `file` mode.
      if (title === null && blocks.length > 0 && blocks[0].level >= 1 && blocks[0].text.trim()) {
        title = blocks[0].text.trim();
        blocks = blocks.slice(1);
      }
      const words = blocks.reduce((total, block) => total + block.words, 0);
      // Nothing to write: a boundary on the first line, a heading with no text
      // under it, a tail of blank paragraphs. Never becomes an empty chapter.
      if (words === 0) continue;
      chapters.push({
        key: chunk.key,
        // The file name only names a chapter that IS the whole file; once a
        // file has been cut up, "chapter-03" is no longer the name of any one
        // piece of it.
        title: title ?? (chunks.length === 1 ? source.stem : ''),
        blocks,
        words,
      });
    }
  }

  return chapters.map((chapter, index) =>
    chapter.title ? chapter : { ...chapter, title: options.fallbackTitle(index + 1) },
  );
}

/** Heading depths the sources actually contain — the levels worth offering. */
export function availableHeadingLevels(sources: ManuscriptSource[]): number[] {
  const levels = new Set<number>();
  for (const source of sources) {
    for (const block of source.blocks) {
      if (block.level >= 1) levels.add(block.level);
    }
  }
  return [...levels].sort((a, b) => a - b);
}

/**
 * The rule to open the preview on. Headings when the document has them, one
 * chapter per file when several files were chosen, otherwise the separator —
 * which the writer sees, and changes, in the preview either way.
 */
export function suggestedSplitMode(sources: ManuscriptSource[]): ChapterSplitMode {
  if (availableHeadingLevels(sources).length > 0) return 'heading';
  return sources.length > 1 ? 'file' : 'separator';
}

/**
 * The heading depth to open on: the shallowest one that occurs MORE THAN ONCE,
 * falling back to the shallowest present.
 *
 * The count is what makes this useful. Word's "Title" style is a heading of
 * depth 1 and a great many manuscripts carry exactly one of them, on the title
 * page, with the chapters a level below. Opening on depth 1 there would find a
 * single chapter containing the entire book; a level nobody repeats is a
 * label, not a structure.
 */
export function suggestedHeadingLevel(sources: ManuscriptSource[]): number {
  const counts = new Map<number, number>();
  for (const source of sources) {
    for (const block of source.blocks) {
      if (block.level >= 1) counts.set(block.level, (counts.get(block.level) ?? 0) + 1);
    }
  }
  const levels = [...counts.keys()].sort((a, b) => a - b);
  if (levels.length === 0) return 1;
  return levels.find((level) => (counts.get(level) ?? 0) > 1) ?? levels[0];
}

/** A chapter's blocks as one html document. Sanitised in `manuscriptPersist`. */
export function chapterToHtml(blocks: ManuscriptBlock[]): string {
  const html = blocks.map((block) => block.html).join('');
  return html || '<p></p>';
}
