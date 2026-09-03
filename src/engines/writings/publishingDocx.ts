import type { Paragraph, ParagraphChild, Table, TableOfContents } from 'docx';
import { FOOTNOTE_REF_SELECTOR, FOOTNOTE_TEXT_ATTR } from '@/components/editor/footnotes/footnoteModel';
import type { PublishingDocument } from './publishingDocument';

type DocxModule = typeof import('docx');

/** What a block-level HTML element can become in the DOCX body. */
type BlockChild = Paragraph | Table;

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  monospace?: boolean;
  /** Inside <pre>: newlines and runs of spaces are content, not layout. */
  preformatted?: boolean;
}

interface BlockContext {
  /** Nesting depth of the enclosing list; 0 outside any list. */
  listLevel: number;
  /** Concrete numbering instance the enclosing list counts on. */
  listInstance: number;
  /** Next free numbering instance, shared by the whole document. */
  nextInstance: { value: number };
  /** Inside a <blockquote>: indent and italicise the paragraphs it holds. */
  quoted: boolean;
  /** Which kind of Word note a reference becomes. */
  notes: Notes;
}

const BLOCK_TAGS = new Set([
  'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

const ROW_GROUP_TAGS = new Set(['thead', 'tbody', 'tfoot']);

/**
 * Written onto each footnote reference by `numberFootnotes` before the body
 * is walked, so the inline pass can emit the reference run without carrying
 * a counter through every call. The number is the note's id in the file:
 * Word wants those unique across the document, so it counts on through the
 * chapters rather than restarting with each.
 *
 * Whether the id is a footnote's or an endnote's is decided once per file
 * (`Notes.kind`): `docx` writes real Word footnotes (`word/footnotes.xml`)
 * or real Word endnotes (`word/endnotes.xml`), and Word itself numbers and
 * places them — at the foot of the page, or after the last chapter. Word
 * numbers footnotes continuously too; a writer who wants them restarting per
 * chapter sets that in Word's footnote options, as they always have.
 */
const FOOTNOTE_NUMBER_ATTR = 'data-footnote-number';

/** The notes of the whole file, by number, as the `docx` Document takes them. */
type NoteBodies = Record<number, { children: Paragraph[] }>;

interface Notes {
  kind: 'footnotes' | 'endnotes';
  bodies: NoteBodies;
}

function numberFootnotes(root: ParentNode, docx: DocxModule, notes: NoteBodies): void {
  for (const element of root.querySelectorAll(FOOTNOTE_REF_SELECTOR)) {
    const number = Object.keys(notes).length + 1;
    element.setAttribute(FOOTNOTE_NUMBER_ATTR, String(number));
    const lines = (element.getAttribute(FOOTNOTE_TEXT_ATTR) ?? '').split(/\r?\n/);
    notes[number] = {
      children: [new docx.Paragraph({
        children: lines.map((line, index) => new docx.TextRun({
          text: line,
          break: index === 0 ? undefined : 1,
        })),
      })],
    };
  }
}

function inlineChildren(
  nodes: Iterable<Node>,
  docx: DocxModule,
  notes: Notes,
  style: InlineStyle = {},
): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? '';
      if (style.preformatted) {
        raw.split('\n').forEach((line, index) => {
          children.push(new docx.TextRun({
            text: line,
            break: index === 0 ? undefined : 1,
            bold: style.bold,
            italics: style.italics,
            underline: style.underline ? {} : undefined,
            font: style.monospace ? 'Courier New' : undefined,
          }));
        });
        continue;
      }
      const text = raw.replace(/\s+/g, ' ');
      if (!text) continue;
      children.push(new docx.TextRun({
        text,
        bold: style.bold,
        italics: style.italics,
        underline: style.underline ? {} : undefined,
        font: style.monospace ? 'Courier New' : undefined,
      }));
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      children.push(new docx.TextRun({ break: 1 }));
      continue;
    }
    if (tag === 'img' || tag === 'ul' || tag === 'ol') continue;
    if (tag === 'sup' && node.hasAttribute(FOOTNOTE_NUMBER_ATTR)) {
      const id = Number(node.getAttribute(FOOTNOTE_NUMBER_ATTR));
      children.push(notes.kind === 'endnotes'
        ? new docx.EndnoteReferenceRun(id)
        : new docx.FootnoteReferenceRun(id));
      continue;
    }
    const nextStyle: InlineStyle = {
      ...style,
      bold: style.bold || tag === 'strong' || tag === 'b',
      italics: style.italics || tag === 'em' || tag === 'i',
      underline: style.underline || tag === 'u' || tag === 'a',
      monospace: style.monospace || tag === 'code',
    };
    children.push(...inlineChildren(node.childNodes, docx, notes, nextStyle));
  }
  return children;
}

