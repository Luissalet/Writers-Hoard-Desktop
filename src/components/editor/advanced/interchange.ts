import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { BLOCK_KEYS, INLINE_KEYS, formattingFromElement, formattingHtmlAttributes, normalizeAdvancedFormatting, normalizeColumnWidths, type AdvancedFormatting } from './model';

function colorHex(value: string): string | undefined {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return '#' + value.slice(1).split('').map(character => character + character).join('').toLowerCase();
  const match = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\s*\)$/.exec(value);
  if (!match || match.slice(1).some(part => Number(part) > 255)) return undefined;
  return '#' + match.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('');
}

function supportedCss(element: HTMLElement): AdvancedFormatting {
  const style = element.style;
  const font = style.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  const fontSize = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(style.fontSize);
  const indent = /^(\d+(?:\.\d+)?)em$/.exec(style.marginInlineStart || style.marginLeft);
  return normalizeAdvancedFormatting({
    fontFamily: font === 'sans-serif' ? 'sans' : font === 'monospace' ? 'mono' : font || undefined,
    fontSize: fontSize ? Number(fontSize[1]) * (fontSize[2] === 'px' ? 0.75 : 1) : undefined,
    color: colorHex(style.color), highlight: colorHex(style.backgroundColor), alignment: style.textAlign || undefined,
    lineHeight: /^\d+(\.\d+)?$/.test(style.lineHeight) ? Number(style.lineHeight) : undefined,
    indent: indent ? Number(indent[1]) / 1.5 : undefined,
  });
}

/** Import standard HTML formatting into the editor's portable vocabulary. */
export function normalizeAdvancedHtml(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  for (const cell of host.querySelectorAll<HTMLElement>('td,th')) {
    let widths = normalizeColumnWidths(cell.getAttribute('data-wh-colwidth') ?? cell.getAttribute('colwidth'));
    if (!widths) {
      const width = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(cell.style.width);
      const colspan = Number(cell.getAttribute('colspan') ?? 1);
      if (width && Number.isInteger(colspan) && colspan > 0 && colspan <= 64) widths = normalizeColumnWidths(Array(colspan).fill(Math.round(Number(width[1]) * (width[2] === 'pt' ? 4 / 3 : 1) / colspan)));
    }
    if (widths) cell.setAttribute('data-wh-colwidth', widths.join(','));
  }
  for (const element of Array.from(host.querySelectorAll<HTMLElement>('[style]'))) {
    if (element.style.breakAfter === 'page' || element.style.pageBreakAfter === 'always') {
      if (element.tagName === 'DIV' && !element.textContent?.trim()) element.setAttribute('data-wh-page-break', 'true');
      else {
        const page = document.createElement('div'); page.setAttribute('data-wh-page-break', 'true'); element.after(page);
      }
    }
  }
  for (const element of Array.from(host.querySelectorAll<HTMLElement>('span,p,h1,h2,h3,h4,h5,h6'))) {
    const format = { ...supportedCss(element), ...formattingFromElement(element) };
    const block = element.tagName !== 'SPAN';
    const attrs = formattingHtmlAttributes(format, block ? BLOCK_KEYS : INLINE_KEYS);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    // Word commonly puts character formatting on a paragraph. Represent that
    // as an inline mark so the chapter and book editors preserve it identically.
    if (block && INLINE_KEYS.some(key => format[key] !== undefined)) {
      const span = document.createElement('span');
      for (const [key, value] of Object.entries(formattingHtmlAttributes(format, INLINE_KEYS))) span.setAttribute(key, value);
      span.append(...Array.from(element.childNodes));
      element.appendChild(span);
    }
    if (!Object.keys(attrs).length) element.removeAttribute('style');
  }
  return sanitizeRichHtml(host.innerHTML);
}

/** Data attributes stay as a lossless receipt; approved standard CSS travels too. */
export function advancedHtmlForInterchange(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = sanitizeRichHtml(html);
  for (const element of host.querySelectorAll<HTMLElement>('div[data-wh-page-break]')) element.style.breakAfter = 'page';
  for (const element of host.querySelectorAll<HTMLElement>('td[data-wh-colwidth],th[data-wh-colwidth]')) {
    const widths = normalizeColumnWidths(element.getAttribute('data-wh-colwidth'));
    if (widths) { element.setAttribute('colwidth', widths.join(',')); element.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`; }
  }
  return host.innerHTML;
}
