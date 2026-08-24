import type { Paragraph, ParagraphChild } from 'docx';
import type { PublishingDocument } from './publishingDocument';

type DocxModule = typeof import('docx');

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  monospace?: boolean;
}

const BLOCK_TAGS = new Set([
  'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

function inlineChildren(
  nodes: Iterable<Node>,
  docx: DocxModule,
  style: InlineStyle = {},
): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? '';
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
    const nextStyle: InlineStyle = {
      ...style,
      bold: style.bold || tag === 'strong' || tag === 'b',
      italics: style.italics || tag === 'em' || tag === 'i',
      underline: style.underline || tag === 'u' || tag === 'a',
      monospace: style.monospace || tag === 'code',
    };
    children.push(...inlineChildren(node.childNodes, docx, nextStyle));
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

function paragraphsFromElement(
  element: Element,
  docx: DocxModule,
  listLevel = 0,
): Paragraph[] {
  const tag = element.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    const paragraphs: Paragraph[] = [];
    const reference = tag === 'ul' ? 'publishing-bullets' : 'publishing-numbers';
    const items = [...element.children].filter(child => child.tagName.toLowerCase() === 'li');
    for (const item of items) {
      const children = inlineChildren(item.childNodes, docx);
      if (children.length > 0) {
        paragraphs.push(new docx.Paragraph({
          children,
          numbering: { reference, level: Math.min(listLevel, 5) },
          spacing: { after: 80 },
        }));
      }
      for (const nested of [...item.children].filter(child => ['ul', 'ol'].includes(child.tagName.toLowerCase()))) {
        paragraphs.push(...paragraphsFromElement(nested, docx, listLevel + 1));
      }
    }
    return paragraphs;
  }
  if (/^h[1-6]$/.test(tag)) {
    return [new docx.Paragraph({
      children: inlineChildren(element.childNodes, docx),
      heading: headingFor(tag, docx),
      spacing: { before: 200, after: 100 },
    })];
  }
  if (tag === 'p' || tag === 'pre' || tag === 'blockquote') {
    const children = inlineChildren(element.childNodes, docx, {
      italics: tag === 'blockquote',
      monospace: tag === 'pre',
    });
    return [new docx.Paragraph({
      children,
      indent: tag === 'blockquote' ? { left: 720, right: 720 } : undefined,
      spacing: { after: 120 },
    })];
  }

  const paragraphs: Paragraph[] = [];
  for (const child of element.childNodes) {
    if (child instanceof Element && BLOCK_TAGS.has(child.tagName.toLowerCase())) {
      paragraphs.push(...paragraphsFromElement(child, docx, listLevel));
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      paragraphs.push(new docx.Paragraph({ children: inlineChildren([child], docx) }));
    }
  }
  if (paragraphs.length === 0) {
    const children = inlineChildren(element.childNodes, docx);
    if (children.length > 0) paragraphs.push(new docx.Paragraph({ children }));
  }
  return paragraphs;
}

function paragraphsFromHtml(html: string, docx: DocxModule): Paragraph[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs: Paragraph[] = [];
  for (const child of parsed.body.childNodes) {
    if (child instanceof Element) {
      paragraphs.push(...paragraphsFromElement(child, docx));
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      paragraphs.push(new docx.Paragraph({ children: inlineChildren([child], docx) }));
    }
  }
  return paragraphs;
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
  const children: Paragraph[] = [];
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
    children.push(...paragraphsFromHtml(section.portableHtml, docx));
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
