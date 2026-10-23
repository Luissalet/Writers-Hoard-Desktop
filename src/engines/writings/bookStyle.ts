// ============================================
// Book style — how a whole compiled book is set
// ============================================
// The editor lets a writer set a paragraph by hand (alignment, line height, a
// drop cap, a scene-break ornament). A book style sets them for every chapter
// at compile time instead, from a publishing profile: the writer picks a feel
// once and every export reads the same. A paragraph the writer formatted by
// hand keeps its own setting; the style only fills what was left open.
//
// It works by writing the same semantic attributes the editor writes, so the
// HTML, PDF, ePub and DOCX writers — which already understand those — set the
// book without each learning a second vocabulary. What has no per-paragraph
// attribute (spacing between paragraphs, letter spacing, the size of chapter
// titles, an ornament under them, small capitals on the opening line) is
// carried as `BookStyle` and drawn by each writer.

import { SCENE_BREAK_STYLES, SCENE_BREAK_TEXT, formattingFromElement, formattingStyle, type SceneBreakStyle } from '@/components/editor/advanced/model';

export const BOOK_PRESETS = ['classic', 'modern', 'epic', 'sourcebook'] as const;
export type BookPreset = typeof BOOK_PRESETS[number];
export const TITLE_ORNAMENTS = ['none', 'line', 'asterism', 'dots', 'diamond'] as const;
/** Page sizes a book is printed at: A4 and US Letter, and two book trims. */
export const BOOK_TRIMS = ['a4', 'letter', 'a5', '6x9'] as const;
export type BookTrim = typeof BOOK_TRIMS[number];
/** The page the book is printed on. */
export const BOOK_PAPERS = ['white', 'cream', 'parchment', 'night'] as const;
export type BookPaper = typeof BOOK_PAPERS[number];

/** Width × height in millimetres, the margins, and how many words a page holds at 12 pt. */
export const TRIM_SIZES: Record<BookTrim, { width: number; height: number; margin: number; wordsPerPage: number }> = {
  a4: { width: 210, height: 297, margin: 25, wordsPerPage: 400 },
  letter: { width: 215.9, height: 279.4, margin: 25.4, wordsPerPage: 380 },
  a5: { width: 148, height: 210, margin: 18, wordsPerPage: 250 },
  '6x9': { width: 152.4, height: 228.6, margin: 19, wordsPerPage: 280 },
};
export const PAPER_COLORS: Record<BookPaper, { background: string; ink: string }> = {
  white: { background: '#ffffff', ink: '#1a1a1a' },
  cream: { background: '#f8f1e3', ink: '#2a2118' },
  parchment: { background: '#eedfbf', ink: '#3a2a16' },
  night: { background: '#1d1f24', ink: '#e6e1d6' },
};
export type TitleOrnament = typeof TITLE_ORNAMENTS[number];

export interface BookStyle {
  /** The preset it started from; `custom` once a value is changed by hand. */
  preset: BookPreset | 'custom';
  align: 'justify' | 'left';
  /** Line height, 1.1 to 2.4. */
  lineHeight: number;
  /** Extra space between letters, in em: 0 to 0.12. */
  letterSpacing: number;
  /** Indented paragraphs with no gap (a novel) or a gap with no indent (a report). */
  paragraphs: 'indented' | 'spaced';
  /** Gap between spaced paragraphs, in em: 0.2 to 2. */
  paragraphSpacing: number;
  /** The first paragraph after a scene break starts flush, as books set it. */
  flushAfterBreak: boolean;
  /** A drop cap on the first paragraph of every chapter. */
  dropCap: boolean;
  /** Small capitals on the first line of every chapter. */
  smallCapsOpening: boolean;
  /** Ornament for scene breaks that do not name one. */
  sceneBreak: SceneBreakStyle;
  /** Chapter title size in points, 12 to 36. */
  titleSize: number;
  /** An ornament under each chapter title. */
  titleOrnament: TitleOrnament;
  /** Page size of the PDF and the Word file, and the page estimate. */
  trim: BookTrim;
  /** The page colour and ink. */
  paper: BookPaper;
  /** One column of prose, or two (a game manual or sourcebook). Chapter titles and page-wide images span both. */
  columns: 1 | 2;
  /** Every other table row shaded. */
  stripedTables: boolean;
}