function headingFor(tag: string, docx: DocxModule) {
  if (tag === 'h1') return docx.HeadingLevel.HEADING_2;
  if (tag === 'h2') return docx.HeadingLevel.HEADING_3;
  if (tag === 'h3') return docx.HeadingLevel.HEADING_4;
  if (tag === 'h4') return docx.HeadingLevel.HEADING_5;
  return docx.HeadingLevel.HEADING_6;
}

function hasBlockChildren(element: Element): boolean {
  return [...element.children].some(child => BLOCK_TAGS.has(child.tagName.toLowerCase()));
}

function blocksFromChildren(
  element: Element,
  docx: DocxModule,
  context: BlockContext,
): BlockChild[] {
  const blocks: BlockChild[] = [];
  for (const child of element.childNodes) {
    if (child instanceof Element && BLOCK_TAGS.has(child.tagName.toLowerCase())) {
      blocks.push(...paragraphsFromElement(child, docx, context));
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      blocks.push(new docx.Paragraph({ children: inlineChildren([child], docx, context.notes) }));
    }
  }
  return blocks;
}

function listBlocks(
  element: Element,
  docx: DocxModule,
  context: BlockContext,
): BlockChild[] {
  const reference = element.tagName.toLowerCase() === 'ul'
    ? 'publishing-bullets'
    : 'publishing-numbers';
  // Every outermost list gets its own concrete instance: sharing one makes Word
  // continue a single counter across every ordered list in the file.
  const instance = context.listLevel === 0
    ? context.nextInstance.value++
    : context.listInstance;
  const level = Math.min(context.listLevel, 5);
  const nested: BlockContext = {
    ...context,
    listLevel: context.listLevel + 1,
    listInstance: instance,
  };
  const blocks: BlockChild[] = [];
  const items = [...element.children].filter(child => child.tagName.toLowerCase() === 'li');
  for (const item of items) {
    const children = inlineChildren(item.childNodes, docx, context.notes);
    if (children.length > 0) {
      blocks.push(new docx.Paragraph({
        children,
        numbering: { reference, level, instance },
        spacing: { after: 80 },
      }));
    }
    for (const child of [...item.children].filter(node => ['ul', 'ol'].includes(node.tagName.toLowerCase()))) {
      blocks.push(...paragraphsFromElement(child, docx, nested));
    }
  }
  return blocks;
}

function rowElements(element: Element): Element[] {
  const rows: Element[] = [];
  for (const child of element.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') {
      rows.push(child);
    } else if (ROW_GROUP_TAGS.has(tag)) {
      for (const row of child.children) {
        if (row.tagName.toLowerCase() === 'tr') rows.push(row);
      }
    }
  }
  return rows;
}

function spanOf(cell: Element, attribute: string): number | undefined {
  const value = Number.parseInt(cell.getAttribute(attribute) ?? '', 10);
  return Number.isFinite(value) && value > 1 ? value : undefined;
}

function cellBlocks(cell: Element, docx: DocxModule, context: BlockContext): BlockChild[] {
  const header = cell.tagName.toLowerCase() === 'th';
  if (hasBlockChildren(cell)) {
    const blocks = blocksFromChildren(cell, docx, context);
    if (blocks.length > 0) return blocks;
  }
  // A cell may never be empty in OOXML: an empty paragraph is the empty cell.
  return [new docx.Paragraph({
    children: inlineChildren(cell.childNodes, docx, context.notes, { bold: header }),
  })];
}

function tableBlocks(
  element: Element,
  docx: DocxModule,
  context: BlockContext,
): BlockChild[] {
  const rows = rowElements(element);
  if (rows.length === 0) return blocksFromChildren(element, docx, context);
  const border = { style: docx.BorderStyle.SINGLE, size: 1, color: '999999' };
  return [new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: rows.map(row => new docx.TableRow({
      children: [...row.children]
        .filter(cell => ['td', 'th'].includes(cell.tagName.toLowerCase()))
        .map(cell => new docx.TableCell({
          columnSpan: spanOf(cell, 'colspan'),
          rowSpan: spanOf(cell, 'rowspan'),
          children: cellBlocks(cell, docx, context),
        })),
    })),
  })];
}

function paragraphsFromElement(
  element: Element,
  docx: DocxModule,
  context: BlockContext,
): BlockChild[] {
  const tag = element.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') return listBlocks(element, docx, context);
  if (tag === 'table') return tableBlocks(element, docx, context);
  if (tag === 'hr') {
    // The manuscript convention for a scene or POV break.
    return [new docx.Paragraph({
      children: [new docx.TextRun({ text: '* * *' })],
      alignment: docx.AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    })];
  }
  if (/^h[1-6]$/.test(tag)) {
    return [new docx.Paragraph({
      children: inlineChildren(element.childNodes, docx, context.notes),
      heading: headingFor(tag, docx),
      spacing: { before: 200, after: 100 },
    })];
  }
  if (tag === 'blockquote') {
    if (hasBlockChildren(element)) {
      return blocksFromChildren(element, docx, { ...context, quoted: true });
    }
    return [new docx.Paragraph({
      children: inlineChildren(element.childNodes, docx, context.notes, { italics: true }),
      indent: { left: 720, right: 720 },
      spacing: { after: 120 },
    })];
  }
  if (tag === 'p' || tag === 'pre') {
    const children = inlineChildren(element.childNodes, docx, context.notes, {
      italics: context.quoted,
      monospace: tag === 'pre',
      preformatted: tag === 'pre',
    });
    return [new docx.Paragraph({
      children,
      indent: context.quoted ? { left: 720, right: 720 } : undefined,
      spacing: { after: 120 },
    })];
  }

  const blocks = blocksFromChildren(element, docx, context);
  if (blocks.length === 0) {
    const children = inlineChildren(element.childNodes, docx, context.notes);
    if (children.length > 0) blocks.push(new docx.Paragraph({ children }));
  }
  return blocks;
}