const PRESETS: Record<BookPreset, Omit<BookStyle, 'preset'>> = {
  // A novel set the old way: justified, indented, a drop cap and small capitals.
  classic: { align: 'justify', lineHeight: 1.5, letterSpacing: 0, paragraphs: 'indented', paragraphSpacing: 0.6, flushAfterBreak: true, dropCap: true, smallCapsOpening: true, sceneBreak: 'asterism', titleSize: 20, titleOrnament: 'diamond', trim: 'a5', paper: 'cream', columns: 1, stripedTables: false },
  // Clean and airy: ragged right, spaced paragraphs, no ornaments.
  modern: { align: 'left', lineHeight: 1.65, letterSpacing: 0.01, paragraphs: 'spaced', paragraphSpacing: 0.9, flushAfterBreak: true, dropCap: false, smallCapsOpening: false, sceneBreak: 'space', titleSize: 18, titleOrnament: 'none', trim: 'a4', paper: 'white', columns: 1, stripedTables: false },
  // A tome: large titles with a rule, a drop cap, tight justified lines.
  epic: { align: 'justify', lineHeight: 1.42, letterSpacing: 0.015, paragraphs: 'indented', paragraphSpacing: 0.6, flushAfterBreak: true, dropCap: true, smallCapsOpening: true, sceneBreak: 'dots', titleSize: 26, titleOrnament: 'line', trim: '6x9', paper: 'parchment', columns: 1, stripedTables: false },
  // A game manual: two columns on Letter, spaced paragraphs, striped tables, boxed text kept whole.
  sourcebook: { align: 'justify', lineHeight: 1.35, letterSpacing: 0, paragraphs: 'spaced', paragraphSpacing: 0.55, flushAfterBreak: true, dropCap: false, smallCapsOpening: false, sceneBreak: 'line', titleSize: 26, titleOrnament: 'line', trim: 'letter', paper: 'white', columns: 2, stripedTables: true },
};

export function bookPreset(preset: BookPreset): BookStyle {
  return { preset, ...PRESETS[preset] };
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value * 1000) / 1000)) : fallback;

/** A stored style made safe, or undefined when there is none. Unknown values fall back to the preset's. */
export function normalizeBookStyle(raw: unknown): BookStyle | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const preset = BOOK_PRESETS.includes(value.preset as BookPreset) ? value.preset as BookPreset : 'custom';
  const base = PRESETS[preset === 'custom' ? 'classic' : preset];
  return {
    preset,
    align: value.align === 'left' || value.align === 'justify' ? value.align : base.align,
    lineHeight: clamp(value.lineHeight, 1.1, 2.4, base.lineHeight),
    letterSpacing: clamp(value.letterSpacing, 0, 0.12, base.letterSpacing),
    paragraphs: value.paragraphs === 'spaced' || value.paragraphs === 'indented' ? value.paragraphs : base.paragraphs,
    paragraphSpacing: clamp(value.paragraphSpacing, 0.2, 2, base.paragraphSpacing),
    flushAfterBreak: typeof value.flushAfterBreak === 'boolean' ? value.flushAfterBreak : base.flushAfterBreak,
    dropCap: typeof value.dropCap === 'boolean' ? value.dropCap : base.dropCap,
    smallCapsOpening: typeof value.smallCapsOpening === 'boolean' ? value.smallCapsOpening : base.smallCapsOpening,
    sceneBreak: SCENE_BREAK_STYLES.includes(value.sceneBreak as SceneBreakStyle) ? value.sceneBreak as SceneBreakStyle : base.sceneBreak,
    titleSize: clamp(value.titleSize, 12, 36, base.titleSize),
    titleOrnament: TITLE_ORNAMENTS.includes(value.titleOrnament as TitleOrnament) ? value.titleOrnament as TitleOrnament : base.titleOrnament,
    trim: BOOK_TRIMS.includes(value.trim as BookTrim) ? value.trim as BookTrim : base.trim,
    paper: BOOK_PAPERS.includes(value.paper as BookPaper) ? value.paper as BookPaper : base.paper,
    columns: value.columns === 1 || value.columns === 2 ? value.columns : base.columns,
    stripedTables: typeof value.stripedTables === 'boolean' ? value.stripedTables : base.stripedTables,
  };
}

export const TITLE_ORNAMENT_TEXT: Record<TitleOrnament, string> = { none: '', line: '—', asterism: '⁂', dots: '• • •', diamond: '◇' };

/** The class the first prose paragraph of a chapter carries, for the opening-line small capitals. */
export const BOOK_OPENING_CLASS = 'wh-book-opening';

const INDENT_EM = 1.5;

/**
 * Set one chapter's HTML in the book style. Only top-level paragraphs and
 * scene breaks are touched; quotes, lists, tables and anything the writer
 * formatted by hand keep what they have.
 */