function paragraphsFromHtml(
  html: string,
  docx: DocxModule,
  nextInstance: { value: number },
  notes: Notes,
): BlockChild[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  numberFootnotes(parsed.body, docx, notes.bodies);
  const context: BlockContext = { listLevel: 0, listInstance: 0, nextInstance, quoted: false, notes };
  const blocks: BlockChild[] = [];
  for (const child of parsed.body.childNodes) {
    if (child instanceof Element) {
      blocks.push(...paragraphsFromElement(child, docx, context));
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      blocks.push(new docx.Paragraph({ children: inlineChildren([child], docx, context.notes) }));
    }
  }
  return blocks;
}

function numberingLevels(docx: DocxModule, ordered: boolean) {
  return Array.from({ length: 6 }, (_, level) => ({
    level,
    format: ordered ? docx.LevelFormat.DECIMAL : docx.LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : '•',
    alignment: docx.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
}

/** Build a browser Blob; `docx` stays out of the initial renderer bundle. */
export async function buildPublishingDocx(document: PublishingDocument): Promise<Blob> {
  const docx = await import('docx');
  const children: (BlockChild | TableOfContents)[] = [];
  const listInstances = { value: 0 };
  const notes: Notes = {
    kind: document.footnotePlacement === 'book' ? 'endnotes' : 'footnotes',
    bodies: {},
  };
  if (document.includeTitlePage) {
    children.push(
      new docx.Paragraph({
        text: document.title,
        heading: docx.HeadingLevel.TITLE,
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 2800, after: 300 },
      }),
      new docx.Paragraph({
        text: `${document.wordCount.toLocaleString(document.locale)} ${document.wordLabel} · ${new Date(document.generatedAt).toLocaleDateString(document.locale)}`,
        alignment: docx.AlignmentType.CENTER,
      }),
      new docx.Paragraph({ children: [new docx.PageBreak()] }),
    );
  }
  // A real Word table of contents, fed by the chapter headings below (every
  // one is HEADING_1; the prose's own headings start at HEADING_2, so they
  // stay out of it). Word builds the entries itself — `updateFields` asks it
  // to on opening, and LibreOffice does the same on demand — so the file
  // carries no stale page numbers of ours.
  const toc = document.includeToc && document.sections.length > 0;
  if (toc) {
    children.push(
      new docx.Paragraph({
        text: document.tocTitle,
        heading: docx.HeadingLevel.TITLE,
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 400, after: 300 },
      }),
      new docx.TableOfContents(document.tocTitle, { hyperlink: true, headingStyleRange: '1-1' }),
      new docx.Paragraph({ children: [new docx.PageBreak()] }),
    );
  }
  document.sections.forEach((section, sectionIndex) => {
    children.push(new docx.Paragraph({
      text: section.title,
      heading: docx.HeadingLevel.HEADING_1,
      pageBreakBefore: sectionIndex > 0,
    }));
    if (section.synopsis) {
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: section.synopsis, italics: true })],
        alignment: docx.AlignmentType.CENTER,
        spacing: { after: 240 },
      }));
    }
    children.push(...paragraphsFromHtml(section.portableHtml, docx, listInstances, notes));
  });
  if (document.bibliography.length > 0 && document.bibliographyTitle) {
    children.push(new docx.Paragraph({
      text: document.bibliographyTitle,
      heading: docx.HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }));
    for (const citation of document.bibliography) {
      children.push(new docx.Paragraph({ text: citation, spacing: { after: 180 } }));
    }
  }

  const file = new docx.Document({
    title: document.title,
    creator: 'Writers Hoard',
    // Real Word footnotes (`word/footnotes.xml`) or endnotes
    // (`word/endnotes.xml`), numbered and placed by Word itself.
    footnotes: notes.kind === 'footnotes' ? notes.bodies : undefined,
    endnotes: notes.kind === 'endnotes' ? notes.bodies : undefined,
    features: toc ? { updateFields: true } : undefined,
    numbering: {
      config: [
        { reference: 'publishing-bullets', levels: numberingLevels(docx, false) },
        { reference: 'publishing-numbers', levels: numberingLevels(docx, true) },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  return docx.Packer.toBlob(file);
}