export function applyBookStyle(html: string, style: BookStyle): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const body = parsed.body;
  let opening = true;
  let afterBreak = false;
  for (const element of Array.from(body.children)) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'hr') {
      if (!element.hasAttribute('data-wh-ornament')) element.setAttribute('data-wh-ornament', style.sceneBreak);
      afterBreak = true;
      continue;
    }
    if (tag !== 'p') { if (/^h[1-6]$/.test(tag)) afterBreak = true; continue; }
    if (!(element.textContent ?? '').trim()) continue;
    if (!element.hasAttribute('data-wh-align')) element.setAttribute('data-wh-align', style.align);
    if (!element.hasAttribute('data-wh-line-height')) element.setAttribute('data-wh-line-height', String(style.lineHeight));
    if (!element.hasAttribute('data-wh-first-line-indent')) {
      const flush = style.paragraphs === 'spaced' || opening || (afterBreak && style.flushAfterBreak);
      element.setAttribute('data-wh-first-line-indent', String(flush ? 0 : INDENT_EM));
    }
    if (opening) {
      if (style.dropCap && !element.hasAttribute('data-wh-drop-cap')) element.setAttribute('data-wh-drop-cap', 'true');
      if (style.smallCapsOpening) element.classList.add(BOOK_OPENING_CLASS);
    }
    // The inline style is always derived from the semantic attributes, as the
    // editor renders it, so the browser-based formats draw what was set.
    const inline = formattingStyle(formattingFromElement(element));
    if (inline) element.setAttribute('style', inline);
    opening = false;
    afterBreak = false;
  }
  return body.innerHTML;
}

/**
 * The CSS for what has no per-paragraph attribute. `prose` is the selector
 * the chapter body sits under, `title` the chapter heading's.
 */
export function bookStyleCss(style: BookStyle, prose: string, title: string): string {
  return [
    `${prose} p{letter-spacing:${style.letterSpacing}em;margin:0 0 ${style.paragraphs === 'spaced' ? style.paragraphSpacing : 0.1}em}`,
    // The attributes drawn directly too, for a page that strips inline styles
    // (the in-app preview sanitizes them away).
    `${prose} p[data-wh-align="justify"]{text-align:justify;hyphens:auto;-webkit-hyphens:auto}`,
    `${prose} p[data-wh-align="left"]{text-align:left}`,
    `${prose} p[data-wh-first-line-indent="0"]{text-indent:0}`,
    `${prose} p[data-wh-first-line-indent="${INDENT_EM}"]{text-indent:${INDENT_EM}em}`,
    `${prose} p[data-wh-drop-cap="true"]:not([data-wh-drop-cap-rendered="true"])::first-letter{float:left;font-size:3.2em;line-height:.85;margin:.05em .12em 0 0}`,
    `${prose}{line-height:${style.lineHeight}}`,
    `${prose} .${BOOK_OPENING_CLASS}::first-line{font-variant:small-caps;font-variant-caps:small-caps;letter-spacing:.04em}`,
    `${title}{font-size:${style.titleSize}pt}`,
    `.wh-title-ornament{text-align:center;text-indent:0;margin:-.4em 0 1.4em;letter-spacing:.2em;opacity:.7}`,
    ...(style.columns === 2 ? [
      `${prose}{column-count:2;column-gap:7mm;column-fill:balance}`,
      `${prose} [data-wh-column-break]{break-before:column;-webkit-column-break-before:always;border:0;margin:0;height:0}`,
      `${prose} [data-wh-column-break]::after{content:none;display:none}`,
      `${prose} img[data-wh-width="page"],${prose} h2{column-span:all;-webkit-column-span:all}`,
      `${prose} aside,${prose} table,${prose} figure,${prose} img{break-inside:avoid;-webkit-column-break-inside:avoid}`,
    ] : []),
    ...(style.stripedTables ? [
      `${prose} table{border-collapse:collapse;width:100%}`,
      `${prose} table th{background:color-mix(in srgb,currentColor 16%,transparent);text-align:left}`,
      `${prose} table tr:nth-child(even) td{background:color-mix(in srgb,currentColor 7%,transparent)}`,
      `${prose} table td,${prose} table th{padding:.25em .5em}`,
    ] : []),
  ].join('\n');
}

/**
 * The page itself, for a whole printed document: its size and margins (read
 * by the PDF printer) and its paper and ink. Not for the in-app preview,
 * which keeps the app's own page.
 */
export function bookPageCss(style: BookStyle): string {
  const trim = TRIM_SIZES[style.trim], paper = PAPER_COLORS[style.paper];
  return [
    `@page{size:${trim.width}mm ${trim.height}mm;margin:${trim.margin}mm}`,
    `html,body{background:${paper.background};color:${paper.ink}}`,
    `body a,.wh-toc a,.wh-footnote-ref a{color:${paper.ink}}`,
    `@media print{body{max-width:none;padding:0}}`,
  ].join('\n');
}

/** Pages a number of words fills at a trim; a style-less book counts 250 a page. */
export function bookPages(words: number, style?: BookStyle): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / (style ? TRIM_SIZES[style.trim].wordsPerPage : 250)));
}

/** The ornament paragraph under a chapter title, or '' for none. */
export function titleOrnamentHtml(style: BookStyle | undefined): string {
  if (!style || style.titleOrnament === 'none') return '';
  return `<p class="wh-title-ornament" aria-hidden="true">${TITLE_ORNAMENT_TEXT[style.titleOrnament]}</p>`;
}

/** The scene-break text a style gives, for formats that draw breaks as text. */
export function sceneBreakText(style: SceneBreakStyle): string {
  return SCENE_BREAK_TEXT[style];
}
